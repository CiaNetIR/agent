/**
 * CiaNet panel — multi-provider LLM manager (server-side only).
 *
 * Providers are OpenAI-compatible endpoints (OpenAI, OpenRouter, DeepSeek,
 * Groq, Ollama, LM Studio, vLLM, LocalAI …) plus the internal Z.ai SDK.
 *
 * Storage split (security):
 *  - metadata  → .secrets/llm-providers.json   (no secrets; rides the
 *    existing belt-and-braces backup → private repo + recovery zips)
 *  - API keys  → /home/z/.llm-keys/keys.json   (mode 600, OUTSIDE every
 *    synced tree → never reaches git, zips or the mirror)
 *
 * Nothing here is importable from the browser — routes only.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { zaiChat, type PanelChatMsg } from './llm-provider'

/* ------------------------------- types ------------------------------- */

export type ProviderKind = 'openai-compatible' | 'zai'

export type ProviderStatus = 'unknown' | 'checking' | 'connected' | 'error' | 'disabled' | 'needs-setup'

export interface LlmTestRecord {
  at: string
  ok: boolean
  latencyMs?: number
  model?: string
  /** classified Persian error for the UI (never contains the API key) */
  error?: string
  errorKind?: LlmErrorKind
}

export interface LlmModelMeta {
  id: string
  name?: string
  source: 'auto' | 'manual'
  enabled: boolean
  addedAt: string
  lastTest?: LlmTestRecord
}

export interface LlmProviderMeta {
  id: string
  name: string
  kind: ProviderKind
  baseUrl?: string
  defaultModel?: string
  timeoutMs: number
  enabled: boolean
  models: LlmModelMeta[]
  lastTest?: LlmTestRecord
  createdAt: string
  updatedAt: string
}

export type CapabilityId = 'chat' | 'agent' | 'fast' | 'complex' | 'background' | 'telegram'

export interface LlmGenSettings {
  temperature?: number
  topP?: number
  maxTokens?: number
  retries: number
  streaming: boolean
}

export interface LlmDefaults {
  /** capability → "providerId/modelId" (modelId optional for zai) */
  selection: Partial<Record<CapabilityId, string>>
  /** providerIds tried in order when the selected model fails */
  fallbackOrder: string[]
  settings: LlmGenSettings
}

export type LlmErrorKind =
  | 'auth'
  | 'endpoint'
  | 'model'
  | 'permission'
  | 'timeout'
  | 'unreachable'
  | 'bad-response'
  | 'compat'
  | 'unknown'

export interface ProviderPublic extends LlmProviderMeta {
  /** masked, e.g. "sk-…ab12" — never the raw key */
  keyMasked: string | null
}

/* ------------------------------- storage ------------------------------- */

const SECRETS_DIR = '/home/z/my-project/.secrets'
const META_FILE = path.join(SECRETS_DIR, 'llm-providers.json')
const KEYS_DIR = '/home/z/.llm-keys'
const KEYS_FILE = path.join(KEYS_DIR, 'keys.json')

const DEFAULT_TIMEOUT_MS = 60_000
export const CAPABILITY_LABELS: Record<CapabilityId, string> = {
  chat: 'گفتگوی عمومی',
  agent: 'ایجنت اصلی',
  fast: 'وظایف سریع و سبک',
  complex: 'تحلیل و وظایف پیچیده',
  background: 'سرویس‌های پس‌زمینه',
  telegram: 'واتچر تلگرام',
}

