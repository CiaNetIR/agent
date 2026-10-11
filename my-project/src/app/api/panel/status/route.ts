import { NextRequest, NextResponse } from 'next/server'
import {
  WATCHER_DIR,
  fileExists,
  pidAlive,
  pidUptime,
  readJsonSafe,
  verifyKey,
} from '@/lib/panel-server'
import { existsSync, readFileSync, statfsSync } from 'fs'
import os from 'os'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface WLogEvent {
  ts: string
  event: string
  [k: string]: unknown
}

const TEHRAN = 'Asia/Tehran'

function tehranDay(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TEHRAN,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

function tailEvents(n = 3000): WLogEvent[] {
  const p = path.join(WATCHER_DIR, 'wlog.jsonl')
  try {
    const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean)
    const out: WLogEvent[] = []
    for (const line of lines.slice(-n)) {
      try {
        out.push(JSON.parse(line))
      } catch {
        /* skip malformed */
      }
    }
    return out
  } catch {
    return []
  }
}

export async function GET(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const watcher = pidAlive(path.join(WATCHER_DIR, 'watcher.lock'))
  const supervisor = pidAlive(path.join(WATCHER_DIR, 'supervisor.pid'))
  const paused = fileExists(path.join(WATCHER_DIR, 'PAUSE'))
  const state = readJsonSafe<Record<string, unknown>>(
    path.join(WATCHER_DIR, 'state.json'),
    {}
  )
  const config = readJsonSafe<Record<string, unknown>>(
    '/home/z/my-project/.secrets/watcher-config.json',
    {}
  )

  const events = tailEvents()
  const todayKey = tehranDay(new Date())
  let todayIncoming = 0
  let todayReplies = 0
  for (const ev of events) {
    try {
      if (tehranDay(new Date(ev.ts)) !== todayKey) continue
    } catch {
      continue
    }
    if (ev.event === 'incoming') todayIncoming += 1
    if (ev.event === 'reply_send') todayReplies += 1
  }

  const recent = events.slice(-25).reverse()

  const blacklist = Array.isArray(config.blacklist)
    ? (config.blacklist as Array<Record<string, unknown>>).map((b) => ({
        username: String(b.username || ''),
        name: b.name ? String(b.name) : '',
      }))
    : []
  const instructions = Array.isArray(config.instructions)
    ? (config.instructions as string[])
    : []

  const windowEnd = Number(state.window_end || 0)
  const permanent = windowEnd > 4000000000
  const windowLeftSec = windowEnd ? Math.max(0, windowEnd - Date.now() / 1000) : 0

  // live system resources — the sandbox is small, so keep the owner informed
  const cpus = os.cpus()
  const memTotal = os.totalmem()
  const memUsed = memTotal - os.freemem()
  let disk = { totalGb: 0, freeGb: 0, usedPct: 0 }
  try {
    const st = statfsSync('/')
    const total = st.blocks * st.bsize
    const free = st.bavail * st.bsize
    disk = {
      totalGb: +(total / 1024 ** 3).toFixed(1),
      freeGb: +(free / 1024 ** 3).toFixed(1),
      usedPct: total ? Math.round(((total - free) / total) * 100) : 0,
    }
  } catch {
    /* keep zeros */
  }

  return NextResponse.json({
    ok: true,
    watcher: {
      running: watcher.alive,
      pid: watcher.pid,
      uptimeSec: pidUptime(watcher.pid),
      paused,
      supervisorAlive: supervisor.alive,
    },
    state: {
      replies_total: Number(state.replies_total || 0),
      started_count: Number(state.started_count || 0),
      mode: state.mode || 'permanent',
      permanent,
      windowLeftSec,
    },
    today: { incoming: todayIncoming, replies: todayReplies },
    system: {
      cpuModel: (cpus[0]?.model || '').replace(/\s+/g, ' ').trim(),
      cpuCores: cpus.length || os.availableParallelism?.() || 1,
      load1: +os.loadavg()[0].toFixed(2),
      memTotalGb: +(memTotal / 1024 ** 3).toFixed(1),
      memUsedGb: +(memUsed / 1024 ** 3).toFixed(1),
      memPct: memTotal ? Math.round((memUsed / memTotal) * 100) : 0,
      disk,
      uptimeH: +(os.uptime() / 3600).toFixed(1),
    },
    blacklist,
    instructionsCount: instructions.length,
    events: recent.map((ev) => ({
      ts: ev.ts,
      event: ev.event,
      chat_id: ev.chat_id ?? null,
      detail:
        (typeof ev.text === 'string' && ev.text) ||
        (typeof ev.answer === 'string' && ev.answer) ||
        (typeof ev.reason === 'string' && ev.reason) ||
        (typeof ev.user === 'string' && ev.user) ||
        (typeof ev.action === 'string' && ev.action) ||
        '',
    })),
  })
}
