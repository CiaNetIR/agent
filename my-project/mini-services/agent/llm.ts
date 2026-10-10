/**
 * Z agent core — LLM + image generation, PROVIDER-AGNOSTIC.
 *
 * This file is the ONLY place that talks to a model. It supports three run
 * modes (auto-detected, or forced via LLM_PROVIDER in .secrets/llm.env):
 *
 *   1. 'zai'    — z-ai-web-dev-sdk (the build sandbox; zero config, the
 *                 SDK is imported lazily so the service still boots when
 *                 the package/credentials are missing).
 *   2. 'openai' — ANY OpenAI-compatible endpoint: OpenAI, OpenRouter, Groq,
 *                 DeepSeek, Together, xAI, Ollama, LM Studio, vLLM,
 *                 llama.cpp server …  → set LLM_BASE_URL + LLM_API_KEY +
 *                 LLM_MODEL in /home/z/my-project/.secrets/llm.env
 *   3. 'none'   — nothing configured: every AI call fails with a clear
 *                 Persian error; the rest of the panel/bot keeps working.
 *
 * Config precedence: real environment variables (bun auto-loads ./.env)
 * override the values parsed from the llm.env file. LLM_ENV_FILE can point
 * at a custom location (e.g. OUTSIDE the project tree so keys never reach
 * the git backup). Full Persian guide: LLM-SETUP.md.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

/* ================================ config ================================ */

export type ProviderKind = 'zai' | 'openai' | 'none'

const PROJECT_DIR = '/home/z/my-project'
const DEFAULT_OPENAI_BASE = 'https://api.openai.com/v1'
const TAVILY_URL = 'https://api.tavily.com/search'

const ENV_KEYS = [
  'LLM_PROVIDER', 'LLM_BASE_URL', 'LLM_API_KEY', 'LLM_MODEL',
  'LLM_VISION_MODEL', 'LLM_IMAGE_MODEL', 'LLM_TIMEOUT_MS', 'TAVILY_API_KEY',
] as const

function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {}
  try {
    if (!existsSync(file)) return out
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !m[2].startsWith('#')) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
    }
  } catch {
    /* unreadable file */
  }
  return out
}

/** merged LLM config: llm.env file values overridden by real process.env */
function llmEnv(): Record<string, string> {
  const out: Record<string, string> = {}
  const files: string[] = []
  if (process.env.LLM_ENV_FILE) files.push(process.env.LLM_ENV_FILE)
  files.push(path.join(process.cwd(), '.secrets', 'llm.env'))
  if (PROJECT_DIR !== process.cwd()) files.push(path.join(PROJECT_DIR, '.secrets', 'llm.env'))
  for (const f of files) Object.assign(out, parseEnvFile(f))
  for (const k of ENV_KEYS) if (process.env[k]) out[k] = process.env[k]
  return out
}

function openaiCfg(env: Record<string, string>): { baseUrl: string; apiKey: string; model: string } {
  const baseUrl = (env.LLM_BASE_URL || DEFAULT_OPENAI_BASE).replace(/\/+$/, '')
  const apiKey = env.LLM_API_KEY || ''
  const model = env.LLM_MODEL || ''
  if (!model) {
    throw new Error(
      'حالت OpenAI-سازگار فعال است ولی LLM_MODEL تنظیم نشده. نمونه: LLM_MODEL=deepseek/deepseek-chat — راهنما: LLM-SETUP.md'
    )
  }
  return { baseUrl, apiKey, model }
}

/* ===================== 429 circuit breaker (cross-process) =====================
 * The sandbox model endpoint rate-limits the whole account with HTTP 429
 * («Too many requests»). Fast retries make it WORSE — every burst seems to
 * re-arm the lockout window — so any 429 seen by ANY process (this service,
 * the Python Telegram watcher, the z-ai CLI) bumps a shared cooldown file
 * and every caller backs off until it clears. Escalating schedule:
 *   30s → 60s → 120s → 300s → 600s (cap), reset after one clean call. */