function nowIso(): string {
  return new Date().toISOString()
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

/** atomic write (tmp + rename) so a crash never truncates the store */
function writeJsonAtomic(file: string, data: unknown, dir: string): void {
  mkdirSync(dir, { recursive: true })
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
  renameSync(tmp, file)
}

interface KeysFile {
  [providerId: string]: string
}

function readKeys(): KeysFile {
  return readJson<KeysFile>(KEYS_FILE, {})
}

function writeKeys(keys: KeysFile): void {
  writeJsonAtomic(KEYS_FILE, keys, KEYS_DIR)
}

export function getApiKey(providerId: string): string {
  return readKeys()[providerId] || ''
}

function setApiKey(providerId: string, key: string | null): void {
  const keys = readKeys()
  if (key) keys[providerId] = key
  else delete keys[providerId]
  writeKeys(keys)
}

/* ---------------------------- provider store ---------------------------- */

interface MetaFile {
  version: 1
  providers: LlmProviderMeta[]
  defaults: LlmDefaults
}

const DEFAULT_DEFAULTS: LlmDefaults = {
  selection: {},
  fallbackOrder: [],
  settings: { retries: 1, streaming: true },
}

function readMeta(): MetaFile {
  const raw = readJson<Partial<MetaFile>>(META_FILE, {})
  return {
    version: 1,
    providers: Array.isArray(raw.providers) ? raw.providers : [],
    defaults: { ...DEFAULT_DEFAULTS, ...(raw.defaults || {}) },
  }
}

function writeMeta(meta: MetaFile): void {
  writeJsonAtomic(META_FILE, meta, SECRETS_DIR)
}

export function listProviders(): LlmProviderMeta[] {
  return readMeta().providers
}

export function getDefaults(): LlmDefaults {
  return readMeta().defaults
}

export function saveDefaults(next: LlmDefaults): LlmDefaults {
  const meta = readMeta()
  // only allow real provider ids in fallbackOrder
  const ids = new Set(meta.providers.map((p) => p.id))
  const defaults: LlmDefaults = {
    selection: next.selection || {},
    fallbackOrder: (next.fallbackOrder || []).filter((id) => ids.has(id)),
    settings: {
      temperature: clampNum(next.settings?.temperature, 0, 2, undefined),
      topP: clampNum(next.settings?.topP, 0, 1, undefined),
      maxTokens: clampNum(next.settings?.maxTokens, 1, 200_000, undefined),
      retries: clampNum(next.settings?.retries, 0, 3, 1) as number,
      streaming: next.settings?.streaming !== false,
    },
  }
  meta.defaults = defaults
  writeMeta(meta)
  return defaults
}

export function findProvider(id: string): LlmProviderMeta | undefined {
  return listProviders().find((p) => p.id === id)
}

/* ---------------------------- validation ---------------------------- */

export interface ProviderInput {
  name?: unknown
  kind?: unknown
  baseUrl?: unknown
  apiKey?: unknown
  defaultModel?: unknown
  timeoutMs?: unknown
  enabled?: unknown
}

export function validateProviderInput(
  input: ProviderInput,
  opts: { partial?: LlmProviderMeta } = {}
): { ok: true; value: {
  name: string
  kind: ProviderKind
  baseUrl?: string
  apiKey?: string | null
  defaultModel?: string
  timeoutMs: number
  enabled: boolean
} } | { ok: false; error: string } {
  const partial = opts.partial

  const name = typeof input.name === 'string' ? input.name.trim() : partial?.name ?? ''
  if (!name || name.length > 40) return { ok: false, error: 'نام اتصال باید بین ۱ تا ۴۰ نویسه باشد' }

  const kindRaw = typeof input.kind === 'string' ? input.kind : partial?.kind ?? 'openai-compatible'
  if (kindRaw !== 'openai-compatible' && kindRaw !== 'zai') {
    return { ok: false, error: 'نوع اتصال پشتیبانی نمی‌شود' }
  }
  const kind: ProviderKind = kindRaw

  let baseUrl: string | undefined
  if (kind === 'openai-compatible') {
    const raw = typeof input.baseUrl === 'string' ? input.baseUrl.trim() : partial?.baseUrl ?? ''
    if (!raw) return { ok: false, error: 'آدرس Base URL لازم است' }
    let u: URL
    try {
      u = new URL(raw)
    } catch {
      return { ok: false, error: 'آدرس Base URL معتبر نیست' }
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { ok: false, error: 'فقط آدرس‌های http و https پذیرفته می‌شوند' }
    }
    if (u.username || u.password) return { ok: false, error: 'قرار دادن رمز داخل آدرس مجاز نیست' }
    if (u.hash) return { ok: false, error: 'آدرس نباید شامل fragment باشد' }
    baseUrl = u.toString().replace(/\/+$/, '')
  }

  let apiKey: string | null | undefined
  if (kind === 'zai') {
    apiKey = null // internal SDK — no key
  } else if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    apiKey = input.apiKey.trim().slice(0, 512)
  } else if (input.apiKey === null) {
    apiKey = null // explicit clear
  } else {
    apiKey = partial ? undefined : null // undefined = keep existing
  }

  let defaultModel: string | undefined
  const dmRaw = typeof input.defaultModel === 'string' ? input.defaultModel.trim() : partial?.defaultModel
  if (dmRaw) {
    if (!/^[a-zA-Z0-9._:\-\/]{1,120}$/.test(dmRaw)) {
      return { ok: false, error: 'شناسه مدل فقط می‌تواند شامل حروف، رقم، نقطه، خط تیره، دونقطه و اسلش باشد' }
    }
    defaultModel = dmRaw
  }

  const timeoutMs = clampNum(
    typeof input.timeoutMs === 'number' ? input.timeoutMs : partial?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    5_000, 180_000, DEFAULT_TIMEOUT_MS
  ) as number

  const enabled = typeof input.enabled === 'boolean' ? input.enabled : partial?.enabled ?? true

  return { ok: true, value: { name, kind, baseUrl, apiKey, defaultModel, timeoutMs, enabled } }
}

