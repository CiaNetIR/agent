import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'
import os from 'os'
import { verifyKey } from '@/lib/panel-server'
import { audit, systemAudit } from '@/lib/panel-ops'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // 5-minute hard cap — see task UPDATE-FEATURE-1

/**
 * GitHub auto-update — task UPDATE-FEATURE-1.
 *
 * Layout on disk (resolved from process.env.HOME || os.homedir()):
 *   ~/agent-repo              bare-ish clone of github.com/CiaNetIR/agent
 *   ~/agent-repo/my-project   source tree (rsync source)
 *   ~/my-project              live deployment (rsync target, this server's code)
 *
 * GET  — compare local repo HEAD vs github main HEAD, list commits between.
 * POST — confirm:"بروزرسانی" → fetch, reset --hard, rsync, bun install x3,
 *        prisma generate/db push, re-apply auto-login patches, restart services.
 */

const HOME = process.env.HOME || os.homedir()
const REPO_DIR = path.join(HOME, 'agent-repo')
const PROJECT_DIR = path.join(HOME, 'my-project')
const GITHUB_API_COMMIT = 'https://api.github.com/repos/CiaNetIR/agent/commits/main'
const GITHUB_API_COMPARE = 'https://api.github.com/repos/CiaNetIR/agent/compare'

interface CommitInfo {
  sha: string
  message: string
  date: string
  author?: string
}

interface StepResult {
  name: string
  status: 'ok' | 'fail'
  log?: string
}

/* ---------------------------------------------------------------- helpers */

function run(
  cmd: string,
  args: string[],
  timeoutMs = 60_000,
  cwd: string = HOME,
): Promise<{ ok: boolean; out: string; err: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env })
    let stdout = ''
    let stderr = ''
    let timer: ReturnType<typeof setTimeout> | null = null
    let done = false
    const finish = (ok: boolean, code: number | null) => {
      if (done) return
      done = true
      if (timer) clearTimeout(timer)
      resolve({ ok, out: stdout.trim(), err: stderr.trim(), code })
    }
    timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* noop */ }
      finish(false, null)
    }, timeoutMs)
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('close', (code) => finish(code === 0, code))
    child.on('error', () => finish(false, null))
  })
}

/** read HEAD commit info from the local clone */
async function getLocalCommit(): Promise<CommitInfo | null> {
  if (!existsSync(REPO_DIR)) return null
  // %H = full sha, %ad = author date (iso), %s = subject
  const r = await run(
    'git',
    ['-C', REPO_DIR, 'log', '--pretty=format:%H|%ad|%s', '--date=iso', '-1'],
    15_000,
  )
  if (!r.ok || !r.out) return null
  const [sha, date, ...msgParts] = r.out.split('|')
  if (!sha || !date) return null
  return {
    sha: sha.trim(),
    date: date.trim(),
    message: msgParts.join('|').trim(),
  }
}

