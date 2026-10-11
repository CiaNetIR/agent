/**
 * VPN STAR panel — server-side helpers (node runtime only).
 * Shared by all /api/panel/* routes.
 */
import { createHash, timingSafeEqual } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import path from 'path'

export const PANEL_ENV = '/home/z/my-project/.secrets/panel.env'
export const WATCHER_DIR = '/home/z/tg-tools/watcher'
export const TG_TOOLS = '/home/z/tg-tools'
export const MANUAL_PATH = '/home/z/my-project/tg-tools-backup/Z-OWNER-MANUAL.md'
export const BACKUP_TRIGGER = path.join(WATCHER_DIR, 'BACKUP_NOW')

export interface PanelConfig {
  sha256: string
  termEnabled: boolean
}

export function readPanelConfig(): PanelConfig {
  try {
    const raw = readFileSync(PANEL_ENV, 'utf8')
    const cfg: Record<string, string> = {}
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) cfg[m[1]] = m[2]
    }
    return {
      sha256: (cfg.PANEL_PASSWORD_SHA256 || '').toLowerCase(),
      termEnabled: cfg.PANEL_TERM !== '0',
    }
  } catch {
    return { sha256: '', termEnabled: false }
  }
}

/** timing-safe sha256 hex comparison */
export function verifyKey(hashHex: unknown): boolean {
  const want = readPanelConfig().sha256
  const got = String(hashHex || '').toLowerCase().trim()
  if (!want || !/^[0-9a-f]{64}$/.test(got)) return false
  try {
    return timingSafeEqual(Buffer.from(want, 'hex'), Buffer.from(got, 'hex'))
  } catch {
    return false
  }
}

/* ---------- auth rate limiting (global, in-memory) ---------- */
const MAX_FAILS = 5
const LOCK_MS = 5 * 60 * 1000
let failCount = 0
let lockedUntil = 0

export function isLocked(): number {
  return Math.max(0, Math.ceil((lockedUntil - Date.now()) / 1000))
}

export function registerFail(): number {
  failCount += 1
  if (failCount >= MAX_FAILS) {
    lockedUntil = Date.now() + LOCK_MS
    failCount = 0
  }
  return Math.max(0, MAX_FAILS - failCount)
}

export function registerSuccess() {
  failCount = 0
  lockedUntil = 0
}

/* ---------- small fs helpers ---------- */
export function pidAlive(pidPath: string): { alive: boolean; pid: number | null } {
  try {
    const pid = parseInt(readFileSync(pidPath, 'utf8').trim(), 10)
    if (!Number.isFinite(pid)) return { alive: false, pid: null }
    process.kill(pid, 0) // throws if dead
    return { alive: true, pid }
  } catch {
    return { alive: false, pid: null }
  }
}

/** watcher process uptime in seconds (from /proc), null if unknown */
export function pidUptime(pid: number | null): number | null {
  if (!pid) return null
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    // field 22 (1-indexed) = starttime in clock ticks; comm may contain spaces
    const afterParen = stat.slice(stat.lastIndexOf(')') + 2)
    const fields = afterParen.split(' ')
    // fields[0] is field 3 (state); starttime = field 22 -> index 19
    const startTimeTicks = parseFloat(fields[19])
    const up = parseFloat(readFileSync('/proc/uptime', 'utf8').split(' ')[0])
    const hz = 100 // Linux USER_HZ default
    const secs = up - startTimeTicks / hz
    return Number.isFinite(secs) && secs > 0 ? Math.floor(secs) : null
  } catch {
    return null
  }
}

export function readJsonSafe<T>(p: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as T
  } catch {
    return fallback
  }
}

export function fileExists(p: string): boolean {
  return existsSync(p)
}