/* ---------------------------- CRUD ---------------------------- */

export function createProvider(input: ProviderInput):
  { ok: true; provider: LlmProviderMeta } | { ok: false; error: string } {
  const v = validateProviderInput(input)
  if (!v.ok) return v
  const meta = readMeta()
  if (meta.providers.some((p) => p.name === v.value.name)) {
    return { ok: false, error: 'اتصالی با این نام از قبل موجود است' }
  }
  const provider: LlmProviderMeta = {
    id: randomUUID(),
    name: v.value.name,
    kind: v.value.kind,
    baseUrl: v.value.baseUrl,
    defaultModel: v.value.defaultModel,
    timeoutMs: v.value.timeoutMs,
    enabled: v.value.enabled,
    models: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  meta.providers.push(provider)
  writeMeta(meta)
  if (v.value.apiKey) setApiKey(provider.id, v.value.apiKey)
  return { ok: true, provider }
}

export function updateProvider(id: string, input: ProviderInput):
  { ok: true; provider: LlmProviderMeta } | { ok: false; error: string } {
  const meta = readMeta()
  const idx = meta.providers.findIndex((p) => p.id === id)
  if (idx === -1) return { ok: false, error: 'اتصال یافت نشد' }
  const v = validateProviderInput(input, { partial: meta.providers[idx] })
  if (!v.ok) return v
  if (meta.providers.some((p, i) => i !== idx && p.name === v.value.name)) {
    return { ok: false, error: 'اتصالی با این نام از قبل موجود است' }
  }
  const prev = meta.providers[idx]
  const next: LlmProviderMeta = {
    ...prev,
    name: v.value.name,
    kind: v.value.kind,
    baseUrl: v.value.baseUrl,
    defaultModel: v.value.defaultModel,
    timeoutMs: v.value.timeoutMs,
    enabled: v.value.enabled,
    updatedAt: nowIso(),
  }
  meta.providers[idx] = next
  writeMeta(meta)
  if (v.value.apiKey !== undefined) setApiKey(id, v.value.apiKey || null)
  return { ok: true, provider: next }
}

export function deleteProvider(id: string): boolean {
  const meta = readMeta()
  const before = meta.providers.length
  meta.providers = meta.providers.filter((p) => p.id !== id)
  if (meta.providers.length === before) return false
  // clean defaults references
  const sel: LlmDefaults['selection'] = {}
  for (const [cap, ref] of Object.entries(meta.defaults.selection)) {
    if (ref && ref.startsWith(`${id}/`)) continue
    sel[cap as CapabilityId] = ref
  }
  meta.defaults.selection = sel
  meta.defaults.fallbackOrder = meta.defaults.fallbackOrder.filter((x) => x !== id)
  writeMeta(meta)
  setApiKey(id, null)
  return true
}

/* ---------------------------- model registry ---------------------------- */

export function addModel(providerId: string, modelId: string, name?: string, source: 'auto' | 'manual' = 'manual'):
  { ok: true; provider: LlmProviderMeta } | { ok: false; error: string } {
  const mid = modelId.trim()
  if (!/^[a-zA-Z0-9._:\-\/]{1,120}$/.test(mid)) return { ok: false, error: 'شناسه مدل معتبر نیست' }
  const meta = readMeta()
  const p = meta.providers.find((x) => x.id === providerId)
  if (!p) return { ok: false, error: 'اتصال یافت نشد' }
  if (p.models.some((m) => m.id === mid)) return { ok: false, error: 'این مدل قبلاً اضافه شده' }
  p.models.push({ id: mid, name: name?.slice(0, 80), source, enabled: true, addedAt: nowIso() })
  p.updatedAt = nowIso()
  writeMeta(meta)
  return { ok: true, provider: p }
}

export function removeModel(providerId: string, modelId: string): boolean {
  const meta = readMeta()
  const p = meta.providers.find((x) => x.id === providerId)
  if (!p) return false
  const before = p.models.length
  p.models = p.models.filter((m) => m.id !== modelId)
  if (p.models.length === before) return false
  if (p.defaultModel === modelId) p.defaultModel = undefined
  p.updatedAt = nowIso()
  writeMeta(meta)
  return true
}

export function setModelEnabled(providerId: string, modelId: string, enabled: boolean): boolean {
  const meta = readMeta()
  const p = meta.providers.find((x) => x.id === providerId)
  if (!p) return false
  const m = p.models.find((x) => x.id === modelId)
  if (!m) return false
  m.enabled = enabled
  p.updatedAt = nowIso()
  writeMeta(meta)
  return true
}

/* ---------------------------- masking ---------------------------- */

export function maskKey(key: string): string | null {
  if (!key) return null
  if (key.length <= 8) return `${key.slice(0, 2)}…`
  return `${key.slice(0, 5)}…${key.slice(-4)}`
}

export function toPublic(p: LlmProviderMeta): ProviderPublic {
  return { ...p, keyMasked: maskKey(getApiKey(p.id)) }
}

export function providerStatus(p: LlmProviderMeta): ProviderStatus {
  if (!p.enabled) return 'disabled'
  if (p.kind === 'openai-compatible' && !p.baseUrl) return 'needs-setup'
  if (!p.lastTest) return 'unknown'
  if (p.lastTest.ok) return 'connected'
  return 'error'
}

/* ---------------------------- error classification ---------------------------- */

export function classifyLlmError(e: unknown, status?: number): { kind: LlmErrorKind; message: string } {
  const raw = e instanceof Error ? e.message : String(e)
  const low = raw.toLowerCase()
  if (status === 401 || status === 403 || low.includes('unauthorized') || low.includes('invalid api key') || low.includes('incorrect api key')) {
    return { kind: 'auth', message: 'کلید API نامعتبر است یا دسترسی ندارید' }
  }
  if (status === 404 || low.includes('model_not_found') || low.includes('does not exist') || low.includes('no such model')) {
    return { kind: 'model', message: 'مدل موردنظر روی این سرویس موجود نیست' }
  }
  if (status === 429 || low.includes('rate limit') || low.includes('quota')) {
    return { kind: 'permission', message: 'محدودیت نرخ یا سهمیه — کمی بعد دوباره تلاش کنید' }
  }
  if (low.includes('timeout') || low.includes('aborted') || low.includes('مهلت')) {
    return { kind: 'timeout', message: 'مهلت پاسخ به پایان رسید (Timeout)' }
  }
  if (low.includes('enotfound') || low.includes('eai_again') || low.includes('econnrefused') || low.includes('fetch failed') || low.includes('network')) {
    return { kind: 'unreachable', message: 'سرویس در دسترس نیست — آدرس Endpoint را بررسی کنید' }
  }
  if (low.includes('unexpected token') || low.includes('invalid json') || low.includes('failed to parse')) {
    return { kind: 'compat', message: 'پاسخ سرویس با فرمت OpenAI سازگار نیست' }
  }
  if (status && status >= 400) {
    return { kind: 'bad-response', message: `سرویس خطای HTTP ${status} داد` }
  }
  return { kind: 'unknown', message: raw.slice(0, 160) || 'خطای ناشناخته' }
}

/* ---------------------------- real network calls ---------------------------- */

async function openaiChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  system: string,
  messages: PanelChatMsg[],
  opts: { timeoutMs: number; temperature?: number; topP?: number; maxTokens?: number }
): Promise<{ content: string; model: string }> {
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
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: system }, ...messages],
        ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
        ...(opts.topP != null ? { top_p: opts.topP } : {}),
        ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
      }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    })
  } catch (e) {
    throw classifyLlmError(e)
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => '')
    const cls = classifyLlmError(new Error(txt.slice(0, 400) || `HTTP ${res.status}`), res.status)
    throw cls
  }
  let data: { choices?: Array<{ message?: { content?: unknown } }>; model?: string }
  try {
    data = (await res.json()) as typeof data
  } catch {
    throw classifyLlmError(new Error('invalid json response'))
  }
  const content = String(data.choices?.[0]?.message?.content || '').trim()
  if (!content) throw classifyLlmError(new Error('empty choices'))
  return { content, model: data.model || model }
}

