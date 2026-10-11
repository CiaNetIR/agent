import { NextRequest, NextResponse } from 'next/server'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import os from 'os'
import { execFile } from 'child_process'
import path from 'path'
import {
  WATCHER_DIR,
  fileExists,
  pidAlive,
  pidUptime,
  readJsonSafe,
  verifyKey,
  isLocked,
} from '@/lib/panel-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Services + system stats for the owner panel.
 * GET  → statuses of watcher / terminal service / vnc desktop / system (disk, mem, uptime…)
 * POST → safe service actions (watcher pause/resume/restart, terminal / backups / vnc restart)
 *        — all actions are fixed scripts, no user input reaches a shell.
 */

const PANEL_DIR = '/home/z/my-project/.panel'
const AUDIT_LOG = path.join(PANEL_DIR, 'audit.log')
const TERM_DIR = '/home/z/my-project/mini-services/terminal'
const BACKUPS_DIR = '/home/z/my-project/mini-services/backups'
const VNC_DIR = '/home/z/my-project/mini-services/vnc'
const WATCHER_CTL = path.join(WATCHER_DIR, 'watcher_ctl.sh')
const TERM_CTL = path.join(TERM_DIR, 'term_ctl.sh')
const BACKUPS_CTL = path.join(BACKUPS_DIR, 'backups_ctl.sh')
const VNC_CTL = path.join(VNC_DIR, 'vnc_ctl.sh')

function audit(event: string, extra = '') {
  try {
    mkdirSync(PANEL_DIR, { recursive: true })
    appendFileSync(AUDIT_LOG, `${new Date().toISOString()} ${event} ${extra}\n`, 'utf8')
  } catch {
    /* noop */
  }
}

function run(
  script: string,
  args: string[],
  timeoutMs = 25_000
): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile('bash', [script, ...args], { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
      const out = `${stdout || ''}${stderr ? '\n' + stderr : ''}`.trim().slice(-1500)
      resolve({ ok: !err, out })
    })
  })
}

/** `df -k <path>` → { totalB, usedB, availB, pct } */
function diskUsage(): Promise<{ total: number; used: number; avail: number; pct: number } | null> {
  return new Promise((resolve) => {
    execFile('df', ['-k', '/home/z'], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null)
      const lines = String(stdout).trim().split('\n')
      const parts = (lines[1] || '').trim().split(/\s+/)
      if (parts.length < 6) return resolve(null)
      resolve({
        total: Number(parts[1]) * 1024,
        used: Number(parts[2]) * 1024,
        avail: Number(parts[3]) * 1024,
        pct: Number(String(parts[4]).replace('%', '')) || 0,
      })
    })
  })
}

function prettyOs(): string {
  try {
    const raw = readFileSync('/etc/os-release', 'utf8')
    const m = raw.match(/^PRETTY_NAME="?([^"\n]+)"?/m)
    if (m) return m[1]
  } catch {
    /* noop */
  }
  return `${os.type()} ${os.release()}`
}

async function terminalAlive(): Promise<{ alive: boolean; pid: number | null; portOk: boolean }> {
  const sup = pidAlive(path.join(TERM_DIR, 'supervisor.pid'))
  let portOk = false
  try {
    const res = await fetch('http://127.0.0.1:3001/', { signal: AbortSignal.timeout(2500) })
    portOk = res.ok
  } catch {
    portOk = false
  }
  return { alive: sup.alive || portOk, pid: sup.pid, portOk }
}

async function backupsStatus(): Promise<{
  alive: boolean
  pid: number | null
  running: boolean
  lastRunAt: string | null
  lastOkAt: string | null
  lastCommit: string | null
  lastError: string | null
  nextRunAt: string | null
}> {
  const sup = pidAlive(path.join(BACKUPS_DIR, 'supervisor.pid'))
  let alive = sup.alive
  if (!alive) {
    try {
      const res = await fetch('http://127.0.0.1:3010/healthz', { signal: AbortSignal.timeout(2500) })
      alive = res.ok
    } catch {
      alive = false
    }
  }
  const st = readJsonSafe<Record<string, unknown>>(path.join(BACKUPS_DIR, 'state.json'), {})
  // 30-minute cycle — next slot is :00 or :30
  const hr = (Date.now() % 1_800_000)
  return {
    alive,
    pid: sup.pid,
    running: st.running === true,
    lastRunAt: (st.lastRunAt as string) || null,
    lastOkAt: (st.lastOkAt as string) || null,
    lastCommit: (st.lastCommit as string) || null,
    lastError: (st.lastError as string) || null,
    nextRunAt: new Date(Date.now() + (1_800_000 - hr)).toISOString(),
  }
}

/** x11vnc process up? (the actual desktop stream behind websockify) */
function vncDesktopUp(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(
      'bash',
      ['-c', 'pgrep -x x11vnc >/dev/null && echo up || echo down'],
      { timeout: 3000 },
      (err, stdout) => {
        resolve(!err && String(stdout).trim() === 'up')
      }
    )
  })
}

