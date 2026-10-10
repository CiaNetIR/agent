/**
 * GET  /api/connection-info  (x-panel-key) — everything the owner needs to
 *      plug coding tools into the panel's AI: proxy key, model list, direct
 *      provider credentials (reveal/copy happens client-side behind panel
 *      auth) and the API-monitor status.
 * POST /api/connection-info  (x-panel-key) — { action: 'rotate' } regenerates
 *      the proxy key (takes effect immediately, no service restart).
 */
import { readJsonSafe, verifyKey } from '@/lib/panel-server'
import { PROXY_MODELS, getProxyKey, readZaiConfig, rotateProxyKey } from '@/lib/openai-proxy'

export const dynamic = 'force-dynamic'

const MONITOR_STATE = '/home/z/agent-files/api-monitor-state.json'

function monitorStatus() {
  const st = readJsonSafe<Record<string, unknown>>(MONITOR_STATE, {})
  const aliveAt = Number(st.aliveAt) || 0
  return {
    alive: aliveAt > 0 && Date.now() - aliveAt < 180_000,
    lastPingAt: Number(st.lastPingAt) || 0,
    lastPingOk: st.lastPingOk === true,
    lastPingStatus: st.lastPingStatus ?? null,
    lastChangeAt: Number(st.fingerprintAt) || 0,
    failCount: Number(st.failCount) || 0,
    startedAt: Number(st.startedAt) || 0,
  }
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ ok: false, error: 'unauthorized' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}

export async function GET(req: Request) {
  if (!verifyKey(req.headers.get('x-panel-key'))) return unauthorized()
  const proxy = getProxyKey()
  const zai = readZaiConfig()
  return new Response(
    JSON.stringify({
      ok: true,
      proxyKey: proxy.key,
      proxyKeyConfigured: Boolean(proxy.key && proxy.sha),
      models: PROXY_MODELS,
      direct: zai
        ? { baseUrl: zai.baseUrl, apiKey: zai.apiKey, token: zai.token, chatId: zai.chatId, userId: zai.userId }
        : null,
      monitor: monitorStatus(),
      generatedAt: Date.now(),
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}

export async function POST(req: Request) {
  if (!verifyKey(req.headers.get('x-panel-key'))) return unauthorized()
  let action = ''
  try {
    const body = (await req.json()) as { action?: string }
    action = String(body.action ?? '')
  } catch {
    /* empty body */
  }
  if (action !== 'rotate') {
    return new Response(JSON.stringify({ ok: false, error: 'unknown action' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const fresh = rotateProxyKey()
  if (!fresh) {
    return new Response(JSON.stringify({ ok: false, error: 'rotation failed — check server logs' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return new Response(JSON.stringify({ ok: true, proxyKey: fresh }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}
