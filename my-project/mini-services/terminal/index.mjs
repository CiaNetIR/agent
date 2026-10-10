/**
 * VPN STAR — Owner Web Terminal (mini-service, port 3001)
 * -------------------------------------------------------
 * Gives the OWNER direct shell access to the sandbox from the preview
 * panel (no AI agent in the middle). Runtime: node (node-pty needs a
 * real node runtime; bun's pty support is broken — master fd closes).
 *
 * Transport: socket.io with path '/' (REQUIRED by the Caddy gateway —
 * the panel connects via io("/?XTransformPort=3001")).
 *
 * Security:
 *   - password gate: sha256(password) must match .secrets/panel.env
 *     PANEL_PASSWORD_SHA256 (timing-safe compare)
 *   - kill switch: PANEL_TERM=0 in panel.env disables the terminal
 *   - 5 wrong passwords -> 5 minute lockout (per IP)
 *   - UP TO 4 PARALLEL SESSIONS (each socket = its own PTY; the cap
 *     protects the small sandbox — plenty for parallel work)
 *   - 30-min idle timeout per session, full command audit log
 */
import { createServer } from 'node:http'
import { Server } from 'socket.io'
import { spawn } from 'node-pty'
import { createHash, timingSafeEqual } from 'node:crypto'
import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const PORT = 3001
const MAX_SESSIONS = 4
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PANEL_ENV = '/home/z/my-project/.secrets/panel.env'
const AUDIT_LOG = path.join(HERE, 'term-audit.log')
const AUDIT_MAX_BYTES = 1024 * 1024
const IDLE_TIMEOUT_MS = 30 * 60 * 1000
const MAX_FAILS = 5
const LOCK_MS = 5 * 60 * 1000

const now = () => new Date().toISOString()
const audit = (event, extra = '') => {
  try {
    if (existsSync(AUDIT_LOG) && statSync(AUDIT_LOG).size > AUDIT_MAX_BYTES) {
      renameSync(AUDIT_LOG, AUDIT_LOG + '.1')
    }
    appendFileSync(AUDIT_LOG, `${now()} ${event} ${extra}\n`, 'utf8')
  } catch { /* never crash on audit */ }
}

function readPanel() {
  try {
    const raw = readFileSync(PANEL_ENV, 'utf8')
    const cfg = {}
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) cfg[m[1]] = m[2]
    }
    return cfg
  } catch {
    return {}
  }
}

function checkKey(hashHex) {
  const cfg = readPanel()
  const want = (cfg.PANEL_PASSWORD_SHA256 || '').toLowerCase()
  const got = (hashHex || '').toLowerCase().trim()
  if (!want || !/^[0-9a-f]{64}$/.test(got)) return false
  try {
    return timingSafeEqual(Buffer.from(want, 'hex'), Buffer.from(got, 'hex'))
  } catch {
    return false
  }
}

const termEnabled = () => readPanel().PANEL_TERM !== '0'

const httpServer = createServer((req, res) => {
  // plain HTTP health check (browsers hitting the port directly)
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
  res.end('VPN STAR terminal service — ok\n')
})

const io = new Server(httpServer, {
  // DO NOT change the path — the Caddy gateway routes on it
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 256 * 1024,
})

/** @type {Map<any, {socket: any, pty: any, idleTimer: any, lineBuf: string}>} */
const sessions = new Map()
const fails = new Map() // ip -> {n, until}

const failState = (ip) => {
  const st = fails.get(ip) || { n: 0, until: 0 }
  return st
}

function teardown(socket, reason) {
  const a = sessions.get(socket.id)
  if (!a) return
  sessions.delete(socket.id)
  clearInterval(a.idleTimer)
  try { a.socket.emit('closed', { reason }) } catch { /* noop */ }
  try { a.socket.disconnect(true) } catch { /* noop */ }
  try { a.pty.kill() } catch { /* noop */ }
  audit('session_end', `sid=${socket.id} reason=${reason} left=${sessions.size}`)
}

function teardownAll(reason) {
  for (const s of [...sessions.keys()]) teardown(s, reason)
}