/** real connection test with a tiny prompt — no fake results, ever */
export async function testProvider(
  providerId: string,
  modelId?: string
): Promise<{ ok: true; record: LlmTestRecord } | { ok: false; error: string; kind?: LlmErrorKind; record: LlmTestRecord }> {
  const p = findProvider(providerId)
  if (!p) return { ok: false, error: 'اتصال یافت نشد', record: { at: nowIso(), ok: false } }
  const model = (modelId || p.defaultModel || p.models.find((m) => m.enabled)?.id || '').trim()
  if (p.kind === 'openai-compatible' && !model) {
    const record: LlmTestRecord = { at: nowIso(), ok: false, error: 'مدلی برای تست مشخص نیست — ابتدا مدل اضافه کنید', errorKind: 'model' }
    persistTest(p.id, modelId, record)
    return { ok: false, error: record.error!, kind: 'model', record }
  }

  const t0 = Date.now()
  try {
    let out: { content: string; model: string }
    if (p.kind === 'zai') {
      out = await zaiChat('تو یک تست اتصال هستی. فقط بنویس: متصل', [
        { role: 'user', content: 'سلام' },
      ], { thinking: false, timeoutMs: p.timeoutMs })
    } else {
      out = await openaiChat(p.baseUrl!, getApiKey(p.id), model, 'تو یک تست اتصال هستی. فقط بنویس: متصل', [
        { role: 'user', content: 'سلام' },
      ], { timeoutMs: p.timeoutMs })
    }
    const record: LlmTestRecord = { at: nowIso(), ok: true, latencyMs: Date.now() - t0, model: out.model }
    persistTest(p.id, modelId, record)
    return { ok: true, record }
  } catch (e) {
    const cls = e as { kind?: LlmErrorKind; message?: string }
    const kind: LlmErrorKind = cls.kind || 'unknown'
    const record: LlmTestRecord = { at: nowIso(), ok: false, model, error: cls.message || 'خطای ناشناخته', errorKind: kind }
    persistTest(p.id, modelId, record)
    return { ok: false, error: record.error!, kind, record }
  }
}

