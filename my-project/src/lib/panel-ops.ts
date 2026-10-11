/**
 * VPN STAR panel — shared ops helpers for the v7 routes
 * (llm-settings POST, llm-chat, accounts, system, password).
 * node runtime only.
 */
import { appendFileSync, mkdirSync, rmSync, writeFileSync, renameSync } from 'fs'
import { execFile } from 'child_process'
import os from 'os'
import path from 'path'

const HOME = process.env.HOME || os.homedir() || '/root'
export const PROJECT_DIR = process.env.PROJECT_DIR || path.join(HOME, 'my-project')
export const PANEL_DIR = path.join(PROJECT_DIR, '.panel')
export const AUDIT_LOG = path.join(PANEL_DIR, 'audit.log')
/** survives project deletion — destructive actions are logged here too */
export const SYSTEM_LOG = path.join(HOME, 'system-actions.log')

export const TG_TOOLS = path.join(HOME, 'tg-tools')
export const WATCHER_DIR = path.join(TG_TOOLS, 'watcher')
export const INSTANCES_DIR = path.join(TG_TOOLS, 'instances')
export const INSTANCES_CTL = path.join(TG_TOOLS, 'instances_ctl.sh')
export const WATCHER_CTL = path.join(WATCHER_DIR, 'watcher_ctl.sh')
export const TERM_DIR = path.join(PROJECT_DIR, 'mini-services', 'terminal')
export const TERM_CTL = path.join(TERM_DIR, 'term_ctl.sh')
export const WATCHER_CONFIG = path.join(PROJECT_DIR, '.secrets', 'watcher-config.json')

export function audit(event: string, extra = '') {
  try {
    mkdirSync(PANEL_DIR, { recursive: true })
    appendFileSync(AUDIT_LOG, `${new Date().toISOString()} ${event} ${extra}\n`, 'utf8')
  } catch {
    /* noop */
  }
}

export function systemAudit(event: string, extra = '') {
  try {
    appendFileSync(SYSTEM_LOG, `${new Date().toISOString()} ${event} ${extra}\n`, 'utf8')
  } catch {
    /* noop */
  }
}

export function run(
  script: string,
  args: string[],
  timeoutMs = 25_000
): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    // Pass through env + add TELEGRAM_PROXY from tg.env (for watcher scripts)
    const env = { ...process.env } as Record<string, string>
    try {
      const HOME = process.env.HOME || '/root'
      const tgEnvPath = `${HOME}/my-project/.secrets/tg.env`
      const tgEnv = readFileSync(tgEnvPath, 'utf8')
      for (const line of tgEnv.split('\n')) {
        const m = line.match(/^TELEGRAM_PROXY=(.+)$/)
        if (m) { env.TELEGRAM_PROXY = m[1].trim().replace(/^["']|["']$/g, ''); break }
      }
    } catch { /* no tg.env */ }
    execFile(
      'bash',
      [script, ...args],
      { timeout: timeoutMs, maxBuffer: 1024 * 1024, env },
      (err, stdout, stderr) => {
        const out = `${stdout || ''}${stderr ? '\n' + stderr : ''}`.trim().slice(-1500)
        resolve({ ok: !err, out })
      }
    )
  })
}

/** atomic json write with owner-only permissions */
export function writeJsonAtomic(p: string, data: unknown, mode = 0o600) {
  const tmp = `${p}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', { encoding: 'utf8', mode })
  renameSync(tmp, p)
}

/** atomic text write with owner-only permissions */
export function writeTextAtomic(p: string, text: string, mode = 0o600) {
  const tmp = `${p}.tmp-${process.pid}`
  writeFileSync(tmp, text, { encoding: 'utf8', mode })
  renameSync(tmp, p)
}

/** safe dir removal — refuses anything outside INSTANCES_DIR */
export function rmInstanceDir(id: string): boolean {
  if (!/^[a-z0-9]{20,30}$/i.test(id)) return false
  const dir = path.join(INSTANCES_DIR, id)
  if (path.dirname(dir) !== INSTANCES_DIR) return false
  try {
    rmSync(dir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}
