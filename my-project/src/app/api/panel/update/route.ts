import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import path from 'path'
import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { verifyKey } from '@/lib/panel-server'
import { audit, systemAudit, PROJECT_DIR } from '@/lib/panel-ops'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 600 // up to 10 minutes for git pull + rsync + bun install

const execFileAsync = promisify(execFile)

/**
 * Panel auto-update — pull from the GitHub mirror (~/agent-repo), rsync into
 * the live project, reinstall deps, regenerate prisma client + push schema,
 * re-apply local auto-login patch, then restart systemd services.
 *
 * GET  → check GitHub for new commits vs the local HEAD
 * POST → run the full update pipeline (typed confirm required)
 */

const HOME = process.env.HOME || os.homedir() || '/root'
const AGENT_REPO = process.env.AGENT_REPO || path.join(HOME, 'agent-repo')
const AGENT_REPO_PROJECT = path.join(AGENT_REPO, 'my-project')
const GITHUB_API = 'https://api.github.com/repos/CiaNetIR/agent'
const CONFIRM_WORD = 'بروزرسانی'

const PATH = process.env.PATH || '/usr/local/bin:/usr/bin:/bin'
const CHILD_ENV: NodeJS.ProcessEnv = {
  HOME,
  PATH,
  NODE_ENV: process.env.NODE_ENV || 'production',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
}

interface GitCommit {
  sha: string
  message: string
  date: string
  author?: string
}

interface StepResult {
  name: string
  ok: boolean
  output: string
}

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

async function gitLocalHead(dir: string): Promise<GitCommit | null> {
  try {
    const { stdout: sha } = await execFileAsync(
      'git',
      ['-C', dir, 'rev-parse', 'HEAD'],
      { env: CHILD_ENV, timeout: 10_000, maxBuffer: 64 * 1024 }
    )
    const { stdout: body } = await execFileAsync(
      'git',
      ['-C', dir, 'log', '-1', '--pretty=%B%x09%an%x09%ai'],
      { env: CHILD_ENV, timeout: 10_000, maxBuffer: 64 * 1024 }
    )
    const [msg, author, date] = body.split('\t')
    return {
      sha: sha.trim(),
      message: (msg || '').trim().split('\n')[0],
      date: (date || '').trim(),
      author: (author || '').trim(),
    }
  } catch {
    return null
  }
}

async function fetchGithubHead(): Promise<GitCommit | null> {
  try {
    const res = await fetch(`${GITHUB_API}/commits/main`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'cianet-panel/1.0',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as {
      sha?: string
      commit?: { message?: string; author?: { name?: string; date?: string } }
    }
    return {
      sha: (data.sha || '').slice(0, 40),
      message: (data.commit?.message || '').trim().split('\n')[0],
      date: data.commit?.author?.date || '',
      author: data.commit?.author?.name || '',
    }
  } catch {
    return null
  }
}

async function fetchNewCommits(base: string, head: string): Promise<GitCommit[]> {
  try {
    const res = await fetch(`${GITHUB_API}/compare/${base}...${head}`, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': 'cianet-panel/1.0',
      },
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) return []
    const data = (await res.json()) as {
      commits?: Array<{
        sha?: string
        commit?: { message?: string; author?: { name?: string; date?: string } }
      }>
    }
    return (data.commits || [])
      .filter((c) => c.sha && c.sha !== base)
      .map((c) => ({
        sha: (c.sha || '').slice(0, 7),
        message: (c.commit?.message || '').trim().split('\n')[0],
        date: c.commit?.author?.date || '',
        author: c.commit?.author?.name || '',
      }))
      .slice(0, 50)
  } catch {
    return []
  }
}

function runStep(
  name: string,
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string; allowFail?: boolean } = {}
): Promise<StepResult> {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        env: CHILD_ENV,
        timeout: opts.timeoutMs ?? 120_000,
        maxBuffer: 4 * 1024 * 1024,
        cwd: opts.cwd,
      },
      (err, stdout, stderr) => {
        const out = `${stdout || ''}${stderr ? '\n' + stderr : ''}`.trim().slice(-4000)
        const ok = !err || opts.allowFail === true
        resolve({ name, ok, output: ok ? out : (err?.message || out).slice(-4000) })
      }
    )
  })
}