const COOLDOWN_FILE = '/home/z/agent-files/llm-cooldown.json'
const COOLDOWN_STEPS_MS = [30_000, 60_000, 120_000, 300_000, 600_000]

let cdUntil = 0        // in-memory mirror of the file (epoch ms)
let cdCheckedAt = 0    // re-read the file at most every 3 s
let cdStreak = 0       // consecutive 429s — resets on the first success

function cooldownUntil(): number {
  const now = Date.now()
  if (now - cdCheckedAt > 3_000) {
    cdCheckedAt = now
    try {
      const j = JSON.parse(readFileSync(COOLDOWN_FILE, 'utf8')) as { until?: number }
      const u = Number(j.until) || 0
      if (u > cdUntil) cdUntil = u
    } catch { /* no file yet / unreadable */ }
  }
  return cdUntil
}

function bumpCooldown(): void {
  const step = COOLDOWN_STEPS_MS[Math.min(cdStreak, COOLDOWN_STEPS_MS.length - 1)]
  cdStreak++
  cdUntil = Math.max(cooldownUntil(), Date.now() + step)
  cdCheckedAt = Date.now()
  try {
    mkdirSync(path.dirname(COOLDOWN_FILE), { recursive: true })
    writeFileSync(COOLDOWN_FILE, JSON.stringify({ until: cdUntil, reason: '429', at: Date.now() }))
  } catch { /* best effort — in-memory value still works for this process */ }
  console.error(`[llm] 429 rate-limited — cooldown ${Math.round(step / 1000)}s (until ${new Date(cdUntil).toISOString()})`)
}

function cooldownResetStreak(): void { cdStreak = 0 }

function isRateLimitError(e: unknown): boolean {
  const s = e instanceof Error ? e.message : String(e)
  return /status 429|Too many requests|محدودیت نرخ/i.test(s)
}

/** true while every process should hold off calling the model API */
export function llmCooldownActive(): boolean {
  return cooldownUntil() > Date.now()
}

/** shared rate-limit detector (used by chat.ts to pick the honest bubble) */
export { isRateLimitError }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** run a provider call through the shared breaker: on 429 wait out the
 *  cooldown (within budgetMs, else rethrow); any other error rethrows at once. */
export async function withRetry<T>(fn: () => Promise<T>, budgetMs: number, label: string): Promise<T> {
  const deadline = Date.now() + budgetMs
  let lastErr: unknown = null
  for (;;) {
    const wait = cooldownUntil() - Date.now()
    if (wait > 0) {
      if (Date.now() + wait > deadline) {
        throw lastErr ?? new Error(`سرویس مدل فعلاً محدودیت نرخ ۴۲۹ خورده (${label}) — بعداً دوباره امتحان کن`)
      }
      await sleep(wait + 500)
    }
    try {
      const out = await fn()
      cooldownResetStreak()
      return out
    } catch (e) {
      if (!isRateLimitError(e)) throw e
      lastErr = e
      bumpCooldown()
      /* loop → the next iteration waits for the cooldown (or gives up at the deadline) */
    }
  }
}

/* ============================ provider resolve =========================== */

interface ZaiClientShape {
  chat: {
    completions: {
      create: (args: unknown) => Promise<{ choices?: Array<{ message?: { content?: unknown } }>; model?: string }>
      createVision: (args: unknown) => Promise<{ choices?: Array<{ message?: { content?: unknown } }> }>
    }
  }
  functions: { invoke: (name: string, args: unknown) => Promise<unknown> }
  images: { generations: { create: (args: unknown) => Promise<{ data?: Array<{ base64?: string }> }> } }
  video: { generations: { create: (args: unknown) => Promise<VideoTask> } }
  async: { result: { query: (id: string) => Promise<VideoTask> } }
}

/* ---------------- video generation (async task API) ---------------- */

export interface VideoTask {
  id: string
  task_status: 'PROCESSING' | 'SUCCESS' | 'FAIL' | string
  video_result?: Array<{ url?: string }>
  video_url?: string
  url?: string
  video?: string
  error?: unknown
}

