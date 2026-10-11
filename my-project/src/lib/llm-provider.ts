/**
 * CiaNet panel — LLM provider adapter (server-side only).
 *
 * The panel's own AI routes (e.g. /api/panel/llm-chat) use the SAME
 * provider-agnostic layer as the agent core: either the sandbox SDK
 * (z-ai-web-dev-sdk, lazily imported) or ANY OpenAI-compatible endpoint
 * configured in .secrets/llm.env (OpenAI, OpenRouter, Groq, DeepSeek,
 * Ollama, LM Studio, vLLM …). Nothing in here is importable from the
 * browser — routes only. Full Persian guide: LLM-SETUP.md.
 */
import { existsSync, readFileSync } from 'fs'
import path from 'path'

export type PanelProviderKind = 'zai' | 'openai' | 'none'

export interface PanelProviderInfo {
  kind: PanelProviderKind
  label: string
  model: string
  error: string
}

const ENV_KEYS = ['LLM_PROVIDER', 'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL', 'LLM_TIMEOUT_MS'] as const
const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1'

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    if (!existsSync(file)) return out
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !m[2].startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
    }
  } catch {
    /* unreadable */
  }
  return out
}

function llmEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  const files: string[] = []
  if (process.env.LLM_ENV_FILE) files.push(process.env.LLM_ENV_FILE)
  files.push(path.join(process.cwd(), '.secrets', 'llm.env'))
  for (const f of files) Object.assign(out, parseEnvFile(f))
  for (const k of ENV_KEYS) if (process.env[k]) out[k] = process.env[k]
  return out
}

/* ---------- sandbox SDK (lazy, optional — absent outside the sandbox) ---------- */

interface ZaiClientShape {
  chat: {
    completions: {
      create: (args: unknown) => Promise<{ choices?: Array<{ message?: { content?: unknown } }>; model?: string }>
    }
  }
}

const SDK_SPECIFIER = 'z-ai-web-dev-sdk' // non-literal → optional at runtime AND at type-check
let zaiClientP: Promise<ZaiClientShape> | null = null

async function zai(): Promise<ZaiClientShape> {
  if (!zaiClientP) {
    zaiClientP = (async () => {
      const spec = SDK_SPECIFIER
      // turbopack-ignore: a non-literal import() makes Turbopack create a
      // directory-asset reference and walk candidate dirs — which reaches
      // mini-services/vnc/rootfs whose absolute symlinks panic the dev
      // server ("points out of the filesystem root"). Resolved natively
      // by Node from node_modules at runtime; nothing to bundle-analyze.
      const mod = (await import(/* turbopack-ignore: true */ spec)) as {
        default?: { create: () => Promise<ZaiClientShape> }
      } & ZaiClientShape
      if (mod?.default?.create) return await mod.default.create()
      if (mod?.chat) return mod
      throw new Error('ساخت کلاینت Z.ai ناموفق بود')
    })()
    zaiClientP.catch(() => { zaiClientP = null })
  }
  return zaiClientP
}

let providerP: Promise<PanelProviderKind> | null = null
let detectError = ''

async function resolveProvider(): Promise<PanelProviderKind> {
  if (!providerP) {
    providerP = (async () => {
      detectError = ''
      const env = llmEnv()
      const forced = (env.LLM_PROVIDER || '').trim().toLowerCase()
      if (forced === 'openai') {
        if (!env.LLM_BASE_URL && !env.LLM_API_KEY) {
          detectError = 'LLM_PROVIDER=openai ولی نه LLM_BASE_URL دارید نه LLM_API_KEY'
          return 'none'
        }
        return 'openai'
      }
      if (forced === 'zai') return 'zai'
      if (env.LLM_BASE_URL) return 'openai'
      try {
        await zai()
        return 'zai'
      } catch (e) {
        detectError = e instanceof Error ? e.message : String(e)
        return 'none'
      }
    })()
    providerP.catch(() => { providerP = null })
  }
  return providerP
}

