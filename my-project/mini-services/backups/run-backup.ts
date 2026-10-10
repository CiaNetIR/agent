/**
 * run-backup.ts — full-server backup (every 30 minutes) → GitHub (private CiaNetIR/agent).
 *
 * Pipeline (each run):
 *   1. rsync the LIVE trees into the git mirror /home/z/agent-repo
 *      (my-project, tg-tools, scraper, e2e, self, agent-files, recovery,
 *       shell scripts, server root files)
 *   2. regenerate server/SERVER-STATE.md (live snapshot — guarantees every
 *      hourly commit carries meaningful, reviewable state)
 *   3. health checks: eslint + tsc --noEmit + isolated `next build`
 *      (NEXT_DIST_DIR=.next-ci — the live dev server's .next is never touched)
 *   4. housekeeping: rotate >10 MB logs (in-place, append-safe), prune stale
 *      watcher .llm_* temp files
 *   5. git add -A → commit (Persian message, Tehran timestamp) → push with the
 *      PAT from /home/z/.github-token (one-off URL — token NEVER written to
 *      any repo file) → verify ls-remote == local HEAD
 *
 * Also usable standalone:  bun run-backup.ts --once
 */
import { spawnSync } from 'child_process'
import { appendFileSync, closeSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, openSync, readSync, fstatSync } from 'fs'
import path from 'path'

export const PORT = 3010
const TOKEN_FILE = '/home/z/.github-token'
const MIRROR = '/home/z/agent-repo'
const PROJECT = '/home/z/my-project'
const HERE: string = (import.meta as ImportMeta & { dir?: string }).dir || process.cwd()
const STATE_FILE = path.join(HERE, 'state.json')
const LOG_FILE = path.join(HERE, 'backup.log')
const PUSH_URL_BASE = 'https://x-access-token:'
const REPO_PUSH_PATH = '@github.com/CiaNetIR/agent.git'
export const SLOT_MS = 30 * 60_000

/* ---------------- Tehran timestamp ---------------- */

function tehranStamp(d = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Tehran',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}`
}

/* ---------------- state ---------------- */

export interface HistoryEntry {
  at: string
  trigger: string
  ok: boolean
  commit?: string
  files?: number
  lint?: boolean
  tsc?: boolean
  build?: boolean
  durMs?: number
  error?: string
}

export interface RunState {
  running: boolean
  lastRunAt: string | null
  lastOkAt: string | null
  lastError: string | null
  lastCommit: string | null
  nextRunAt: string | null
  history: HistoryEntry[]
}

function defaultState(): RunState {
  return { running: false, lastRunAt: null, lastOkAt: null, lastError: null, lastCommit: null, nextRunAt: null, history: [] }
}

let state: RunState = loadState()

function loadState(): RunState {
  try {
    const s = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as RunState
    return { ...defaultState(), ...s, running: false }
  } catch {
    return defaultState()
  }
}

export function getState(): RunState {
  return state
}

function setState(patch: Partial<RunState>) {
  state = { ...state, ...patch }
  try {
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8')
  } catch {
    /* state file is best-effort */
  }
}

export function log(line: string) {
  const stamp = new Date().toISOString()
  try {
    appendFileSync(LOG_FILE, `${stamp} ${line}\n`, 'utf8')
  } catch {
    /* disk full — console only */
  }
  console.log(`${stamp} ${line}`)
}

/* ---------------- shell helpers ---------------- */

function sh(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number; env?: Record<string, string> } = {}): { code: number; out: string } {
  const r = spawnSync(cmd, args, {
    cwd: opts.cwd,
    timeout: opts.timeoutMs ?? 120_000,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
  })
  return { code: r.status ?? -1, out: `${r.stdout || ''}${r.stderr || ''}` }
}

/* ---------------- 1. rsync live → mirror ---------------- */

