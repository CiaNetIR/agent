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
      // No explicit provider configured. Previously we silently fell through
      // to the bundled z-ai-web-dev-sdk and reported «Z.ai Internal», which
      // masked an unconfigured state. Now we surface 'none' so the owner
      // sees a real error pointing them at .secrets/llm.env. The sandbox SDK
      // can still be opted into explicitly via LLM_PROVIDER=zai.
      detectError = 'LLM_PROVIDER تنظیم نشده — فایل .secrets/llm.env را طبق راهنمای LLM-SETUP.md کامل کنید (یا LLM_PROVIDER=zai برای استفاده از سندباکس داخلی)'
      return 'none'
    })()
    providerP.catch(() => { providerP = null })
  }
  return providerP
}

export async function panelProviderInfo(): Promise<PanelProviderInfo> {
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
    label: 'مدل تنظیم نشده',
    model: '',
    error: detectError || 'LLM_PROVIDER تنظیم نشده — فایل .secrets/llm.env را طبق راهنمای LLM-SETUP.md کامل کنید',
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

// ===================== Provider testing / discovery =====================

export interface ProviderTestInput {
  baseUrl: string
  apiKey: string
  model: string
  kind: string
  timeoutMs?: number
}

export async function testProviderConnection(input: ProviderTestInput): Promise<{ ok: boolean; latencyMs: number; model: string; error?: string }> {
  const start = Date.now()
  try {
    const baseUrl = input.baseUrl.replace(/\/+$/, '')
    const body: Record<string, unknown> = {
      model: input.model || 'test',
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 5,
    }
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': 'curl/8.5.0',
    }
    if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`

    const env = llmEnv()
    const proxyUrl = env.LLM_PROXY || env.TELEGRAM_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || ''

    // SOCKS5 proxy
    if (proxyUrl && proxyUrl.startsWith('socks')) {
      try {
        const { SocksProxyAgent } = await import('socks-proxy-agent')
        const https = await import('https')
        const agent = new SocksProxyAgent(proxyUrl)
        const urlObj = new URL(`${baseUrl}/chat/completions`)
        const postData = JSON.stringify(body)
        headers['content-length'] = Buffer.byteLength(postData).toString()
        const content = await new Promise<string>((resolve, reject) => {
          const req = https.request(urlObj, { method: 'POST', headers, agent, timeout: input.timeoutMs || 30000 }, (res) => {
            let data = ''
            res.on('data', c => data += c)
            res.on('end', () => {
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 200)}`))
                return
              }
              resolve(data)
            })
          })
          req.on('error', reject)
          req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
          req.write(postData)
          req.end()
        })
        const data = JSON.parse(content)
        return { ok: true, latencyMs: Date.now() - start, model: data.model || input.model }
      } catch (e) {
        return { ok: false, latencyMs: Date.now() - start, model: input.model, error: e instanceof Error ? e.message : String(e) }
      }
    }

    // HTTP proxy or direct
    const fetchOpts: RequestInit & { dispatcher?: unknown } = {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(input.timeoutMs || 30000),
    }
    if (proxyUrl && proxyUrl.startsWith('http')) {
      try {
        const { ProxyAgent } = await import('undici')
        ;(fetchOpts as Record<string, unknown>).dispatcher = new ProxyAgent(proxyUrl)
      } catch { /* */ }
    }
    const res = await fetch(`${baseUrl}/chat/completions`, fetchOpts)
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      return { ok: false, latencyMs: Date.now() - start, model: input.model, error: `HTTP ${res.status}: ${txt.slice(0, 200)}` }
    }
    const data = await res.json() as { model?: string }
    return { ok: true, latencyMs: Date.now() - start, model: data.model || input.model }
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - start, model: input.model, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function discoverModels(baseUrl: string, apiKey: string, kind: string): Promise<string[]> {
  try {
    const url = baseUrl.replace(/\/+$/, '') + '/models'
    const headers: Record<string, string> = {
      'user-agent': 'curl/8.5.0',
    }
    if (apiKey) headers.authorization = `Bearer ${apiKey}`

    const env = llmEnv()
    const proxyUrl = env.LLM_PROXY || env.TELEGRAM_PROXY || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || ''

    // SOCKS5 proxy
    if (proxyUrl && proxyUrl.startsWith('socks')) {
      const { SocksProxyAgent } = await import('socks-proxy-agent')
      const https = await import('https')
      const agent = new SocksProxyAgent(proxyUrl)
      const urlObj = new URL(url)
      const content = await new Promise<string>((resolve, reject) => {
        const req = https.request(urlObj, { method: 'GET', headers, agent, timeout: 30000 }, (res) => {
          let data = ''
          res.on('data', c => data += c)
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}`))
              return
            }
            resolve(data)
          })
        })
        req.on('error', reject)
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')) })
        req.end()
      })
      const data = JSON.parse(content) as { data?: Array<{ id: string }> }
      return (data.data || []).map(m => m.id).filter(Boolean)
    }

    // HTTP proxy or direct
    const fetchOpts: RequestInit & { dispatcher?: unknown } = { headers }
    if (proxyUrl && proxyUrl.startsWith('http')) {
      try {
        const { ProxyAgent } = await import('undici')
        ;(fetchOpts as Record<string, unknown>).dispatcher = new ProxyAgent(proxyUrl)
      } catch { /* */ }
    }
    const res = await fetch(url, fetchOpts)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json() as { data?: Array<{ id: string }> }
    return (data.data || []).map(m => m.id).filter(Boolean)
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : String(e))
  }
}
