/**
 * VPN STAR panel — client helpers.
 */

export const PANEL_KEY_STORAGE = 'vpnstar-panel-key'

export function getStoredKey(): string {
  try {
    return sessionStorage.getItem(PANEL_KEY_STORAGE) || ''
  } catch {
    return ''
  }
}

export function setStoredKey(key: string) {
  try {
    sessionStorage.setItem(PANEL_KEY_STORAGE, key)
  } catch {
    /* private mode */
  }
}

export function clearStoredKey() {
  try {
    sessionStorage.removeItem(PANEL_KEY_STORAGE)
  } catch {
    /* noop */
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Private media URLs (/agent-videos/..., /agent-images/...) now require the
 * panel key as a query param — <img>/<video> tags can't send headers. Returns
 * the path untouched when it's empty, not agent-media, or no key is stored
 * (optimistic files with path:'' keep rendering as before).
 */
export function withMediaKey(p: string): string {
  if (!p || !p.startsWith('/agent-')) return p
  const key = getStoredKey()
  if (!key) return p
  return `${p}${p.includes('?') ? '&' : '?'}k=${encodeURIComponent(key)}`
}

export async function panelFetch(
  path: string,
  init?: RequestInit & { key?: string }
): Promise<Response> {
  const key = init?.key ?? getStoredKey()
  const { key: _k, ...rest } = init || {}
  return fetch(path, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      'x-panel-key': key,
      ...(rest.headers || {}),
    },
  })
}

/* ---------- shared types ---------- */

export interface StatusEvent {
  ts: string
  event: string
  chat_id: number | null
  detail: string
}

export interface StatusData {
  ok: boolean
  watcher: {
    running: boolean
    pid: number | null
    uptimeSec: number | null
    paused: boolean
    supervisorAlive: boolean
  }
  state: {
    replies_total: number
    started_count: number
    mode: string
    permanent: boolean
    windowLeftSec: number
  }
  today: { incoming: number; replies: number }
  system?: {
    cpuModel: string
    cpuCores: number
    load1: number
    memTotalGb: number
    memUsedGb: number
    memPct: number
    disk: { totalGb: number; freeGb: number; usedPct: number }
    uptimeH: number
  }
  blacklist: { username: string; name: string }[]
  instructionsCount: number
  events: StatusEvent[]
}

export interface LlmSettings {
  ok: boolean
  settings: {
    persona: string
    command_prompt: string
    model: string
    thinking: boolean
    retries: number
    rate_limits: { per_chat_hour: number; global_hour: number; debounce_s: number }
    footer: string
    instructions: string[]
    blacklist: { username: string; name?: string }[]
    prices: { android_monthly: string; per_gb: string }
    customized?: Record<string, boolean>
  }
}

/* ---------- accounts tab ---------- */

export interface AccountEvent {
  ts: string
  event: string
  detail: string
}

export interface AccountStatus {
  supervisorAlive: boolean
  running: boolean
  paused: boolean
  pid: number | null
  uptimeSec: number | null
  repliesTotal: number
  startedCount: number
  mode: string
  lastError: string
  events: AccountEvent[]
}

export interface TgAccountRow {
  id: string
  label: string
  topic: string
  phone: string
  persona: string
  footer: string
  thinking: boolean
  enabled: boolean
  hasSession: boolean
  createdAt: string
  updatedAt: string
  status: AccountStatus
}

/* ---------- system tab ---------- */

export interface SystemInfo {
  ok: boolean
  info: {
    projectDir: string
    trashDir: string
    dbAccounts: number
    instanceCount: number
    watcherRunning: boolean
    terminalAlive: boolean
    sizes: { db: number; audit: number }
  }
  warnings: Record<string, string>
}

/* ---------- theme (settings tab) ---------- */

export interface PanelTheme {
  main: string
  second: string
  dim: string
  zoom: number
}

export const DEFAULT_THEME: PanelTheme = {
  main: '#f4f4f5',
  second: '#d4d4d8',
  dim: '#a1a1aa',
  zoom: 1,
}

export const THEME_STORAGE = 'vpnstar-theme'

export function loadTheme(): PanelTheme {
  try {
    const raw = sessionStorage.getItem(THEME_STORAGE) || localStorage.getItem(THEME_STORAGE)
    if (!raw) return DEFAULT_THEME
    const t = JSON.parse(raw) as Partial<PanelTheme>
    return {
      main: /^#[0-9a-f]{6}$/i.test(t.main || '') ? t.main! : DEFAULT_THEME.main,
      second: /^#[0-9a-f]{6}$/i.test(t.second || '') ? t.second! : DEFAULT_THEME.second,
      dim: /^#[0-9a-f]{6}$/i.test(t.dim || '') ? t.dim! : DEFAULT_THEME.dim,
      zoom: [0.95, 1, 1.08, 1.16].includes(Number(t.zoom)) ? Number(t.zoom) : 1,
    }
  } catch {
    return DEFAULT_THEME
  }
}

export function saveTheme(t: PanelTheme) {
  try {
    localStorage.setItem(THEME_STORAGE, JSON.stringify(t))
    sessionStorage.setItem(THEME_STORAGE, JSON.stringify(t))
  } catch {
    /* private mode */
  }
}

export function formatUptime(sec: number | null): string {
  if (sec == null) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h} ساعت و ${m} دقیقه`
  return `${m} دقیقه`
}

export function tehranTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      timeZone: 'Asia/Tehran',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

export const EVENT_LABELS: Record<string, string> = {
  incoming: 'پیام مشتری',
  reply_send: 'جواب ارسال شد',
  owner_command: 'فرمان مالک',
  owner_cmd_parsed: 'فرمان تفسیر شد',
  owner_msg: 'پیام شخصی مالک',
  skip_owner_active: 'سکوت (مالک فعال)',
  blacklisted_skip: 'بلاک‌لیست',
  rate_limited: 'محدودیت نرخ',
  llm_fail: 'خطای مدل',
  floodwait: 'مکث ضد-فلود',
  backup_sent: 'بکاپ ارسال شد',
  backup_fail: 'خطای بکاپ',
  start: 'استارت دستیار',
  pause_exit: 'توقف موقت',
  catchup_scan: 'اسکن جبرانی',
  catchup_found: 'پیام جا‌مانده',
  catchup_command: 'فرمان جا‌مانده',
  broadcast_pending: 'برودکست در انتظار تایید',
  broadcast_done: 'برودکست تمام شد',
  owner_cmd_send: 'ارسال به‌مقصد مالک',
  history_fail: 'خطا در خواندن تاریخچه',
  ack_fail: 'خطای ارسال تایید',
  expired: 'پنجره تمام شد',
}