const PROJECT_EXCLUDES = [
  'node_modules/', '.next/', '.next-ci/', 'dev.log', 'server.log', 'nohup.out',
  'tool-results/', 'tmp/', 'upload/', 'download/', '*.pid', 'service.log',
  'term-audit.log', '*.db-wal', '*.db-shm', 'tsconfig.tsbuildinfo',
  'next-env.d.ts',
  // anchored to the transfer root (my-project/) — watcher state.json must stay tracked
  '/mini-services/backups/backup.log',
  '/mini-services/backups/run-child.out',
  // big full-server tarballs live in Telegram Saved Messages + local disk;
  // pushing them to git every cycle would bloat the repo endlessly
  '/backups/',
  // the noVNC Alpine rootfs (~1GB, includes a 182MB libLLVM > GitHub's 100MB
  // limit) is REBUILDABLE via mini-services/vnc/setup.sh — never sync it
  '/mini-services/vnc/rootfs/',
  '/mini-services/vnc/alpine.tar.gz',
  '/mini-services/vnc/web/core/',
  '/mini-services/vnc/web/vendor/',
  '/mini-services/vnc/web/app/',
]
const TG_EXCLUDES = [
  '__pycache__/', '*.pid', 'watcher.lock', 'PAUSE', 'BACKUP_NOW',
  'pending*.json', '.llm_*', 'sendq/', 'imgreq/', 'instances/',
]

function rsync(src: string, dst: string, excludes: string[], extra: string[] = []): void {
  const args = ['-a', '--delete', ...excludes.map((e) => `--exclude=${e}`), ...extra, src, dst]
  const r = sh('rsync', args, { timeoutMs: 180_000 })
  if (r.code !== 0) log(`[rsync] ${src} → rc=${r.code}: ${r.out.slice(-200)}`)
}

/* ---------------- 1b. daily point-in-time recovery zip (anti-delete) -------
 * The hourly mirror syncs deletions too (rsync --delete), so deleted files
 * also disappear from the WORKING TREE — git history keeps them, but a
 * simple, human-grabbable daily zip of the critical subset is the belt-and-
 * braces layer: newest 30 survive in recovery/ (and ride along to GitHub). */
const ZIP_TARGETS = [
  'my-project/.secrets',
  'my-project/db',
  'my-project/.panel',
  'my-project/scripts',
  'my-project/worklog.md',
  'my-project/LLM-SETUP.md',
  'my-project/EMERGENCY-API.md',
  'my-project/tg-tools-backup',
  'tg-tools/watcher/state.json',
  'tg-tools/watcher/wlog.jsonl',
  'tg-tools/watcher/watcher.py',
  'tg-tools/*.py',
  'agent-files',
]

function dailyRecoveryZip(): void {
  try {
    const dir = '/home/z/recovery'
    mkdirSync(dir, { recursive: true })
    const digits = tehranStamp().replace(/[^0-9]/g, '') // YYYYMMDDHHMM
    const day = digits.slice(0, 8)
    const zips = readdirSync(dir).filter((f) => /^z_backup_\d{8}-\d{4}\.zip$/.test(f))
    if (zips.some((f) => f.slice(9, 17) === day)) return // today's snapshot already exists
    const name = `z_backup_${day}-${digits.slice(8, 12)}.zip`
    const r = sh('bash', [
      '-c',
      `cd /home/z && zip -q -r recovery/${name} ${ZIP_TARGETS.join(' ')} -x '*.db-wal' -x '*.db-shm' -x '*__pycache__*' 2>/dev/null`,
    ], { timeoutMs: 120_000 })
    if (r.code !== 0) {
      log(`[zip] rc=${r.code} — best-effort, skipped`)
      return
    }
    // prune: keep the newest 30 point-in-time zips
    const all = readdirSync(dir).filter((f) => /^z_backup_\d{8}-\d{4}\.zip$/.test(f)).sort()
    for (const old of all.slice(0, Math.max(0, all.length - 30))) {
      try { rmSync(path.join(dir, old)) } catch { /* keep */ }
    }
    log(`[zip] ${name} (${(statSync(path.join(dir, name)).size / 1024).toFixed(0)} KB) — daily anti-delete snapshot`)
  } catch (e) {
    log(`[zip] failed: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`)
  }
}