function persistTest(providerId: string, modelId: string | undefined, record: LlmTestRecord): void {
  const meta = readMeta()
  const p = meta.providers.find((x) => x.id === providerId)
  if (!p) return
  p.lastTest = record
  if (modelId) {
    const m = p.models.find((x) => x.id === modelId)
    if (m) m.lastTest = record
  }
  writeMeta(meta)
}

/** list remote models — GET {base}/models (OpenAI-compatible) */
export async function listRemoteModels(
  providerId: string
): Promise<{ ok: true; models: { id: string; name?: string }[] } | { ok: false; error: string; kind?: LlmErrorKind }> {
  const p = findProvider(providerId)
  if (!p) return { ok: false, error: 'اتصال یافت نشد' }
  if (p.kind === 'zai') return { ok: true, models: [{ id: 'glm-4-plus', name: 'GLM 4 Plus (داخلی)' }] }
  if (!p.baseUrl) return { ok: false, error: 'Base URL تنظیم نشده', kind: 'endpoint' }
  try {
    const res = await fetch(`${p.baseUrl}/models`, {
      headers: { ...(getApiKey(p.id) ? { authorization: `Bearer ${getApiKey(p.id)}` } : {}) },
      signal: AbortSignal.timeout(Math.min(p.timeoutMs, 30_000)),
    })
    if (!res.ok) {
      const cls = classifyLlmError(new Error(`HTTP ${res.status}`), res.status)
      return { ok: false, error: cls.message, kind: cls.kind }
    }
    const data = (await res.json()) as { data?: Array<{ id?: string; owned_by?: string }> }
    const models = (data.data || [])
      .map((m): { id: string; name?: string } | null =>
        typeof m?.id === 'string' ? { id: m.id, ...(m.owned_by ? { name: m.owned_by } : {}) } : null
      )
      .filter((m): m is { id: string; name?: string } => m !== null)
      .sort((a, b) => a.id.localeCompare(b.id))
    return { ok: true, models }
  } catch (e) {
    const cls = classifyLlmError(e)
    return { ok: false, error: cls.message, kind: cls.kind }
  }
}

/* ---------------------------- resolution + fallback ---------------------------- */

export interface ResolvedTarget {
  provider: LlmProviderMeta
  model?: string
}

/** parse "providerId" or "providerId/modelId" */
function parseRef(ref: string | undefined): { providerId: string; modelId?: string } | null {
  if (!ref) return null
  const [pid, ...rest] = ref.split('/')
  if (!pid) return null
  return { providerId: pid, modelId: rest.join('/') || undefined }
}

/**
 * Build the try-order for a capability:
 *  1. the capability's selected model (if provider enabled)
 *  2. fallbackOrder providers (their default/first enabled model)
 * Order is deterministic; disabled providers are skipped.
 */