export interface VideoGenOpts {
  quality: 'speed' | 'quality'
  size: '1920x1080' | '1080x1920'
  fps: 30 | 60
  /** the provider API only takes 5 or 10 — multi-clip stitching is handled by video.ts */
  duration: 5 | 10
  withAudio: boolean
}

/** create an async video-generation task → task id (zai provider only).
 *  Runs as a BACKGROUND job, so it gets a long 429 budget: waiting out a
 *  provider lockout (up to 6 min) beats killing the whole film on one 429. */
export async function llmVideoCreate(prompt: string, opts: VideoGenOpts): Promise<string> {
  const kind = await resolveProvider()
  if (kind === 'zai') {
    const client = await zai()
    const task = await withRetry(() => client.video.generations.create({
      prompt,
      quality: opts.quality,
      with_audio: opts.withAudio,
      size: opts.size,
      fps: opts.fps,
      duration: opts.duration,
    }), 360_000, 'video-create')
    if (!task?.id) throw new Error('سرویس ویدیو شناسهٔ تسک نداد')
    return task.id
  }
  throw new Error(
    'تولید ویدیو فعلاً فقط با موتور داخلی سندباکس در دسترسه (حالت OpenAI-سازگار API ویدیو ندارد)'
  )
}

/** poll a video task → status + url when SUCCESS.
 *  NOT retried here — the video.ts poll loop owns spacing; but a 429 marks
 *  the shared cooldown so every process backs off. */
export async function llmVideoQuery(taskId: string): Promise<{ status: 'PROCESSING' | 'SUCCESS' | 'FAIL'; url: string }> {
  const kind = await resolveProvider()
  if (kind !== 'zai') return { status: 'FAIL', url: '' }
  const client = await zai()
  try {
    const r = await client.async.result.query(taskId)
    const st = r?.task_status === 'SUCCESS' ? 'SUCCESS' : r?.task_status === 'PROCESSING' ? 'PROCESSING' : 'FAIL'
    const url = String(r?.video_result?.[0]?.url || r?.video_url || r?.url || r?.video || '')
    return { status: st, url }
  } catch (e) {
    if (isRateLimitError(e)) bumpCooldown()
    throw e
  }
}

const SDK_SPECIFIER = 'z-ai-web-dev-sdk' // non-literal import → optional at runtime AND at type-check time

let zaiClientP: Promise<ZaiClientShape> | null = null
let detectError = ''

async function zai(): Promise<ZaiClientShape> {
  if (!zaiClientP) {
    zaiClientP = (async () => {
      const spec = SDK_SPECIFIER
      const mod = (await import(spec)) as { default?: { create: () => Promise<ZaiClientShape> } } & ZaiClientShape
      if (mod?.default?.create) return await mod.default.create()
      if (mod?.chat) return mod // some builds export the client directly
      throw new Error('ساخت کلاینت Z.ai ناموفق بود')
    })()
    zaiClientP.catch(() => { zaiClientP = null }) // failed create → retry on next call
  }
  return zaiClientP
}

let providerP: Promise<ProviderKind> | null = null