function backupZaiConfig(): void {
  // belt-and-braces: /etc/.z-ai-config is THE single credential file for the
  // whole AI stack (chat/image/video). It lives OUTSIDE the synced trees, so
  // without this copy it would be in NO backup, NO git history, NO zip —
  // losing it would cut every AI feature with no recovery path.
  try {
    const src = readFileSync('/etc/.z-ai-config', 'utf8')
    // sanity: must parse and carry the auth fields — never copy garbage
    const cfg = JSON.parse(src) as { baseUrl?: string; apiKey?: string }
    if (!cfg.baseUrl || !cfg.apiKey) throw new Error('config missing baseUrl/apiKey')
    const dst = path.join(PROJECT, '.secrets', 'z-ai-config.json')
    const cur = existsSync(dst) ? readFileSync(dst, 'utf8') : ''
    if (cur !== src) {
      writeFileSync(dst, src, 'utf8')
      log('[z-ai-config] refreshed .secrets backup copy')
    }
  } catch (e) {
    log(`[z-ai-config] backup FAILED: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`)
  }
}

function syncAll(): void {
  // 0a. credential belt-and-braces BEFORE the zip so it rides in .secrets
  backupZaiConfig()
  // 0. today's point-in-time zip FIRST so it rides along in the same commit
  dailyRecoveryZip()
  // checkpoint the SQLite WAL first so the copied db file is self-contained
  sh('bash', ['-c', `python3 -c "import sqlite3; c=sqlite3.connect('${PROJECT}/db/custom.db'); c.execute('PRAGMA wal_checkpoint(TRUNCATE)'); c.close()" 2>/dev/null || true`])
  mkdirSync(path.join(MIRROR, 'my-project'), { recursive: true })
  mkdirSync(path.join(MIRROR, 'tg-tools'), { recursive: true })
  mkdirSync(path.join(MIRROR, 'agent'), { recursive: true })
  mkdirSync(path.join(MIRROR, 'e2e'), { recursive: true })
  mkdirSync(path.join(MIRROR, 'self'), { recursive: true })
  mkdirSync(path.join(MIRROR, 'agent-files'), { recursive: true })
  mkdirSync(path.join(MIRROR, 'recovery'), { recursive: true })
  mkdirSync(path.join(MIRROR, 'scripts'), { recursive: true })
  mkdirSync(path.join(MIRROR, 'server'), { recursive: true })

  rsync(`${PROJECT}/`, `${MIRROR}/my-project/`, PROJECT_EXCLUDES)
  rsync('/home/z/tg-tools/', `${MIRROR}/tg-tools/`, TG_EXCLUDES)
  rsync('/home/z/agent/', `${MIRROR}/agent/`, ['__pycache__/', '*.pyc'])
  rsync('/home/z/e2e/', `${MIRROR}/e2e/`, ['chrome-profile*/'])
  rsync('/home/z/self/', `${MIRROR}/self/`, [])
  rsync('/home/z/agent-files/', `${MIRROR}/agent-files/`, [], ['--max-size=10M'])
  rsync('/home/z/recovery/', `${MIRROR}/recovery/`, [])
  // shell scripts from the server root (push-to-github.sh, …)
  sh('bash', ['-c', `rsync -a /home/z/*.sh ${MIRROR}/scripts/ 2>/dev/null || true`])
  // server root misc files
  for (const f of ['pyproject.toml', 'uv.lock', 'TODO', 'mock-woo-test.mjs']) {
    sh('bash', ['-c', `cp /home/z/${f} ${MIRROR}/server/ 2>/dev/null || true`])
  }
  // generated images are small and part of the product — keep the .gitkeep
  // placeholder around even when the live dir is momentarily empty
  mkdirSync(path.join(MIRROR, 'my-project', 'public', 'agent-images'), { recursive: true })
  const keep = path.join(MIRROR, 'my-project', 'public', 'agent-images', '.gitkeep')
  if (!existsSync(keep)) writeFileSync(keep, '')
}