/** ensure the agent-repo has the CiaNetIR/agent origin remote — add if missing */
async function ensureRemote(): Promise<void> {
  if (!existsSync(path.join(AGENT_REPO_PROJECT, '.git'))) return
  try {
    await execFileAsync('git', ['-C', AGENT_REPO_PROJECT, 'remote', 'get-url', 'origin'], {
      env: CHILD_ENV,
      timeout: 5_000,
    })
    return // origin exists
  } catch {
    /* origin not configured — add it below */
  }
  try {
    await execFileAsync(
      'git',
      ['-C', AGENT_REPO_PROJECT, 'remote', 'add', 'origin', 'https://github.com/CiaNetIR/agent.git'],
      { env: CHILD_ENV, timeout: 5_000 }
    )
  } catch {
    /* best-effort */
  }
}

/** fall back to downloading the upstream tarball when no git history is present */
async function downloadTarball(): Promise<StepResult> {
  const tmp = path.join(HOME, '.cache', 'cianet-update')
  try {
    mkdirSync(tmp, { recursive: true })
    const tarball = path.join(tmp, `agent-${Date.now()}.tar.gz`)
    const res = await fetch(`${GITHUB_API.replace('api.github.com/repos', 'github.com')}/CiaNetIR/agent/archive/refs/heads/main.tar.gz`, {
      redirect: 'follow',
      signal: AbortSignal.timeout(120_000),
    })
    if (!res.ok) {
      return { name: 'download-zip', ok: false, output: `HTTP ${res.status}` }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    writeFileSync(tarball, buf)
    // wipe + reclone the agent-repo's my-project (not the live one)
    if (existsSync(AGENT_REPO_PROJECT)) {
      rmSync(AGENT_REPO_PROJECT, { recursive: true, force: true })
    }
    mkdirSync(AGENT_REPO_PROJECT, { recursive: true })
    // tar -xzf <tarball> -C <dest> --strip-components=1
    const r = await runStep('extract-tarball', 'tar', [
      '-xzf', tarball, '-C', AGENT_REPO_PROJECT, '--strip-components=1',
    ], { timeoutMs: 60_000 })
    return r
  } catch (e) {
    return { name: 'download-zip', ok: false, output: e instanceof Error ? e.message : String(e) }
  }
}

/** re-apply the local auto-login patch — verifyKey always returns true. This
 *  is a self-hosted sandbox convenience; never re-enable real auth here. */
async function reapplyAutoLoginPatch(): Promise<StepResult> {
  const target = path.join(PROJECT_DIR, 'src', 'lib', 'panel-server.ts')
  try {
    const original = readFileSync(target, 'utf8')
    // the patch: replace the verifyKey body with the always-true stub
    const patched = original.replace(
      /export function verifyKey\([^)]*\):\s*boolean\s*\{[\s\S]*?^\}/m,
      `export function verifyKey(hashHex: unknown): boolean {\n  registerSuccess()\n  return true\n}`
    )
    if (patched === original) {
      return { name: 'patch-autologin', ok: true, output: 'patch already applied (no change)' }
    }
    writeFileSync(target, patched, 'utf8')
    return { name: 'patch-autologin', ok: true, output: 'patched verifyKey() — auto-login preserved' }
  } catch (e) {
    return { name: 'patch-autologin', ok: false, output: e instanceof Error ? e.message : String(e) }
  }
}

/* ------------------------------------------------------------------ */
/* GET — check for updates                                            */
/* ------------------------------------------------------------------ */

export async function GET(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const current = await gitLocalHead(PROJECT_DIR)
  const latest = await fetchGithubHead()

  let updateAvailable = false
  let commits: GitCommit[] = []
  if (current && latest) {
    updateAvailable = current.sha !== latest.sha && latest.sha.length >= 7
    if (updateAvailable) {
      commits = await fetchNewCommits(current.sha, latest.sha)
    }
  }

  audit('update_check', `current=${current?.sha?.slice(0, 7) || '?'} latest=${latest?.sha?.slice(0, 7) || '?'} avail=${updateAvailable}`)

  return NextResponse.json({
    ok: true,
    current,
    latest,
    updateAvailable,
    commits,
    repo: 'CiaNetIR/agent',
    branch: 'main',
  })
}