async function resolveProvider(): Promise<ProviderKind> {
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
      // auto: explicit external config wins, else sandbox SDK, else none
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

export interface LlmProviderInfo {
  kind: ProviderKind
  /** فارسی، برای نمایش در پنل */
  label: string
  model: string
  visionModel: string
  imageModel: string
  /** فقط هاست/مسیر — هرگز کلید API برنمی‌گردد */
  baseUrl: string
  search: 'sdk' | 'tavily' | 'none'
  error: string
}

export async function llmProviderInfo(): Promise<LlmProviderInfo> {
  const env = llmEnv()
  const kind = await resolveProvider()
  const search: LlmProviderInfo['search'] =
    kind === 'zai' ? 'sdk' : env.TAVILY_API_KEY ? 'tavily' : 'none'
  if (kind === 'openai' && !env.LLM_MODEL) {
    // half-configured → report as 'none' with a precise message; NEVER throw
    // (overview and the panel badge call this on every load)
    return {
      kind: 'none',
      label: 'حالت OpenAI-سازگار ولی LLM_MODEL تنظیم نشده',
      model: '', visionModel: '', imageModel: '', baseUrl: '',
      search, error: 'LLM_MODEL را در .secrets/llm.env تنظیم کنید — راهنما: LLM-SETUP.md',
    }
  }
  if (kind === 'openai') {
    const cfg = openaiCfg(env)
    let host = ''
    try { host = new URL(cfg.baseUrl).host } catch { host = cfg.baseUrl }
    return {
      kind, label: `استاندارد OpenAI از ${host}`, model: cfg.model,
      visionModel: env.LLM_VISION_MODEL || cfg.model,
      imageModel: env.LLM_IMAGE_MODEL || 'dall-e-3',
      baseUrl: cfg.baseUrl, search, error: detectError,
    }
  }
  if (kind === 'zai') {
    return {
      kind, label: 'Z.ai داخلی سندباکس', model: 'glm-4-plus',
      visionModel: 'glm-4.5v', imageModel: 'zai-image',
      baseUrl: 'sandbox', search, error: '',
    }
  }
  return {
    kind: 'none',
    label: 'مدل تنظیم نشده — فایل llm.env را کامل کنید',
    model: '', visionModel: '', imageModel: '', baseUrl: '',
    search, error: detectError,
  }
}

/* ============================ generic helpers ============================ */

function timeoutMs(env: Record<string, string>, fallback: number): number {
  const n = parseInt(env.LLM_TIMEOUT_MS || '', 10)
  return Number.isFinite(n) && n >= 5_000 ? n : fallback
}

function notConfigured(what: string): Error {
  return new Error(
    `${what} در دسترس نیست: هیچ مدلی تنظیم نشده. فایل .secrets/llm.env را طبق راهنمای LLM-SETUP.md کامل کنید (سرویس ابری OpenAI-سازگار یا Ollama محلی)، بعد سرویس را ری‌استارت کنید.`
  )
}

async function oaiPost(
  cfg: { baseUrl: string; apiKey: string },
  apiPath: string,
  body: unknown,
  ms: number
): Promise<Record<string, unknown>> {
  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}${apiPath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {}),
        'http-referer': 'https://cianet.local',
        'x-title': 'CiaNet Agent',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`اتصال به سرویس مدل برقرار نشد (${cfg.baseUrl}): ${msg.slice(0, 160)}`)
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    throw new Error(`سرویس مدل خطای HTTP ${res.status} داد: ${txt.slice(0, 300) || 'بدون متن خطا'}`)
  }
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    throw new Error('پاسخ سرویس مدل JSON معتبر نبود')
  }
}

function pickContent(data: Record<string, unknown>): string {
  const choices = data.choices as Array<{ message?: { content?: unknown } }> | undefined
  const content = choices?.[0]?.message?.content
  return typeof content === 'string' ? content.trim() : ''
}

/* =============================== public API ============================== */

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

/** plain chat completion; thinking on for analysis, off for fast support replies */
export async function llmChat(
  system: string,
  messages: ChatMsg[],
  opts: { thinking?: boolean; timeoutMs?: number } = {}
): Promise<string> {
  const env = llmEnv()
  const kind = await resolveProvider()
  const ms = opts.timeoutMs ?? timeoutMs(env, 90_000)

  if (kind === 'openai') {
    const cfg = openaiCfg(env)
    const data = await oaiPost(cfg, '/chat/completions', {
      model: cfg.model,
      messages: [{ role: 'system', content: system }, ...messages],
    }, ms)
    const content = pickContent(data)
    if (!content) throw new Error('پاسخ مدل خالی بود')
    return content
  }

  if (kind === 'zai') {
    const client = await zai()
    const completion = await withRetry(() => Promise.race([
      client.chat.completions.create({
        model: 'glm-4-plus',
        // per SDK skill: system prompts ride as the first 'assistant' message
        messages: [{ role: 'assistant', content: system }, ...messages],
        thinking: { type: opts.thinking !== false ? 'enabled' : 'disabled' },
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('مهلت مدل تمام شد')), ms)),
    ]), Math.max(ms + 60_000, 150_000), 'chat')
    const content = String(completion.choices?.[0]?.message?.content || '')
    if (!content.trim()) throw new Error('پاسخ مدل خالی بود')
    return content.trim()
  }

  throw notConfigured('گفتگو با مدل')
}