/* ---------------- 2. server state doc ---------------- */

function serverStateDoc(build: { lint: boolean; tsc: boolean; build: boolean }): string {
  const up = sh('bash', ['-c', 'uptime -p 2>/dev/null || true']).out.trim()
  const df = sh('bash', ['-c', 'df -h / | tail -1']).out.trim()
  const free = sh('bash', ['-c', 'free -m | head -2 | tail -1']).out.trim()
  const ports = sh('bash', ['-c', '(ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null) | awk "NR>1 {print \\$4}" | sort -u | tr "\\n" " "']).out.trim()
  const versions = sh('bash', ['-c', 'bun -v; node -v; python3 -V 2>&1; git --version']).out.trim().split('\n').join(' · ')
  const head = sh('git', ['log', '-1', '--oneline'], { cwd: MIRROR }).out.trim()
  const watcherPid = (() => { try { return readFileSync('/home/z/tg-tools/watcher/watcher.lock', 'utf8').trim() } catch { return '?' } })()
  const agentHealth = sh('bash', ['-c', 'curl -s -m 3 http://127.0.0.1:3004/healthz || echo down']).out.trim()
  const termOk = sh('bash', ['-c', 'curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/ || echo down']).out.trim()
  const nextOk = sh('bash', ['-c', 'curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/']).out.trim()
  return `# SERVER STATE — ${tehranStamp()} تهران

> این فایل هر ۳۰ دقیقه توسط سرویس بکاپ‌گیری خودکار بازنویسی می‌شود (\`mini-services/backups\`).
> تاریخچهٔ کامل در \`BACKUP-LOG.md\` و تاریخچهٔ git این ریپو.

| بخش | وضعیت |
|---|---|
| پنل (next :3000) | HTTP ${nextOk} |
| ترمینال (:3001) | HTTP ${termOk} |
| ایجنت (:3004) | ${agentHealth.slice(0, 60)} |
| واتچر تلگرام | pid ${watcherPid} |
| بکاپ ۳۰ دقیقه‌ای (:3010) | اجرا شد ✓ |

- آپتایم: ${up}
- دیسک: \`${df}\`
- حافظه: \`${free}\`
- پورت‌های شنونده: \`${ports}\`
- نسخه‌ها: ${versions}
- HEAD آینه: \`${head}\`
- سلامت بیلد: eslint ${build.lint ? '✓' : '✗'} · tsc ${build.tsc ? '✓' : '✗'} · next build ${build.build ? '✓' : '✗'}
`
}

/* ---------------- 3. health checks (بیلد) ---------------- */

function healthChecks(): { lint: boolean; tsc: boolean; build: boolean } {
  const lint = sh('bash', ['-c', 'cd /home/z/my-project && bun run lint'], { timeoutMs: 180_000 })
  const tsc = sh('bash', ['-c', 'cd /home/z/my-project && bunx tsc --noEmit'], { timeoutMs: 240_000 })
  let buildOk = false
  try {
    const b = sh('bash', ['-c', 'cd /home/z/my-project && NEXT_DIST_DIR=.next-ci NEXT_TELEMETRY_DISABLED=1 nice -n 10 timeout 420 bunx next build'], { timeoutMs: 480_000 })
    buildOk = b.code === 0
    if (!buildOk) log(`[build] failed:\n${b.out.slice(-1500)}`)
  } finally {
    try { rmSync(path.join(PROJECT, '.next-ci'), { recursive: true, force: true }) } catch { /* already gone */ }
  }
  if (lint.code !== 0) log(`[lint] failed:\n${lint.out.slice(-600)}`)
  if (tsc.code !== 0) log(`[tsc] failed:\n${tsc.out.slice(-600)}`)
  return { lint: lint.code === 0, tsc: tsc.code === 0, build: buildOk }
}