async function vncStatus(): Promise<{
  alive: boolean
  pid: number | null
  webOk: boolean
  desktopUp: boolean
}> {
  const sup = pidAlive(path.join(VNC_DIR, 'supervisor.pid'))
  let webOk = false
  try {
    const res = await fetch('http://127.0.0.1:6080/', { signal: AbortSignal.timeout(2000) })
    webOk = res.ok
  } catch {
    webOk = false
  }
  const desktopUp = await vncDesktopUp()
  return { alive: sup.alive || webOk, pid: sup.pid, webOk, desktopUp }
}

/* ---------------------------------------------------------------- GET */

export async function GET(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (isLocked()) return NextResponse.json({ ok: false, error: 'قفل موقت' }, { status: 429 })

  const watcher = pidAlive(path.join(WATCHER_DIR, 'watcher.lock'))
  const supervisor = pidAlive(path.join(WATCHER_DIR, 'supervisor.pid'))
  const paused = fileExists(path.join(WATCHER_DIR, 'PAUSE'))
  const state = readJsonSafe<Record<string, unknown>>(path.join(WATCHER_DIR, 'state.json'), {})
  const terminal = await terminalAlive()
  const backups = await backupsStatus()
  const vnc = await vncStatus()
  const disk = await diskUsage()

  const totalMem = os.totalmem()
  const freeMem = os.freemem()
  const usedMem = Math.max(0, totalMem - freeMem)

  return NextResponse.json({
    ok: true,
    watcher: {
      running: watcher.alive,
      pid: watcher.pid,
      uptimeSec: pidUptime(watcher.pid),
      paused,
      supervisorAlive: supervisor.alive,
      mode: state.mode || 'permanent',
      repliesTotal: Number(state.replies_total || 0),
    },
    terminal: {
      alive: terminal.alive,
      pid: terminal.pid,
      portOk: terminal.portOk,
    },
    backups,
    vnc: {
      alive: vnc.alive,
      pid: vnc.pid,
      webOk: vnc.webOk,
      desktopUp: vnc.desktopUp,
    },
    system: {
      os: prettyOs(),
      kernel: os.release(),
      cpus: os.cpus().length,
      uptimeSec: Math.floor(os.uptime()),
      panelUptimeSec: Math.floor(process.uptime()),
      load: os.loadavg().map((n) => Math.round(n * 100) / 100),
      disk,
      mem: {
        total: totalMem,
        used: usedMem,
        pct: totalMem ? Math.round((usedMem / totalMem) * 100) : 0,
      },
    },
  })
}

/* ---------------------------------------------------------------- POST */

const ACTIONS = new Set([
  'watcher-pause',
  'watcher-resume',
  'watcher-restart',
  'watcher-start',
  'terminal-restart',
  'backups-restart',
  'backup-now',
  'vnc-restart',
])

export async function POST(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (isLocked()) return NextResponse.json({ ok: false, error: 'قفل موقت' }, { status: 429 })

  let action = ''
  try {
    const body = (await req.json()) as { action?: string }
    action = String(body.action || '')
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400 })
  }
  if (!ACTIONS.has(action)) {
    return NextResponse.json({ ok: false, error: 'عملیات ناشناخته' }, { status: 400 })
  }
  audit('svc_action', action)

  let result: { ok: boolean; out: string }
  switch (action) {
    case 'watcher-pause':
      result = await run(WATCHER_CTL, ['pause'], 15_000)
      break
    case 'watcher-resume':
      result = await run(WATCHER_CTL, ['resume'], 15_000)
      break
    case 'watcher-start':
      result = await run(WATCHER_CTL, ['start'], 60_000)
      break
    case 'watcher-restart':
      await run(WATCHER_CTL, ['stop'], 30_000)
      result = await run(WATCHER_CTL, ['start'], 90_000)
      break
    case 'terminal-restart':
      result = await run(TERM_CTL, ['restart'], 30_000)
      break
    case 'backups-restart':
      result = await run(BACKUPS_CTL, ['restart'], 30_000)
      break
    case 'vnc-restart':
      result = await run(VNC_CTL, ['restart'], 60_000)
      break
    case 'backup-now': {
      // trigger an immediate hourly-style backup on :3010 — forward the
      // owner's panel key (the service re-validates it, same convention)
      try {
        const res = await fetch('http://127.0.0.1:3010/run', {
          method: 'POST',
          headers: { 'x-panel-key': req.headers.get('x-panel-key') || '' },
          signal: AbortSignal.timeout(5000),
        })
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; started?: boolean }
        result = { ok: res.ok && data.ok !== false, out: data.started ? 'بکاپ همین الان شروع شد — چند دقیقه طول می‌کشه (سینک + بیلد + پوش).' : data.error || 'شروع نشد' }
      } catch {
        result = { ok: false, out: 'سرویس بکاپ (:3010) در دسترس نیست — از ری‌استارت استفاده کن' }
      }
      break
    }
    default:
      return NextResponse.json({ ok: false, error: 'unreachable' }, { status: 400 })
  }

  return NextResponse.json({
    ok: result.ok,
    output: result.out,
    action,
  })
}
