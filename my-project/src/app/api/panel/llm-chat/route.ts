import { NextRequest, NextResponse } from 'next/server'
import { verifyKey } from '@/lib/panel-server'
import { audit } from '@/lib/panel-ops'
import { panelLlmChat, panelProviderInfo } from '@/lib/llm-provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Live LLM playground («تست زنده مدل») — routes through the SAME
 * provider-agnostic layer as the agent core (sandbox SDK or any
 * OpenAI-compatible endpoint from .secrets/llm.env — see LLM-SETUP.md).
 *
 * GET  → active provider info (for the panel badge)
 * POST → one completion with the owner's chosen system prompt + thinking
 */

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

interface ChatBody {
  messages?: ChatMsg[]
  system?: string
  thinking?: boolean
}

export async function GET(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  return NextResponse.json({ ok: true, provider: await panelProviderInfo() })
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

  audit('llm_chat', `msgs=${clean.length} thinking=${thinking}`)

  try {
    const out = await panelLlmChat(system, clean, { thinking })
    return NextResponse.json({
      ok: true,
      content: out.content,
      model: out.model,
      thinking,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ ok: false, error: `خطای مدل: ${msg.slice(0, 250)}` }, { status: 502 })
  }
}
