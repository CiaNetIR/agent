/**
 * backups service (:3010) — full-server backup to GitHub every 30 minutes.
 *
 * The heavy pipeline (rsync + health checks + build + commit + push) runs in
 * a DETACHED CHILD PROCESS (`bun run-backup.ts --once`) so this HTTP service
 * never blocks and always answers. State is persisted by the child into
 * state.json and re-read on every request; the running flag is the liveness
 * of the current child (run.pid).
 *
 * HTTP (every endpoint except /healthz requires the panel key, same
 * sha256 convention as the whole panel — the gateway can proxy ANY
 * localhost port, so this service must never trust the network):
 *   GET  /healthz  → {"ok":true}                     (no secrets)
 *   GET  /         → full status + run history        (x-panel-key)
 *   GET  /log      → last 100 backup.log lines        (x-panel-key)
 *   POST /run      → trigger a backup RIGHT NOW       (x-panel-key)
 *
 * Scheduler: aligned to :00 and :30 of every hour (30-minute cycle); on
 * boot it catches up if the last successful run is older than 40 minutes.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { spawn } from 'child_process'
import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from 'fs'
import { timingSafeEqual } from 'crypto'

const PORT = 3010
const HERE: string = (import.meta as ImportMeta & { dir?: string }).dir || process.cwd()
const PANEL_ENV = '/home/z/my-project/.secrets/panel.env'
const STATE_FILE = `${HERE}/state.json`
const LOG_FILE = `${HERE}/backup.log`
const RUN_PID = `${HERE}/run.pid`
const startedAt = Date.now()
const SLOT_MS = 30 * 60_000 // ۳۰ دقیقه — بکاپ هر نیم ساعت

/* ---------------- panel-key auth (timing-safe + 5-fail lock) ---------------- */

function panelKeySha(): string {
  try {
    for (const line of readFileSync(PANEL_ENV, 'utf8').split('\n')) {
      const m = line.match(/^PANEL_PASSWORD_SHA256=([0-9a-fA-F]+)\s*$/)
      if (m) return m[1].toLowerCase()
    }
  } catch {
    /* missing */
  }
  return ''
}

let authFails: number[] = []
function checkAuth(req: IncomingMessage): boolean {
  const now = Date.now()
  authFails = authFails.filter((t) => now - t < 5 * 60_000)
  if (authFails.length >= 5) return false
  const want = panelKeySha()
  const got = String(req.headers['x-panel-key'] || '').toLowerCase().trim()
  let ok = false
  if (want && /^[0-9a-f]{64}$/.test(got)) {
    try {
      ok = timingSafeEqual(Buffer.from(want, 'hex'), Buffer.from(got, 'hex'))
    } catch {
      ok = false
    }
  }
  if (!ok) authFails.push(now)
  return ok
}

/* ---------------- state (re-read from disk on every request) ---------------- */

function log(line: string) {
  const stamp = new Date().toISOString()
  try {
    const fd = openSync(LOG_FILE, 'a')
    try {
      writeSync(fd, `${stamp} ${line}\n`)
    } finally {
      closeSync(fd)
    }
  } catch {
    /* ignore */
  }
  console.log(`${stamp} ${line}`)
}

function readState(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function childAlive(): boolean {
  try {
    const pid = parseInt(readFileSync(RUN_PID, 'utf8').trim(), 10)
    if (!Number.isFinite(pid) || pid <= 0) return false
    process.kill(pid, 0) // throws when dead
    return true
  } catch {
    return false
  }
}

/* ---------------- spawn the backup child ---------------- */

function spawnBackup(trigger: 'hourly' | 'manual' | 'boot'): { started: boolean; error?: string } {
  if (childAlive()) return { started: false, error: 'بکاپ در حال اجراست — چند لحظه صبر کن' }
  try {
    // the child writes its own structured lines into backup.log via log();
    // its raw stdout/stderr goes to a separate scratch file (hard-crash trace)
    const err = openSync(`${HERE}/run-child.out`, 'w')
    try {
      const child = spawn('bun', ['run-backup.ts', '--once', '--trigger', trigger], {
        cwd: HERE,
        detached: true,
        stdio: ['ignore', err, err],
      })
      child.unref()
      if (child.pid) writeFileSync(RUN_PID, String(child.pid))
      log(`[${trigger}] backup child spawned (pid ${child.pid})`)
      return { started: true }
    } finally {
      closeSync(err)
    }
  } catch (e) {
    return { started: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/* ---------------- scheduler ---------------- */

function msToNextSlot(): number {
  return SLOT_MS - (Date.now() % SLOT_MS)
}

function scheduleNext(): void {
  setTimeout(() => {
    if (!childAlive()) spawnBackup('hourly')
    scheduleNext()
  }, msToNextSlot())
}

/* ---------------- tiny http helpers ---------------- */

function json(res: ServerResponse, code: number, body: unknown) {
  const buf = Buffer.from(JSON.stringify(body))
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': buf.length, 'cache-control': 'no-store' })
  res.end(buf)
}

/* ---------------- server ---------------- */

const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  const p = url.pathname.replace(/\/+$/, '') || '/'

  if (p === '/healthz') return json(res, 200, { ok: true, uptimeSec: Math.floor((Date.now() - startedAt) / 1000) })

  if (!checkAuth(req)) return json(res, 401, { ok: false, error: 'رمز پنل نامعتبر یا قفل موقت' })

  if (p === '/' && req.method === 'GET') {
    const s = readState()
    const history = Array.isArray(s.history) ? (s.history as unknown[]) : []
    return json(res, 200, {
      ok: true,
      service: 'backups',
      uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
      running: childAlive(),
      lastRunAt: s.lastRunAt || null,
      lastOkAt: s.lastOkAt || null,
      lastCommit: s.lastCommit || null,
      lastError: s.lastError || null,
      nextRunAt: new Date(Date.now() + msToNextSlot()).toISOString(),
      history: history.slice(-12),
    })
  }

  if (p === '/log' && req.method === 'GET') {
    try {
      const lines = readFileSync(LOG_FILE, 'utf8').trim().split('\n')
      return json(res, 200, { ok: true, lines: lines.slice(-100) })
    } catch {
      return json(res, 200, { ok: true, lines: [] })
    }
  }

  if (p === '/run' && req.method === 'POST') {
    const r = spawnBackup('manual')
    if (!r.started) return json(res, 409, { ok: false, error: r.error })
    return json(res, 202, { ok: true, started: true })
  }

  return json(res, 404, { ok: false, error: 'مسیر ناشناخته' })
})

server.listen(PORT, '127.0.0.1', () => {
  log(`[backups] service on :${PORT} — 30-minute GitHub backup of the whole server (child-process mode)`)
  // catch-up: if the last SUCCESSFUL backup is older than 40 min, run now
  const lastOk = Date.parse(String(readState().lastOkAt || '')) || 0
  if (!lastOk || Date.now() - lastOk > 40 * 60_000) {
    spawnBackup('boot')
  }
  scheduleNext()
})

process.on('unhandledRejection', (e) => log(`[unhandled] ${e}`))
process.on('uncaughtException', (e) => log(`[uncaught] ${e}`))