export async function panelProviderInfo(): Promise<PanelProviderInfo> {
  // Check DB for a default provider first
  try {
    const { PrismaClient } = await import('@prisma/client')
    const db = new PrismaClient()
    const defaultProvider = await db.llmProvider.findFirst({ where: { isDefault: true, enabled: true } })
    await db.$disconnect()
    if (defaultProvider) {
      const kind = defaultProvider.kind as PanelProviderKind
      let host = defaultProvider.baseUrl
      try { host = new URL(defaultProvider.baseUrl).host } catch { /* keep raw */ }
      return { kind, label: defaultProvider.name + (host ? ` (${host})` : ''), model: defaultProvider.model, error: '' }
    }
  } catch { /* DB not available — fall through */ }

  // Fall back to env-based detection
  const env = llmEnv()
  const kind = await resolveProvider()
  if (kind === 'openai') {
    const baseUrl = (env.LLM_BASE_URL || DEFAULT_OPENAI_BASE).replace(/\/+$/, '')
    const model = env.LLM_MODEL || ''
    if (!model) {
      return {
        kind: 'none', label: 'حالت OpenAI-سازگار ولی LLM_MODEL تنظیم نشده',
        model: '', error: 'LLM_MODEL را در .secrets/llm.env تنظیم کنید',
      }
    }
    let host = baseUrl
    try { host = new URL(baseUrl).host } catch { /* keep raw */ }
    return { kind, label: `استاندارد OpenAI از ${host}`, model, error: detectError }
  }
  if (kind === 'zai') {
    return { kind, label: 'Z.ai داخلی سندباکس', model: 'glm-4-plus', error: '' }
  }
  return {
    kind: 'none',
    label: 'مدل تنظیم نشده — فایل llm.env را کامل کنید',
    model: '',
    error: detectError,
  }
}

export interface PanelChatMsg {
  role: 'user' | 'assistant'
  content: string
}

