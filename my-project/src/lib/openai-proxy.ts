/**
 * OpenAI-compatible proxy lib — lets the owner plug ANY OpenAI-compatible
 * coding tool (OpenCode, Cline, Continue, …) into the panel's AI provider.
 *
 * Auth model:
 *   - The provider (internal-api.z.ai) is only reachable from this server
 *     (private network) — so tools OUTSIDE the server talk to THIS panel:
 *       POST <panel-origin>/api/openai/v1/chat/completions
 *       Authorization: Bearer <OPENAI_PROXY_KEY>
 *   - OPENAI_PROXY_KEY (plaintext) + OPENAI_PROXY_KEY_SHA256 live in
 *     .secrets/panel.env and are re-read per request (rotation = no restart).
 */
import { createHash, randomBytes, timingSafeEqual } from 'crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import path from 'path'
import { PANEL_ENV, registerFail } from './panel-server'

/* ---------------- provider config ---------------- */

export interface ZaiConfig {
  baseUrl: string
  apiKey: string
  token: string
  chatId: string
  userId: string
}

const ZAI_CFG = '/etc/.z-ai-config'
const ZAI_CFG_BAK = '/home/z/my-project/.secrets/z-ai-config.json'

export function readZaiConfig(): ZaiConfig | null {
  for (const p of [ZAI_CFG, ZAI_CFG_BAK]) {
    try {
      const d = JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
      if (d && typeof d.baseUrl === 'string' && typeof d.apiKey === 'string' && d.baseUrl && d.apiKey) {
        return {
          baseUrl: String(d.baseUrl).replace(/\/+$/, ''),
          apiKey: String(d.apiKey),
          token: String(d.token ?? ''),
          chatId: String(d.chatId ?? ''),
          userId: String(d.userId ?? ''),
        }
      }
    } catch {
      /* try next location */
    }
  }
  return null
}

/** headers exactly like the SDK / emergency-api.sh (never logged) */
export function providerHeaders(cfg: ZaiConfig): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${cfg.apiKey}`,
    'X-Z-AI-From': 'Z',
  }
  if (cfg.chatId) h['X-Chat-Id'] = cfg.chatId
  if (cfg.userId) h['X-User-Id'] = cfg.userId
  if (cfg.token) h['X-Token'] = cfg.token
  return h
}

/* ---------------- proxy key (owner's API key for coding tools) -------- */

function readPanelEnvVars(): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    for (const line of readFileSync(PANEL_ENV, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m) out[m[1]] = m[2]
    }
  } catch {
    /* unreadable file */
  }
  return out
}

export function getProxyKey(): { key: string; sha: string } {
  const v = readPanelEnvVars()
  return { key: v.OPENAI_PROXY_KEY ?? '', sha: (v.OPENAI_PROXY_KEY_SHA256 ?? '').toLowerCase() }
}

/** verify Authorization: Bearer <key> — failures count toward the global
 *  5-fail lockout (same as panel key guessing) */
export function verifyBearer(authHeader: unknown): boolean {
  const h = String(authHeader ?? '')
  const bearer = h.startsWith('Bearer ') ? h.slice(7).trim() : ''
  const { key, sha } = getProxyKey()
  let ok = false
  if (key && sha && bearer) {
    try {
      const got = createHash('sha256').update(bearer).digest('hex')
      ok = /^[0-9a-f]{64}$/.test(sha) && timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(sha, 'hex'))
    } catch {
      ok = false
    }
  }
  if (!ok) registerFail()
  return ok
}

/** generate a fresh proxy key, persist it (atomic, mode 600), return it */
export function rotateProxyKey(): string | null {
  try {
    const newKey = `sk-star-${randomBytes(24).toString('hex')}`
    const newSha = createHash('sha256').update(newKey).digest('hex')
    const raw = readFileSync(PANEL_ENV, 'utf8')
    const lines = raw
      .split('\n')
      .filter((l) => !/^\s*OPENAI_PROXY_KEY(_SHA256)?\s*=/.test(l) && l.trim() !== '')
    lines.push(`OPENAI_PROXY_KEY=${newKey}`)
    lines.push(`OPENAI_PROXY_KEY_SHA256=${newSha}`)
    const tmp = `${PANEL_ENV}.tmp`
    writeFileSync(tmp, `${lines.join('\n')}\n`, { mode: 0o600 })
    renameSync(tmp, PANEL_ENV)
    return newKey
  } catch {
    return null
  }
}

/* ---------------- model catalog (our aliases) ---------------- */

export interface ProxyModel {
  id: string
  label: string
  thinking: boolean
}

export const PROXY_MODELS: ProxyModel[] = [
  { id: 'glm-4.7', label: 'GLM 4.7 — سریع', thinking: false },
  { id: 'glm-4.7-thinking', label: 'GLM 4.7 — اندیشمند (کارهای سخت)', thinking: true },
]

/* ---------------- 429 circuit breaker (cross-process, shared file) ---- */

const COOLDOWN_FILE = '/home/z/agent-files/llm-cooldown.json'
const COOLDOWN_STEPS_MS = [30_000, 60_000, 120_000, 300_000, 600_000]
let cdStreak = 0

export function cooldownRemainingMs(): number {
  try {
    const j = JSON.parse(readFileSync(COOLDOWN_FILE, 'utf8')) as { until?: number }
    const u = Number(j.until) || 0
    return Math.max(0, u - Date.now())
  } catch {
    return 0
  }
}

export function bumpCooldown(): void {
  const step = COOLDOWN_STEPS_MS[Math.min(cdStreak, COOLDOWN_STEPS_MS.length - 1)]
  cdStreak++
  const until = Math.max(Date.now() + step, cooldownRemainingMs())
  try {
    mkdirSync(path.dirname(COOLDOWN_FILE), { recursive: true })
    writeFileSync(COOLDOWN_FILE, JSON.stringify({ until, reason: '429', at: Date.now() }))
  } catch {
    /* best effort */
  }
}

export function resetCooldownStreak(): void {
  cdStreak = 0
}

/* ---------------- small helpers ---------------- */

export const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
}

export function openaiError(status: number, message: string, type: string, code: string, extra: Record<string, string> = {}): Response {
  return new Response(
    JSON.stringify({ error: { message, type, code } }),
    { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extra } },
  )
}

/** map incoming messages to the provider's system/user/assistant schema */
export function normalizeMessages(messages: unknown): { role: 'system' | 'user' | 'assistant'; content: string }[] {
  if (!Array.isArray(messages)) return []
  const out: { role: 'system' | 'user' | 'assistant'; content: string }[] = []
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue
    const roleRaw = String((m as Record<string, unknown>).role ?? 'user')
    const role: 'system' | 'user' | 'assistant' = roleRaw === 'system' || roleRaw === 'assistant' ? roleRaw : 'user'
    const rawContent: unknown = (m as Record<string, unknown>).content
    let content: string
    if (Array.isArray(rawContent)) {
      content = rawContent
        .map((p) =>
          p && typeof p === 'object' && typeof (p as Record<string, unknown>).text === 'string'
            ? ((p as Record<string, unknown>).text as string)
            : '',
        )
        .join('')
    } else if (typeof rawContent === 'string') {
      content = rawContent
    } else {
      content = ''
    }
    if (!content.trim()) continue
    out.push({ role, content })
  }
  return out
}
