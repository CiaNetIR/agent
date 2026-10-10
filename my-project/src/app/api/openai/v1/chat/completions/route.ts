/**
 * OpenAI-compatible: POST /api/openai/v1/chat/completions
 * Proxies coding tools (OpenCode / Cline / …) to the panel's AI provider.
 *
 * - Auth: Authorization: Bearer <OPENAI_PROXY_KEY>  (rotatable from the panel)
 * - Honors the shared 429 circuit-breaker cooldown file.
 * - stream:true → SSE pass-through (provider is already OpenAI-chunk-shaped).
 * - Model aliases: "glm-4.7" (fast) / "glm-4.7-thinking" (deep reasoning).
 */
import {
  CORS_HEADERS,
  bumpCooldown,
  cooldownRemainingMs,
  normalizeMessages,
  openaiError,
  providerHeaders,
  readZaiConfig,
  resetCooldownStreak,
  verifyBearer,
} from '@/lib/openai-proxy'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(req: Request) {
  if (!verifyBearer(req.headers.get('authorization'))) {
    return openaiError(401, 'Invalid API key — کلید را از تب «API و اتصال» پنل بردار', 'invalid_request_error', 'invalid_api_key')
  }

  const cooldown = cooldownRemainingMs()
  if (cooldown > 0) {
    return openaiError(
      429,
      'Upstream provider rate-limited — the shared circuit breaker is cooling down. Retry shortly.',
      'rate_limit_error',
      'rate_limit_exceeded',
      { 'Retry-After': String(Math.ceil(cooldown / 1000)) },
    )
  }

  const cfg = readZaiConfig()
  if (!cfg) {
    return openaiError(503, 'Provider config missing on server (/etc/.z-ai-config)', 'server_error', 'provider_unconfigured')
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return openaiError(400, 'Invalid JSON body', 'invalid_request_error', 'invalid_json')
  }

  const modelRaw = String(body.model ?? 'glm-4.7')
  const thinkingOn = modelRaw.endsWith('-thinking') || (body.thinking as { type?: string } | undefined)?.type === 'enabled'
  const model = modelRaw.replace(/-thinking$/, '')
  const messages = normalizeMessages(body.messages)
  if (messages.length === 0) {
    return openaiError(400, 'messages[] is required (non-empty system/user/assistant)', 'invalid_request_error', 'missing_messages')
  }
  const stream = body.stream === true

  // forward everything the client sent, overriding our knobs
  const payload: Record<string, unknown> = { ...body }
  if (typeof body.max_completion_tokens === 'number' && typeof body.max_tokens !== 'number') {
    payload.max_tokens = body.max_completion_tokens
  }
  delete payload.max_completion_tokens
  delete payload.thinking
  payload.model = model
  payload.messages = messages
  payload.thinking = { type: thinkingOn ? 'enabled' : 'disabled' }
  payload.stream = stream

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 290_000)
  let res: Response
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: providerHeaders(cfg),
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    const msg = e instanceof Error && e.name === 'AbortError' ? 'Upstream timeout (290s)' : 'Upstream fetch failed'
    return openaiError(502, msg, 'server_error', 'upstream_unreachable')
  }
  clearTimeout(timer)

  if (res.status === 429) {
    bumpCooldown()
    const left = Math.ceil(cooldownRemainingMs() / 1000)
    return openaiError(429, 'Upstream provider rate-limited (429) — cooldown bumped.', 'rate_limit_error', 'rate_limit_exceeded', {
      'Retry-After': String(Math.max(30, left)),
    })
  }

  if (!res.ok) {
    let snippet = ''
    try {
      snippet = (await res.text()).slice(0, 300)
    } catch {
      /* ignore */
    }
    return openaiError(502, `Upstream provider error (HTTP ${res.status}): ${snippet}`, 'server_error', 'upstream_error')
  }

  resetCooldownStreak()

  if (stream && res.body) {
    return new Response(res.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
        ...CORS_HEADERS,
      },
    })
  }

  const data = await res.json().catch(() => ({}))
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}