export function resolveChain(capability: CapabilityId): ResolvedTarget[] {
  const meta = readMeta()
  const byId = new Map(meta.providers.map((p) => [p.id, p]))
  const chain: ResolvedTarget[] = []
  const seen = new Set<string>()

  const ref = parseRef(meta.defaults.selection[capability])
  if (ref) {
    const p = byId.get(ref.providerId)
    if (p && p.enabled) {
      chain.push({ provider: p, model: ref.modelId || p.defaultModel || p.models.find((m) => m.enabled)?.id })
      seen.add(p.id)
    }
  }
  for (const pid of meta.defaults.fallbackOrder) {
    if (seen.has(pid)) continue
    const p = byId.get(pid)
    if (p && p.enabled) {
      chain.push({ provider: p, model: p.defaultModel || p.models.find((m) => m.enabled)?.id })
      seen.add(p.id)
    }
  }
  return chain
}

export interface ChatHopError {
  providerName: string
  model?: string
  error: string
}

export interface ManagedChatResult {
  content: string
  model: string
  providerName: string
  latencyMs: number
  /** filled when at least one hop failed before success */
  hopErrors: ChatHopError[]
}

/**
 * Chat through the managed chain for a capability. Every hop is a REAL
 * call; on failure the next provider is tried (retries per settings).
 * Returns the first success plus the hop errors for transparency.
 */
export async function managedChat(
  capability: CapabilityId,
  system: string,
  messages: PanelChatMsg[],
  opts: { thinking?: boolean; overrideProviderId?: string; overrideModelId?: string } = {}
): Promise<ManagedChatResult> {
  const defaults = getDefaults()
  const hopErrors: ChatHopError[] = []
  const t0 = Date.now()

  const targets: ResolvedTarget[] = opts.overrideProviderId
    ? [{
        provider: (() => {
          const p = findProvider(opts.overrideProviderId)
          if (!p) throw new Error('اتصال انتخاب‌شده یافت نشد')
          return p
        })(),
        model: opts.overrideModelId,
      }]
    : resolveChain(capability)

  if (targets.length === 0) {
    throw new Error('مدلی برای این قابلیت تنظیم نشده — در بخش «مدل‌ها» یک اتصال بسازید و مدل پیش‌فرض را انتخاب کنید')
  }

  let lastErr: ChatHopError | null = null
  for (const target of targets) {
    const p = target.provider
    const model = target.model || (p.kind === 'zai' ? 'glm-4-plus' : p.defaultModel)
    if (p.kind === 'openai-compatible' && !model) {
      hopErrors.push({ providerName: p.name, error: 'مدلی برای این اتصال تنظیم نشده' })
      lastErr = hopErrors[hopErrors.length - 1]
      continue
    }
    const attempts = 1 + Math.min(2, Math.max(0, defaults.settings.retries))
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        let out: { content: string; model: string }
        if (p.kind === 'zai') {
          out = await zaiChat(system, messages, { thinking: opts.thinking, timeoutMs: p.timeoutMs })
        } else {
          out = await openaiChat(p.baseUrl!, getApiKey(p.id), model!, system, messages, {
            timeoutMs: p.timeoutMs,
            temperature: defaults.settings.temperature,
            topP: defaults.settings.topP,
            maxTokens: defaults.settings.maxTokens,
          })
        }
        return {
          content: out.content,
          model: out.model,
          providerName: p.name,
          latencyMs: Date.now() - t0,
          hopErrors,
        }
      } catch (e) {
        const cls = e as { kind?: LlmErrorKind; message?: string }
        lastErr = { providerName: p.name, model, error: cls.message || 'خطا' }
        // auth/model errors won't heal on retry — break to next hop
        if (cls.kind === 'auth' || cls.kind === 'model' || cls.kind === 'permission') break
      }
    }
    hopErrors.push(lastErr!)
  }
  throw new Error(
    `هیچ مدلی پاسخ نداد — ${hopErrors.map((h) => `${h.providerName}: ${h.error}`).join(' | ').slice(0, 300)}`
  )
}

/** any managed provider configured at all? (else legacy env/zai path) */
export function hasManagedProviders(): boolean {
  return listProviders().length > 0
}

/* ---------------------------- misc ---------------------------- */

function clampNum(v: unknown, min: number, max: number, dflt: number | undefined): number | undefined {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(max, Math.max(min, n))
}

export function storeExists(): boolean {
  return existsSync(META_FILE)
}