/* ---------------- 4. housekeeping ---------------- */

const ROTATE_LOGS = [
  '/home/z/my-project/mini-services/agent/service.log',
  '/home/z/my-project/mini-services/terminal/service.log',
  '/home/z/tg-tools/watcher/wstdout.log',
  '/home/z/my-project/mini-services/terminal/term-audit.log',
  '/home/z/my-project/.panel/audit.log',
]
const ROTATE_BYTES = 10 * 1024 * 1024
const KEEP_BYTES = 2 * 1024 * 1024

function tailFileInPlace(p: string): void {
  // read the LAST KEEP_BYTES via an fd, then rewrite the file in place —
  // O_APPEND writers keep their offset valid (same inode), so this is safe
  // for logs held open by the services
  try {
    const fd = openSync(p, 'r')
    try {
      const size = fstatSync(fd).size
      if (size <= ROTATE_BYTES) return
      const start = Math.max(0, size - KEEP_BYTES)
      const buf = Buffer.alloc(size - start)
      readSync(fd, buf, 0, buf.length, start)
      writeFileSync(p + '.rotmp', buf)
    } finally {
      closeSync(fd)
    }
    sh('bash', ['-c', `cat "${p}.rotmp" > "${p}" && rm -f "${p}.rotmp"`])
    log(`[housekeeping] rotated ${p}`)
  } catch {
    /* unreadable/missing — skip */
  }
}

function housekeeping(): void {
  for (const p of ROTATE_LOGS) {
    try {
      if (statSync(p).size > ROTATE_BYTES) tailFileInPlace(p)
    } catch { /* missing */ }
  }
  sh('bash', ['-c', 'rm -f /home/z/tg-tools/watcher/.llm_*.json 2>/dev/null || true'])
}

/* ---------------- 5. git commit + push ---------------- */

function gitPush(): { ok: boolean; commit?: string; files: number; error?: string } {
  const add = sh('git', ['add', '-A'], { cwd: MIRROR })
  if (add.code !== 0) return { ok: false, files: 0, error: `git add: ${add.out.slice(-200)}` }
  const status = sh('git', ['status', '--porcelain'], { cwd: MIRROR })
  const files = status.out.split('\n').filter((l) => l.trim()).length
  let token = ''
  try {
    token = readFileSync(TOKEN_FILE, 'utf8').trim()
  } catch {
    return { ok: false, files, error: 'توکن گیت‌هاب موجود نیست (/home/z/.github-token)' }
  }
  if (!token) return { ok: false, files, error: 'توکن گیت‌هاب خالی است' }
  const msg = `بکاپ ۳۰ دقیقه‌ای ${tehranStamp()} تهران — ${files} فایل تغییر کرد`
  const commit = sh('git', ['commit', '-m', msg, '--allow-empty'], { cwd: MIRROR })
  if (commit.code !== 0) return { ok: false, files, error: `git commit: ${commit.out.slice(-200)}` }
  const rev = sh('git', ['rev-parse', 'main'], { cwd: MIRROR }).out.trim()
  // one-off authenticated URL — the token is NEVER stored in .git/config or any file
  const url = `${PUSH_URL_BASE}${token}${REPO_PUSH_PATH}`
  const push = sh('git', ['push', url, 'main:main'], { cwd: MIRROR, timeoutMs: 300_000 })
  if (push.code !== 0) return { ok: false, files, commit: rev, error: `git push: ${push.out.slice(-400)}` }
  const remote = sh('git', ['ls-remote', url, 'refs/heads/main'], { cwd: MIRROR, timeoutMs: 60_000 }).out.split('\t')[0].trim()
  if (remote !== rev) return { ok: false, files, commit: rev, error: `تأیید ریموت ناموفق: ${remote.slice(0, 12)} != ${rev.slice(0, 12)}` }
  return { ok: true, files, commit: rev }
}