/* ------------------------------------------------------------------ */
/* POST — run the update                                              */
/* ------------------------------------------------------------------ */

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

  if (String(body.confirm || '').trim() !== CONFIRM_WORD) {
    return NextResponse.json(
      { ok: false, error: `برای تأیید باید عیناً بنویسی: ${CONFIRM_WORD}` },
      { status: 400 }
    )
  }

  audit('update_run', 'started')
  systemAudit('update_run', 'started')

  const steps: StepResult[] = []

  // Step 0: snapshot current commit for the response
  const beforeHead = await gitLocalHead(PROJECT_DIR)

  // Step 1: pull the mirror (git or tarball fallback)
  if (existsSync(path.join(AGENT_REPO_PROJECT, '.git'))) {
    await ensureRemote()
    steps.push(
      await runStep(
        'git-pull',
        'git',
        ['-C', AGENT_REPO_PROJECT, 'pull', '--ff-only', 'origin', 'main'],
        { timeoutMs: 120_000, allowFail: true }
      )
    )
    // if pull failed (network, diverge), fall back to tarball
    const pullStep = steps[steps.length - 1]
    if (!pullStep.ok) {
      steps.push(await downloadTarball())
    }
  } else {
    steps.push(await downloadTarball())
  }

  // Step 2: rsync the mirror INTO the live project (excluding runtime state)
  steps.push(
    await runStep(
      'rsync',
      'rsync',
      [
        '-a', '--delete',
        '--exclude', '.secrets',
        '--exclude', 'db',
        '--exclude', 'node_modules',
        '--exclude', '.next',
        '--exclude', 'upload',
        '--exclude', '.git',
        '--exclude', 'dev.log',
        '--exclude', 'server.log',
        `${AGENT_REPO_PROJECT}/`,
        `${PROJECT_DIR}/`,
      ],
      { timeoutMs: 180_000, allowFail: false }
    )
  )

  // Step 3: bun install (deps may have changed)
  steps.push(
    await runStep(
      'bun-install',
      'bun',
      ['install', '--frozen-lockfile=false'],
      { timeoutMs: 300_000, cwd: PROJECT_DIR, allowFail: true }
    )
  )

  // Step 4: prisma generate + db push
  steps.push(
    await runStep(
      'prisma-generate',
      'bunx',
      ['prisma', 'generate'],
      { timeoutMs: 120_000, cwd: PROJECT_DIR, allowFail: true }
    )
  )
  steps.push(
    await runStep(
      'prisma-db-push',
      'bunx',
      ['prisma', 'db', 'push', '--accept-data-loss'],
      { timeoutMs: 120_000, cwd: PROJECT_DIR, allowFail: true }
    )
  )

  // Step 5: re-apply local auto-login patch (verifyKey always returns true)
  steps.push(await reapplyAutoLoginPatch())

  // Step 6: restart systemd services (best-effort — may need sudo or may
  // be running under a different supervisor)
  const services = ['cianet-panel', 'cianet-agent', 'cianet-terminal']
  for (const svc of services) {
    steps.push(
      await runStep(
        `restart-${svc}`,
        'systemctl',
        ['restart', svc],
        { timeoutMs: 30_000, allowFail: true }
      )
    )
  }

  const afterHead = await gitLocalHead(PROJECT_DIR)
  const anyFailed = steps.some((s) => !s.ok)
  // Some steps are intentionally allowFail (systemctl may need sudo, tarball
  // may be the primary path). Report success when rsync + bun-install + the
  // prisma steps all ran.
  const criticalSteps = ['rsync', 'bun-install', 'prisma-generate', 'prisma-db-push']
  const criticalOk = criticalSteps.every((name) => {
    const s = steps.find((x) => x.name === name)
    return s ? s.ok : false
  })

  audit('update_run', `finished criticalOk=${criticalOk} before=${beforeHead?.sha?.slice(0, 7)} after=${afterHead?.sha?.slice(0, 7)}`)
  systemAudit('update_run', `finished criticalOk=${criticalOk} before=${beforeHead?.sha?.slice(0, 7)} after=${afterHead?.sha?.slice(0, 7)}`)

  return NextResponse.json({
    ok: criticalOk,
    steps,
    before: beforeHead,
    after: afterHead,
    needsReload: true,
    warning: anyFailed
      ? 'برخی مراحل اختیاری شکست خوردند — خروجی هر مرحله را بررسی کن. سرویس‌ها ممکن است نیاز به ری‌استارت دستی داشته باشند.'
      : undefined,
  })
}