io.on('connection', (socket) => {
  const ip = socket.handshake?.address || 'unknown'
  let authed = false

  socket.on('auth', (data) => {
    const st = failState(ip)
    if (st.until > Date.now()) {
      socket.emit('auth-fail', {
        locked: true,
        retryInSec: Math.ceil((st.until - Date.now()) / 1000),
      })
      socket.disconnect(true)
      return
    }
    if (!termEnabled()) {
      socket.emit('auth-fail', { disabled: true })
      socket.disconnect(true)
      return
    }
    const key = data && typeof data === 'object' ? data.key : ''
    if (!checkKey(key)) {
      st.n += 1
      if (st.n >= MAX_FAILS) {
        st.until = Date.now() + LOCK_MS
        st.n = 0
        audit('auth_lockout', `ip=${ip}`)
      }
      fails.set(ip, st)
      socket.emit('auth-fail', { remaining: Math.max(0, MAX_FAILS - st.n) })
      if (st.until > Date.now()) socket.disconnect(true)
      return
    }
    st.n = 0
    fails.set(ip, st)
    authed = true
    audit('auth_ok', `ip=${ip}`)

    // defensive: a re-auth on the SAME socket must not leak the old pty
    if (sessions.has(socket.id)) teardown(socket, 're-auth')

    // parallel sessions — but capped, to protect the small sandbox
    if (sessions.size >= MAX_SESSIONS) {
      audit('session_limit', `ip=${ip}`)
      socket.emit('auth-fail', { limit: true, max: MAX_SESSIONS })
      socket.disconnect(true)
      return
    }

    const cols = Math.min(Math.max(20, Number(data.cols) || 90), 400)
    const rows = Math.min(Math.max(6, Number(data.rows) || 28), 200)

    const pty = spawn('/bin/bash', ['--noprofile', '--norc'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: '/home/z',
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        HOME: '/home/z',
        SHELL: '/bin/bash',
        // NOTE: keep the trailing "$" (not "#") — a "#" made the owner think
        // this shell is root. It is user "z" in the cloud sandbox, never root.
        PS1: '\\[\\e[1;36m\\]star\\[\\e[0m\\]\\[\\e[90m\\](z)\\[\\e[0m\\]:\\[\\e[1;33m\\]\\w\\[\\e[0m\\]\\[\\e[1;32m\\]$\\[\\e[0m\\] ',
      },
    })

    const a = { socket, pty, idleTimer: null, lineBuf: '' }
    sessions.set(socket.id, a)
    audit('session_start', `sid=${socket.id} live=${sessions.size}`)

    socket.emit('auth-ok', { mode: 'pty', cols, rows })
    socket.emit(
      'output',
      '\r\n\x1b[1;36m★ VPN STAR — شل محیط ابری\x1b[0m ' +
        '(کاربر z — بدون روت و بدون sudo)\r\n' +
        '\x1b[90mاین شل متصل به محیط ابری دستیاره، نه سرور/VPS شخصی شما.\x1b[0m\r\n' +
        '\x1b[90mپنل‌های سرور مثل aaPanel باید روی VPS خودت با روت نصب بشن.\x1b[0m\r\n' +
        '\x1b[90mترمینال‌های موازی: تا ۴ عدد همزمان — از دکمه «+» در پنل.\x1b[0m\r\n' +
        '\r\n' +
        '\x1b[90mوضعیت دستیار:  ~/tg-tools/watcher/watcher_ctl.sh status\x1b[0m' +
        '\r\n\x1b[90mمستندات کامل:  tg-tools-backup/Z-OWNER-MANUAL.md\x1b[0m\r\n\r\n'
    )

    pty.onData((d) => {
      try { socket.emit('output', d) } catch { /* noop */ }
    })
    pty.onExit(({ exitCode }) => {
      if (sessions.get(socket.id) === a) {
        sessions.delete(socket.id)
        clearInterval(a.idleTimer)
        try { socket.emit('closed', { exitCode }) } catch { /* noop */ }
      }
      audit('shell_exit', `sid=${socket.id} code=${exitCode} left=${sessions.size}`)
    })

    socket.on('input', (d) => {
      if (sessions.get(socket.id) !== a || typeof d !== 'string' || !d.length || d.length > 4096) return
      a.lineBuf = (a.lineBuf + d).slice(-512)
      const nl = a.lineBuf.indexOf('\r')
      if (nl !== -1) {
        const cmd = a.lineBuf.slice(0, nl).replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
        if (cmd.trim()) audit('cmd', `sid=${socket.id} ${JSON.stringify(cmd.trim().slice(0, 300))}`)
        a.lineBuf = ''
      }
      try { pty.write(d) } catch { /* noop */ }
    })

    socket.on('resize', (d) => {
      if (sessions.get(socket.id) !== a) return
      const c = Math.min(Math.max(20, Number(d?.cols) || 90), 400)
      const r = Math.min(Math.max(6, Number(d?.rows) || 28), 200)
      try { pty.resize(c, r) } catch { /* noop */ }
    })

    let lastSeen = Date.now()
    socket.on('input', () => { lastSeen = Date.now() })
    a.idleTimer = setInterval(() => {
      if (sessions.get(socket.id) !== a) { clearInterval(a.idleTimer); return }
      if (Date.now() - lastSeen > IDLE_TIMEOUT_MS) {
        teardown(socket, 'idle-timeout')
      }
    }, 30_000)
  })

  socket.on('disconnect', () => {
    if (authed && sessions.has(socket.id)) teardown(socket, 'disconnect')
  })
})

httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`[terminal] listening on 127.0.0.1:${PORT} (socket.io path "/") — up to ${MAX_SESSIONS} parallel sessions`)
  audit('service_start', `pid=${process.pid} max_sessions=${MAX_SESSIONS}`)
})

process.on('SIGTERM', () => { teardownAll('sigterm'); process.exit(0) })
process.on('SIGINT', () => { teardownAll('sigint'); process.exit(0) })