/* ---------------- backup log (inside the repo) ---------------- */

function appendBackupLog(entry: HistoryEntry): void {
  const p = path.join(MIRROR, 'BACKUP-LOG.md')
  const head = `# تاریخچهٔ بکاپ ۳۰ دقیقه‌ای\n\n| زمان (تهران) | نوع | نتیجه | کامیت | فایل‌ها | سلامت | مدت |\n|---|---|---|---|---|---|---|\n`
  let cur = ''
  try { cur = readFileSync(p, 'utf8') } catch { /* new */ }
  // keep only real data rows (dates) — filter out header rows of previous
  // heads too, otherwise every run re-appends one more duplicated header
  const lines = cur.split('\n').filter((l) => l.startsWith('| 2'))
  const row = `| ${tehranStamp()} | ${entry.trigger} | ${entry.ok ? '✓' : '✗ ' + (entry.error || '').slice(0, 60)} | ${(entry.commit || '—').slice(0, 7)} | ${entry.files ?? '—'} | lint${entry.lint ? '✓' : '✗'} tsc${entry.tsc ? '✓' : '✗'} build${entry.build ? '✓' : '✗'} | ${Math.round((entry.durMs || 0) / 1000)}s |`
  const rows = [...lines, row].slice(-240)
  writeFileSync(p, `${head}${rows.join('\n')}\n`, 'utf8')
}

/* ---------------- the pipeline ---------------- */

export async function runBackup(trigger: 'hourly' | 'manual' | 'boot'): Promise<HistoryEntry> {
  if (state.running) {
    log(`[${trigger}] skipped — a backup is already running`)
    return { at: new Date().toISOString(), trigger, ok: false, error: 'اجرای قبلی هنوز در جریانه' }
  }
  const t0 = Date.now()
  setState({ running: true, lastRunAt: new Date().toISOString() })
  const entry: HistoryEntry = { at: new Date().toISOString(), trigger, ok: false }
  log(`[${trigger}] backup started`)
  try {
    syncAll()
    const checks = healthChecks()
    entry.lint = checks.lint
    entry.tsc = checks.tsc
    entry.build = checks.build
    housekeeping()
    writeFileSync(path.join(MIRROR, 'server', 'SERVER-STATE.md'), serverStateDoc(checks), 'utf8')
    const push = gitPush()
    entry.files = push.files
    entry.commit = push.commit
    if (!push.ok) throw new Error(push.error || 'push ناموفق')
    entry.ok = true
    entry.durMs = Date.now() - t0
    setState({ lastOkAt: new Date().toISOString(), lastError: null, lastCommit: push.commit || '' })
    log(`[${trigger}] OK — commit ${(push.commit || '').slice(0, 7)}, ${push.files} files, ${Math.round(entry.durMs / 1000)}s`)
  } catch (e) {
    entry.ok = false
    entry.error = e instanceof Error ? e.message : String(e)
    entry.durMs = Date.now() - t0
    setState({ lastError: entry.error })
    log(`[${trigger}] FAILED — ${entry.error}`)
  } finally {
    setState({
      running: false,
      history: [...state.history, entry].slice(-48),
    })
    appendBackupLog(entry)
  }
  return entry
}

/* standalone CLI: bun run-backup.ts --once [--trigger hourly|boot|manual] */
if (process.argv.includes('--once')) {
  const ti = process.argv.indexOf('--trigger')
  const triggerArg = ti >= 0 ? process.argv[ti + 1] : 'manual'
  const trigger: 'hourly' | 'manual' | 'boot' =
    triggerArg === 'hourly' || triggerArg === 'boot' ? triggerArg : 'manual'
  runBackup(trigger).then((r) => {
    log(`[cli] result: ok=${r.ok}${r.error ? ' err=' + r.error : ''}`)
    process.exit(r.ok ? 0 : 1)
  })
}
