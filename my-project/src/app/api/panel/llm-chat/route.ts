import { NextRequest, NextResponse } from 'next/server'
import { verifyKey } from '@/lib/panel-server'
import { audit } from '@/lib/panel-ops'
import { panelLlmChat, panelProviderInfo } from '@/lib/llm-provider'
import {
  getDefaults,
  hasManagedProviders,
  managedChat,
  type CapabilityId,
} from '@/lib/llm-providers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Live LLM playground + panel chat entrypoint.
 *
 * GET  → active provider info (legacy badge) + managed defaults status
 * POST → one completion. Resolution order:
 *   1. explicit providerId/modelId override (playground "test this model")
 *   2. managed chain for the capability (defaults + fallback) when any
 *      managed provider exists
 *   3. legacy single-provider path (.secrets/llm.env / zai SDK)
 */

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

interface ChatBody {
  messages?: ChatMsg[]
  system?: string
  thinking?: boolean
  capability?: string
  providerId?: string
  modelId?: string
}

const CAPABILITIES: CapabilityId[] = ['chat', 'agent', 'fast', 'complex', 'background', 'telegram']

export async function GET(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  return NextResponse.json({
    ok: true,
    provider: await panelProviderInfo(),
    managed: hasManagedProviders(),
    defaults: getDefaults(),
  })
}

export async function POST(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let body: ChatBody
  try {
    body = (await req.json()) as ChatBody
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400 })
  }

  const msgs = Array.isArray(body.messages) ? body.messages : []
  const clean = msgs
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map((m) => ({
      role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: m.content.slice(0, 4000),
    }))

  if (clean.length === 0 || clean[clean.length - 1].role !== 'user') {
    return NextResponse.json({ ok: false, error: 'پیامی برای ارسال نبود' }, { status: 400 })
  }

  const system = (typeof body.system === 'string' && body.system.trim())
    ? body.system.trim().slice(0, 16_000)
    : 'تو دستیار هوشمند «Z» هستی.'

  const thinking = body.thinking !== false // default: on (watcher default)
  const capability = (CAPABILITIES.includes(body.capability as CapabilityId)
    ? body.capability
    : 'chat') as CapabilityId

  const overrideProviderId = typeof body.providerId === 'string' ? body.providerId : undefined
  const overrideModelId = typeof body.modelId === 'string' ? body.modelId : undefined

  audit(
    'llm_chat',
    `msgs=${clean.length} thinking=${thinking} cap=${capability}${overrideProviderId ? ` override=${overrideProviderId}` : ''}`
  )

  // 1+2: managed multi-provider chain (with optional playground override)
  if (overrideProviderId || hasManagedProviders()) {
    try {
      const out = await managedChat(capability, system, clean, {
        thinking,
        overrideProviderId,
        overrideModelId,
      })
      return NextResponse.json({
        ok: true,
        content: out.content,
        model: out.model,
        providerName: out.providerName,
        latencyMs: out.latencyMs,
        hopErrors: out.hopErrors,
        thinking,
        managed: true,
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      // if the managed chain has nothing usable, fall through to the legacy
      // path only when no override was requested (playground errors stay real)
      if (overrideProviderId) {
        return NextResponse.json({ ok: false, error: `خطای مدل: ${msg.slice(0, 250)}` }, { status: 502 })
      }
      if (hasManagedProviders()) {
        return NextResponse.json({ ok: false, error: `خطای مدل: ${msg.slice(0, 250)}` }, { status: 502 })
      }
    }
  }

  // 3: legacy single-provider path
  try {
    const out = await panelLlmChat(system, clean, { thinking })
    return NextResponse.json({
      ok: true,
      content: out.content,
      model: out.model,
      providerName: 'پیش‌فرض قدیمی',
      latencyMs: null,
      hopErrors: [],
      thinking,
      managed: false,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: `خطای مدل: ${msg.slice(0, 250)}` }, { status: 502 })
  }
}