/** read latest commit on main from github (unauthenticated — public repo) */
async function getLatestCommit(): Promise<CommitInfo | null> {
  try {
    const res = await fetch(GITHUB_API_COMMIT, {
      headers: {
        'user-agent': 'cia-net-panel/1.0',
        accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const j = (await res.json()) as {
      sha?: string
      commit?: {
        message?: string
        author?: { date?: string; name?: string }
      }
      author?: { login?: string }
    }
    if (!j.sha) return null
    return {
      sha: j.sha,
      message: (j.commit?.message || '').split('\n')[0].trim(),
      date: j.commit?.author?.date || '',
      author: j.commit?.author?.name || j.author?.login || '',
    }
  } catch {
    return null
  }
}

/** list commits strictly between two SHAs (exclusive on the low end) */
async function getCommitsBetween(
  currentSha: string,
  latestSha: string,
): Promise<CommitInfo[]> {
  if (!currentSha || !latestSha || currentSha === latestSha) return []
  try {
    const url = `${GITHUB_API_COMPARE}/${currentSha}...${latestSha}`
    const res = await fetch(url, {
      headers: {
        'user-agent': 'cia-net-panel/1.0',
        accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(20_000),
    })
    if (!res.ok) return []
    const j = (await res.json()) as {
      commits?: Array<{
        sha?: string
        commit?: {
          message?: string
          author?: { date?: string; name?: string }
        }
        author?: { login?: string }
      }>
    }
    const list = j.commits || []
    // drop the first entry — that's `currentSha` itself (compare base)
    return list.slice(1).map((c) => ({
      sha: (c.sha || '').slice(0, 7),
      message: (c.commit?.message || '').split('\n')[0].trim(),
      date: c.commit?.author?.date || '',
      author: c.commit?.author?.name || c.author?.login || '',
    }))
  } catch {
    return []
  }
}

/* ----------------------- auto-login patches (idempotent) ---------------
 * After `git reset --hard` + rsync, the live tree may have the *upstream*
 * versions of panel-server.ts / agent/lib.ts / LockScreen.tsx — which
 * actually enforce the panel password. quick-install.sh re-applies the
 * "always-true" patches so the panel keeps logging in without a password.
 *
 * We do this in-process (no shell sed) so it's deterministic and works
 * whether or not the upstream version is already patched. Brace-counting
 * replaceFunction keeps the patch surgical. */

function replaceFunction(
  content: string,
  fnSignature: string,
  newBody: string,
): string {
  const startIdx = content.indexOf(fnSignature)
  if (startIdx === -1) return content
  // find the first `{` after the signature — that opens the function body
  let i = content.indexOf('{', startIdx)
  if (i === -1) return content
  let depth = 0
  while (i < content.length) {
    const ch = content[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        return content.slice(0, startIdx) + newBody + content.slice(i + 1)
      }
    }
    i++
  }
  return content
}

const PATCHED_LOCKSCREEN = `'use client'

import { useEffect, useRef } from 'react'
import { Loader2, Star } from 'lucide-react'

export default function LockScreen({ onUnlock }: { onUnlock: (key: string) => void }) {
  const attempted = useRef(false)
  useEffect(() => {
    if (attempted.current) return
    attempted.current = true
    ;(async () => {
      try {
        const res = await fetch('/api/panel/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'open' }) })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.ok) onUnlock(data.sessionToken || 'open-session')
        else setTimeout(() => { attempted.current = false }, 2000)
      } catch { setTimeout(() => { attempted.current = false }, 2000) }
    })()
  }, [onUnlock])
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4">
      <div className="ci-card w-full max-w-sm rounded-2xl bg-[#181A1F]/80 p-8 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-400/20 to-emerald-500/20 ring-1 ring-amber-400/40">
          <Star className="h-8 w-8 fill-amber-400 text-amber-400" />
        </div>
        <h1 className="mb-2 text-xl font-bold text-zinc-100">پنل مدیریت <span className="text-amber-400">Z</span></h1>
        <p className="mb-6 text-xs text-zinc-400">فروشگاه VPN | STAR — فقط مالک</p>
        <div className="flex items-center justify-center gap-2 text-zinc-300">
          <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">در حال ورود…</span>
        </div>
      </div>
    </div>
  )
}
`

function applyAutoLoginPatches(): { ok: boolean; applied: string[]; err?: string } {
  const applied: string[] = []
  try {
    /* 1. panel-server.ts → verifyKey always returns true */
    const psPath = path.join(PROJECT_DIR, 'src/lib/panel-server.ts')
    if (existsSync(psPath)) {
      const ps = readFileSync(psPath, 'utf8')
      const already = /export function verifyKey\([\s\S]*?\breturn true\b[\s\S]*?\n\}/.test(ps)
      if (!already) {
        const newBody =
          'export function verifyKey(hashHex: unknown): boolean {\n' +
          '  registerSuccess()\n' +
          '  return true\n' +
          '}'
        const patched = replaceFunction(ps, 'export function verifyKey', newBody)
        if (patched !== ps) {
          writeFileSync(psPath, patched, 'utf8')
          applied.push('panel-server.ts:verifyKey')
        }
      }
    }

    /* 2. agent/lib.ts → checkPanelAuth always returns true */
    const agPath = path.join(PROJECT_DIR, 'mini-services/agent/lib.ts')
    if (existsSync(agPath)) {
      const ag = readFileSync(agPath, 'utf8')
      const already = /export function checkPanelAuth\([\s\S]*?\breturn true\b[\s\S]*?\n\}/.test(ag)
      if (!already) {
        const newBody =
          'export function checkPanelAuth(key: string | undefined): boolean {\n' +
          '  return true\n' +
          '}'
        const patched = replaceFunction(ag, 'export function checkPanelAuth', newBody)
        if (patched !== ag) {
          writeFileSync(agPath, patched, 'utf8')
          applied.push('agent/lib.ts:checkPanelAuth')
        }
      }
    }

    /* 3. LockScreen.tsx → auto-login (no password prompt) */
    const lsPath = path.join(PROJECT_DIR, 'src/components/panel/LockScreen.tsx')
    if (existsSync(lsPath)) {
      const ls = readFileSync(lsPath, 'utf8')
      if (!ls.includes("JSON.stringify({ key: 'open' })")) {
        writeFileSync(lsPath, PATCHED_LOCKSCREEN, 'utf8')
        applied.push('LockScreen.tsx')
      }
    }

    return { ok: true, applied }
  } catch (e) {
    return { ok: false, applied, err: String(e) }
  }
}

/* ------------------------------------------------------------------ GET */

export async function GET(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const [current, latest] = await Promise.all([getLocalCommit(), getLatestCommit()])

  const updateAvailable = !!(current && latest && current.sha !== latest.sha)
  let commits: CommitInfo[] = []
  if (updateAvailable && current && latest) {
    commits = await getCommitsBetween(current.sha, latest.sha)
  }

  return NextResponse.json({
    ok: true,
    repoMissing: !existsSync(REPO_DIR),
    repoDir: REPO_DIR,
    current,
    latest,
    updateAvailable,
    commits,
  })
}

/* ----------------------------------------------------------------- POST */

export async function POST(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let body: { confirm?: string }
  try {
    body = (await req.json()) as { confirm?: string }
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400 })
  }

  if (String(body.confirm || '').trim() !== 'بروزرسانی') {
    return NextResponse.json(
      { ok: false, error: 'برای تأیید باید عیناً بنویسی: بروزرسانی' },
      { status: 400 },
    )
  }

  if (!existsSync(REPO_DIR)) {
    return NextResponse.json(
      {
        ok: false,
        error: `مسیر کلون گیتهاب پیدا نشد: ${REPO_DIR}. اول روی سرور git clone https://github.com/CiaNetIR/agent.git ~/agent-repo رو اجرا کن.`,
      },
      { status: 400 },
    )
  }

  audit('update_start', '')
  systemAudit('update_start', '')

  const steps: StepResult[] = []

  const runStep = async (
    name: string,
    fn: () => Promise<{ ok: boolean; log?: string }>,
  ): Promise<boolean> => {
    try {
      const r = await fn()
      steps.push({ name, status: r.ok ? 'ok' : 'fail', log: r.log })
      return r.ok
    } catch (e) {
      steps.push({ name, status: 'fail', log: String(e) })
      return false
    }
  }

  /* 1. git fetch */
  const s1 = await runStep('fetch origin main', async () => {
    const r = await run('git', ['-C', REPO_DIR, 'fetch', 'origin', 'main'], 120_000)
    return { ok: r.ok, log: (r.err || r.out).slice(-400) }
  })
  if (!s1) return finishUpdate(false, steps, 'fetch failed')

  /* 2. git reset --hard FETCH_HEAD */
  const s2 = await runStep('reset --hard FETCH_HEAD', async () => {
    const r = await run('git', ['-C', REPO_DIR, 'reset', '--hard', 'FETCH_HEAD'], 60_000)
    return { ok: r.ok, log: r.out.slice(-400) }
  })
  if (!s2) return finishUpdate(false, steps, 'reset failed')

  /* 3. rsync repo→project (excluding build/runtime dirs) */
  const s3 = await runStep('rsync code to project dir', async () => {
    const args = [
      '-a', '--delete',
      '--exclude', 'node_modules',
      '--exclude', '.next',
      '--exclude', '.git',
      '--exclude', 'upload',
      '--exclude', 'dev.log',
      '--exclude', 'tool-results',
      `${REPO_DIR}/my-project/`,
      `${PROJECT_DIR}/`,
    ]
    const r = await run('rsync', args, 120_000)
    return { ok: r.ok, log: (r.err || r.out).slice(-400) }
  })
  if (!s3) return finishUpdate(false, steps, 'rsync failed')

  /* 4. bun install (root) */
  const s4 = await runStep('bun install (root)', async () => {
    const r = await run('bun', ['install'], 180_000, PROJECT_DIR)
    return { ok: r.ok, log: (r.err || r.out).slice(-400) }
  })
  if (!s4) return finishUpdate(false, steps, 'root bun install failed')

  /* 5. bun install (agent) */
  const s5 = await runStep('bun install (agent)', async () => {
    const r = await run('bun', ['install'], 120_000, path.join(PROJECT_DIR, 'mini-services/agent'))
    return { ok: r.ok, log: (r.err || r.out).slice(-400) }
  })
  if (!s5) return finishUpdate(false, steps, 'agent bun install failed')

  /* 6. bun install (terminal) */
  const s6 = await runStep('bun install (terminal)', async () => {
    const r = await run('bun', ['install'], 120_000, path.join(PROJECT_DIR, 'mini-services/terminal'))
    return { ok: r.ok, log: (r.err || r.out).slice(-400) }
  })
  if (!s6) return finishUpdate(false, steps, 'terminal bun install failed')

  /* 7. prisma generate */
  const s7 = await runStep('prisma generate', async () => {
    const r = await run('bunx', ['prisma', 'generate'], 120_000, PROJECT_DIR)
    return { ok: r.ok, log: (r.err || r.out).slice(-400) }
  })
  if (!s7) return finishUpdate(false, steps, 'prisma generate failed')

  /* 8. prisma db push --accept-data-loss */
  const s8 = await runStep('prisma db push', async () => {
    const r = await run(
      'bunx',
      ['prisma', 'db', 'push', '--accept-data-loss'],
      120_000,
      PROJECT_DIR,
    )
    return { ok: r.ok, log: (r.err || r.out).slice(-400) }
  })
  if (!s8) return finishUpdate(false, steps, 'prisma db push failed')

  /* 9. apply auto-login patches */
  const s9 = await runStep('apply auto-login patches', async () => {
    const p = applyAutoLoginPatches()
    return {
      ok: p.ok,
      log: p.ok
        ? (p.applied.length ? p.applied.join(', ') : 'already patched')
        : p.err,
    }
  })
  if (!s9) return finishUpdate(false, steps, 'auto-login patches failed')

  /* 10. restart services — detached, after 3s delay so THIS response can go out.
   * The kill uses [x] char-classes so the spawn's own cmdline never
   * self-matches (same trick as system/route.ts power-off-server). After
   * kill, panel-supervisor.sh will resurrect the dev server within ~90s. */
  const restartScript = [
    `sleep 3`,
    `rm -rf ${shellQuote(path.join(PROJECT_DIR, '.next'))}`,
    `pkill -f "next de[v]" 2>/dev/null || true`,
    `pkill -f "next-serve[r]" 2>/dev/null || true`,
    `sleep 2`,
    `cd ${shellQuote(PROJECT_DIR)} && setsid nohup bun run dev >/dev/null 2>&1 </dev/null &`,
    `bash ${shellQuote(path.join(PROJECT_DIR, 'mini-services/agent/agent_ctl.sh'))} restart 2>&1 || true`,
    `bash ${shellQuote(path.join(PROJECT_DIR, 'mini-services/terminal/term_ctl.sh'))} restart 2>&1 || true`,
  ].join(' && ')

  const s10 = await runStep('restart services', async () => {
    const child = spawn('bash', ['-c', restartScript], {
      detached: true,
      stdio: 'ignore',
    })
    child.unref()
    if (!child.pid) return { ok: false, log: 'could not spawn restart script' }
    return { ok: true, log: `restart scheduled (detached pid ${child.pid})` }
  })
  if (!s10) return finishUpdate(false, steps, 'restart scheduling failed')

  return finishUpdate(true, steps, '')
}

function shellQuote(s: string): string {
  // safe single-quote — escape embedded single quotes
  return "'" + s.replace(/'/g, "'\\''") + "'"
}

function finishUpdate(ok: boolean, steps: StepResult[], errMsg: string) {
  const event = ok ? 'update_done' : 'update_fail'
  audit(event, errMsg)
  systemAudit(event, errMsg)

  if (ok) {
    return NextResponse.json({
      ok: true,
      steps,
      note: 'بروزرسانی کامل شد. پنل در حال راه‌اندازی مجدده — چند ثانیه دیگه صفحه رو رفرش کن.',
    })
  }
  return NextResponse.json(
    { ok: false, error: errMsg, steps },
    { status: 500 },
  )
}