export const IMAGE_SIZES = ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440']

/* ---------------- vision (VLM — image understanding) ---------------- */

export interface VisionPart {
  type: 'text' | 'image_url'
  text?: string
  /** raw base64 (no data: prefix) of a jpeg/png/webp */
  b64?: string
}

/** multimodal chat completion (text + images); history is plain text turns */
export async function llmVision(
  system: string,
  history: ChatMsg[],
  parts: VisionPart[],
  opts: { thinking?: boolean; timeoutMs?: number } = {}
): Promise<string> {
  const env = llmEnv()
  const kind = await resolveProvider()
  const ms = opts.timeoutMs ?? timeoutMs(env, 120_000)

  const norm = parts
    .filter((p) => (p.type === 'text' && p.text) || (p.type === 'image_url' && p.b64))
  if (!norm.length) throw new Error('محتوای پیام خالی بود')

  if (kind === 'openai') {
    const cfg = openaiCfg(env)
    const visionModel = env.LLM_VISION_MODEL || cfg.model
    const content = norm.map((p) =>
      p.type === 'text'
        ? { type: 'text', text: p.text as string }
        : { type: 'image_url', image_url: { url: `data:image/png;base64,${p.b64}` } }
    )
    const data = await oaiPost(cfg, '/chat/completions', {
      model: visionModel,
      messages: [
        { role: 'system', content: system },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content },
      ],
    }, ms)
    const out = pickContent(data)
    if (!out) throw new Error('پاسخ مدل دیداری خالی بود')
    return out
  }

  if (kind === 'zai') {
    const client = await zai()
    const parts2: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = []
    for (const p of norm) {
      if (p.type === 'text') parts2.push({ type: 'text', text: p.text as string })
      else parts2.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${p.b64}` } })
    }
    const completion = await withRetry(() => Promise.race([
      client.chat.completions.createVision({
        model: 'glm-4.5v',
        messages: [
          { role: 'system', content: system },
          ...history.map((m) => ({ role: m.role, content: m.content })),
          { role: 'user', content: parts2 },
        ],
        thinking: { type: opts.thinking === true ? 'enabled' : 'disabled' },
      }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('مهلت مدل دیداری تمام شد')), ms)),
    ]), Math.max(ms + 60_000, 150_000), 'vision')
    const out = String(completion?.choices?.[0]?.message?.content || '')
    if (!out.trim()) throw new Error('پاسخ مدل دیداری خالی بود')
    return out.trim()
  }

  throw notConfigured('درک تصویر (مدل دیداری)')
}

/* ---------------- web search + page reader ---------------- */

export interface WebHit {
  name: string
  url: string
  snippet: string
  date?: string
}

export async function llmWebSearch(query: string, num = 6): Promise<WebHit[]> {
  const env = llmEnv()
  const kind = await resolveProvider()

  if (kind === 'zai') {
    const client = await zai()
    const results = (await client.functions.invoke('web_search', { query, num, recency_days: 30 })) as unknown
    const arr = Array.isArray(results) ? (results as Record<string, unknown>[]) : []
    return arr
      .slice(0, num)
      .map((r) => ({
        name: String(r.name || r.title || ''),
        url: String(r.url || ''),
        snippet: String(r.snippet || r.content || '').slice(0, 400),
        date: r.date ? String(r.date) : undefined,
      }))
      .filter((h) => h.url)
  }

  if (env.TAVILY_API_KEY) {
    let res: Response
    try {
      res = await fetch(TAVILY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          api_key: env.TAVILY_API_KEY,
          query,
          max_results: num,
          search_depth: 'basic',
          include_answer: false,
        }),
        signal: AbortSignal.timeout(30_000),
      })
    } catch (e) {
      throw new Error(`اتصال به Tavily برقرار نشد: ${e instanceof Error ? e.message.slice(0, 120) : 'خطا'}`)
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`Tavily خطای HTTP ${res.status} داد: ${txt.slice(0, 200)}`)
    }
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> }
    const arr = Array.isArray(data.results) ? data.results : []
    return arr
      .slice(0, num)
      .map((r) => ({
        name: String(r.title || ''),
        url: String(r.url || ''),
        snippet: String(r.content || '').slice(0, 400),
        date: r.published_date ? String(r.published_date) : undefined,
      }))
      .filter((h) => h.url)
  }

  throw new Error(
    'جستجوی وب فقط با یکی از این دو راه در دسترس است: مدل داخلی سندباکس، یا کلید Tavily (TAVILY_API_KEY در .secrets/llm.env — ثبت‌نام رایگان در tavily.com). راهنما: LLM-SETUP.md'
  )
}

export interface PageRead {
  title: string
  text: string
}

export async function llmPageRead(url: string, maxChars = 24_000): Promise<PageRead> {
  const env = llmEnv()
  const kind = await resolveProvider()

  if (kind === 'zai') {
    const client = await zai()
    const res = (await client.functions.invoke('page_reader', { url })) as unknown as {
      data?: { title?: string; html?: string }
    }
    const title = String(res?.data?.title || url)
    const html = String(res?.data?.html || '')
    if (!html) throw new Error('صفحه خالی بود یا خوانده نشد')
    const text = htmlToText(html).slice(0, maxChars)
    if (!text.trim()) throw new Error('متنی از صفحه استخراج نشد')
    return { title, text }
  }

  // openai / none → direct HTTP fetch (no model needed for reading a page)
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        accept: 'text/html,application/xhtml+xml,*/*',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
    })
  } catch (e) {
    throw new Error(`صفحه باز نشد: ${e instanceof Error ? e.message.slice(0, 120) : 'خطا'}`)
  }
  if (!res.ok) throw new Error(`صفحه با کد HTTP ${res.status} پاسخ داد`)
  const raw = (await res.text()).slice(0, 3_000_000)
  const titleMatch = raw.match(/<title[^>]*>([\s\S]{0,300}?)<\/title>/i)
  const title = titleMatch ? htmlToText(titleMatch[1]).slice(0, 200) || url : url
  const text = htmlToText(raw).slice(0, maxChars)
  if (!text.trim()) throw new Error('متنی از صفحه استخراج نشد')
  return { title, text }
}

/** very light html → text (tags off, entities decoded, whitespace squeezed) */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim()
}

/** generate ONE image → { base64, size } */
export async function llmImage(prompt: string, size: string, timeoutMs = 180_000): Promise<string> {
  const env = llmEnv()
  const kind = await resolveProvider()
  const sizeOk = (IMAGE_SIZES.includes(size) ? size : '1024x1024') as
    '1024x1024' | '768x1344' | '864x1152' | '1344x768' | '1152x864' | '1440x720' | '720x1440'

  if (kind === 'openai') {
    const cfg = openaiCfg(env)
    const imageModel = env.LLM_IMAGE_MODEL || 'dall-e-3'
    // gpt-image-* models reject response_format (b64 is their default)
    const body: Record<string, unknown> = { model: imageModel, prompt, size: sizeOk }
    if (!imageModel.startsWith('gpt-image')) body.response_format = 'b64_json'
    const data = await oaiPost(cfg, '/images/generations', body, timeoutMs)
    const arr = (data.data as Array<Record<string, unknown>> | undefined) || []
    const b64 = String(arr[0]?.b64_json || arr[0]?.base64 || '')
    if (!b64) throw new Error('سرویس شما خروجی تصویر نداد — احتمالاً مدل تصویر پشتیبانی نمی‌شود (LLM_IMAGE_MODEL را در llm.env تنظیم کنید)')
    return b64
  }

  if (kind === 'zai') {
    const client = await zai()
    const res = await withRetry(() => Promise.race([
      client.images.generations.create({ prompt, size: sizeOk }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('مهلت تولید تصویر تمام شد')), timeoutMs)),
    ]), Math.max(timeoutMs + 60_000, 240_000), 'image')
    const b64 = res?.data?.[0]?.base64
    if (!b64) throw new Error('خروجی تصویر خالی بود')
    return b64
  }

  throw notConfigured('تولید تصویر')
}

/** correct file extension from the actual magic bytes (JPEG vs PNG) */
export function imageExtFromBase64(b64: string): '.jpg' | '.png' {
  const head = b64.slice(0, 8)
  try {
    const buf = Buffer.from(head, 'base64')
    if (buf[0] === 0xff && buf[1] === 0xd8) return '.jpg'
    if (buf[0] === 0x89 && buf[1] === 0x50) return '.png'
  } catch {
    /* fallthrough */
  }
  return '.png'
}

/* ---------------- smart gen bridges (Persian → English) ---------------------
 * The image/video APIs work far better with English prompts (the image
 * content-filter even rejects many non-English prompts with code 1301), so
 * any prompt with Persian/Arabic script is first turned into a rich English
 * prompt by the LLM. This is the owner's PRIVATE panel: the bridge must
 * translate faithfully and completely — never soften, censor, moralize or
 * drop details from the owner's prompt. */
export async function promptBridge(prompt: string, kind: 'image' | 'video'): Promise<string> {
  const hasPersian = /[\u0600-\u06FF]/.test(prompt)
  if (!hasPersian) return prompt
  // the bridge is an OPTIONAL polish call — while the account is rate-limited
  // skip it entirely and feed the original prompt to the generator
  if (llmCooldownActive()) return prompt
  try {
    const out = await llmChat(
      kind === 'image'
        ? 'این یک درخواست تولید تصویر برای پنل شخصی مالک است. آن را به یک پرامپت انگلیسی روان، تصویری و غنی (با جزئیات بصری: نور، رنگ، حال‌وهوا، سبک) ترجمه و بازنویسی کن. ترجمه باید صادقانه و کامل باشه — هیچ کلمه‌ای را حذف، تعدیل یا سانسور نکن و هیچ قضاوت اخلاقی اضافه نکن. فقط و فقط خودِ پرامپت انگلیسی را در یک خط بنویس — بدون هیچ توضیح، نقل قول یا متن اضافه.'
        : 'این یک درخواست تولید ویدیو برای پنل شخصی مالک است. آن را به یک پرامپت انگلیسی روان و سینمایی (حرکت دوربین، صحنه‌آرایی، نور، حال‌وهوا) ترجمه و بازنویسی کن. ترجمه باید صادقانه و کامل باشه — هیچ کلمه‌ای را حذف، تعدیل یا سانسور نکن. فقط و فقط خودِ پرامپت انگلیسی را در یک خط بنویس — بدون هیچ توضیح، نقل قول یا متن اضافه.',
      [{ role: 'user', content: prompt.slice(0, 900) }],
      { thinking: false, timeoutMs: 30_000 }
    )
    const clean = out.replace(/^["'\s]+|["'\s]+$/g, '').slice(0, 1200)
    return clean && /[a-zA-Z]/.test(clean) ? clean : prompt
  } catch {
    return prompt
  }
}

export async function llmImageSmart(prompt: string, size: string, timeoutMs = 200_000): Promise<string> {
  const finalPrompt = await promptBridge(prompt, 'image')
  try {
    return await llmImage(finalPrompt, size, timeoutMs)
  } catch (e) {
    // provider-side content filter (HTTP 400 / code 1301) is sometimes
    // transient — one honest retry with the original prompt before giving up
    const msg = e instanceof Error ? e.message : String(e)
    if (/1301|content|filter|سانسور|حساس/i.test(msg)) {
      return llmImage(prompt, size, timeoutMs)
    }
    throw e
  }
}