export async function panelLlmChat(
  system: string,
  messages: PanelChatMsg[],
  opts: { thinking?: boolean; timeoutMs?: number } = {}
): Promise<{ content: string; model: string }> {
  // 1. Check DB for default provider
  try {
    const { PrismaClient } = await import('@prisma/client')
    const db = new PrismaClient()
    const provider = await db.llmProvider.findFirst({ where: { isDefault: true, enabled: true } })
    await db.$disconnect()
    if (provider && provider.kind !== 'zai') {
      const baseUrl = provider.baseUrl.replace(/\/+$/, '')
      const apiKey = provider.apiKey
      const model = provider.model
      const ms = opts.timeoutMs ?? provider.timeoutMs ?? 90_000
      if (!model) throw new Error('مدل تنظیم نشده — در تب «هوش مصنوعی» مدل را مشخص کنید')
      let url = baseUrl
      if (provider.kind === 'ollama' && !url.includes('/v1')) url += '/v1'
      const res = await fetch(`${url}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), 'http-referer': 'https://cianet.local', 'x-title': 'CiaNet Panel' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...messages], temperature: provider.temperature, max_tokens: provider.maxTokens }),
        signal: AbortSignal.timeout(ms),
      })
      if (!res.ok) { const txt = await res.text().catch(() => ''); throw new Error(`سرویس مدل خطای HTTP ${res.status}: ${txt.slice(0, 200) || 'بدون متن'}`) }
      const data = await res.json()
      const content = String(data?.choices?.[0]?.message?.content || '').trim()
      if (!content) throw new Error('پاسخ مدل خالی بود')
      return { content, model: data?.model || model }
    }
    // If provider is zai, fall through to sandbox SDK
  } catch (e) {
    if (e instanceof Error && !e.message.includes('Cannot read') && !e.message.includes('prisma')) throw e
    /* DB not available — fall through to env-based detection */
  }

  // 2. Fall back to env-based detection (legacy)
  const env = llmEnv()
  const kind = await resolveProvider()
  const ms = opts.timeoutMs ?? 90_000

  if (kind === 'openai') {
    const baseUrl = (env.LLM_BASE_URL || DEFAULT_OPENAI_BASE).replace(/\/+$/, '')
    const apiKey = env.LLM_API_KEY || ''
    const model = env.LLM_MODEL || ''
    if (!model) throw new Error('LLM_MODEL تنظیم نشده — .secrets/llm.env را کامل کنید (LLM-SETUP.md)')
    let res: Response
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          'http-referer': 'https://cianet.local',
          'x-title': 'CiaNet Panel',
        },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, ...messages] }),
        signal: AbortSignal.timeout(ms),
      })
    } catch (e) {
      throw new Error(`اتصال به سرویس مدل برقرار نشد: ${e instanceof Error ? e.message.slice(0, 160) : 'خطا'}`)
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`سرویس مدل خطای HTTP ${res.status} داد: ${txt.slice(0, 300) || 'بدون متن خطا'}`)
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }>; model?: string }
    const content = String(data.choices?.[0]?.message?.content || '').trim()
    if (!content) throw new Error('پاسخ مدل خالی بود')
    return { content, model: data.model || model }
  }

  if (kind === 'zai') {
    const client = await zai()
    const completion = await Promise.race([
      client.chat.completions.create({
        model: 'glm-4-plus',
        // per SDK skill: system prompts ride as the first 'assistant' message
        messages: [{ role: 'assistant', content: system }, ...messages],
        thinking: { type: opts.thinking !== false ? 'enabled' : 'disabled' },
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('مهلت پاسخ مدل تمام شد')), ms)),
    ])
    const content = String(completion.choices?.[0]?.message?.content || '').trim()
    if (!content) throw new Error('پاسخ مدل خالی بود')
    return { content, model: completion.model || 'glm-4-plus' }
  }

  throw new Error(
    'هیچ مدلی تنظیم نشده. فایل .secrets/llm.env را طبق راهنمای LLM-SETUP.md کامل کنید (سرویس ابری OpenAI-سازگار یا Ollama محلی).'
  )
}

/* ==================== Provider Management (DB-backed) ==================== */

export interface TestConnectionParams { baseUrl: string; apiKey: string; model: string; kind: string; timeoutMs: number }
export interface TestResult { ok: boolean; latencyMs: number; model?: string; error?: string }

export async function testProviderConnection(params: TestConnectionParams): Promise<TestResult> {
  const { baseUrl, apiKey, model, kind, timeoutMs } = params
  const start = Date.now()
  if (!baseUrl.trim()) return { ok: false, latencyMs: 0, error: 'Base URL خالی است' }
  let url = baseUrl.replace(/\/+$/, '')
  if (kind === 'ollama' && !url.includes('/v1')) url += '/v1'
  try {
    const res = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}), 'http-referer': 'https://cianet.local', 'x-title': 'CiaNet Panel Test' },
      body: JSON.stringify({ model: model || 'gpt-3.5-turbo', messages: [{ role: 'user', content: 'ping' }], max_tokens: 5, temperature: 0 }),
      signal: AbortSignal.timeout(timeoutMs || 30000),
    })
    const latencyMs = Date.now() - start
    if (res.ok) { const data = await res.json().catch(() => ({})); return { ok: true, latencyMs, model: data?.model || model } }
    const errorText = await res.text().catch(() => '')
    let errorMsg = `HTTP ${res.status}`
    if (res.status === 401) errorMsg = 'کلید API نامعتبر'
    else if (res.status === 404) errorMsg = 'مدل پیدا نشد'
    else if (res.status === 429) errorMsg = 'محدودیت درخواست'
    else if (res.status >= 500) errorMsg = 'سرویس در دسترس نیست'
    if (errorText) errorMsg += `: ${errorText.slice(0, 200)}`
    return { ok: false, latencyMs, error: errorMsg }
  } catch (e) {
    const latencyMs = Date.now() - start
    const err = e instanceof Error ? e.message : String(e)
    if (err.includes('aborted') || err.includes('timeout')) return { ok: false, latencyMs, error: 'مهلت پاسخ تمام شد' }
    if (err.includes('ECONNREFUSED')) return { ok: false, latencyMs, error: 'اتصال رد شد — سرویس روشن نیست' }
    if (err.includes('ENOTFOUND')) return { ok: false, latencyMs, error: 'دامنه پیدا نشد' }
    if (err.includes('fetch failed')) return { ok: false, latencyMs, error: 'اتصال برقرار نشد' }
    return { ok: false, latencyMs, error: err.slice(0, 200) }
  }
}

export async function discoverModels(baseUrl: string, apiKey: string, kind: string): Promise<string[]> {
  let url = baseUrl.replace(/\/+$/, '')
  if (kind === 'ollama' && !url.includes('/v1')) url += '/v1'
  try {
    const res = await fetch(`${url}/models`, { headers: { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, signal: AbortSignal.timeout(15000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}: دریافت لیست مدل‌ها ناموفق`)
    const data = await res.json()
    const models: string[] = (data?.data || data?.models || []).map((m: { id?: string; name?: string }) => m.id || m.name).filter(Boolean)
    if (models.length === 0) throw new Error('هیچ مدلی یافت نشد — شناسه مدل را دستی وارد کنید')
    return models
  } catch (e) {
    if (e instanceof Error && e.message.includes('HTTP')) throw e
    throw new Error(e instanceof Error ? `شناسایی مدل‌ها ناموفق: ${e.message.slice(0, 160)}` : 'شناسایی مدل‌ها ناموفق بود')
  }
}
