import { NextRequest, NextResponse } from 'next/server'
import { verifyKey } from '@/lib/panel-server'
import { audit } from '@/lib/panel-ops'
import { getDefaults, saveDefaults, type LlmDefaults } from '@/lib/llm-providers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Per-capability model selection + global generation settings + fallback
 * order. Consumed by managedChat() — these settings are REALLY wired
 * into the chat path, not just stored.
 */

export async function GET(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  return NextResponse.json({ ok: true, defaults: getDefaults() })
}

export async function PUT(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  let body: Partial<LlmDefaults>
  try {
    body = (await req.json()) as Partial<LlmDefaults>
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400 })
  }
  try {
    const saved = saveDefaults(body as LlmDefaults)
    audit('llm_defaults_save', `fallback=[${saved.fallbackOrder.join(',')}]`)
    return NextResponse.json({ ok: true, defaults: saved })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : 'ذخیره ناموفق' },
      { status: 400 }
    )
  }
}
