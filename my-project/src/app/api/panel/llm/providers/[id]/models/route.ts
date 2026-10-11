import { NextRequest, NextResponse } from 'next/server'
import { verifyKey } from '@/lib/panel-server'
import { audit } from '@/lib/panel-ops'
import { addModel, findProvider, listRemoteModels, toPublic } from '@/lib/llm-providers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Model discovery + manual registration.
 * GET  → remote model list from the provider (GET {base}/models) —
 *        failures are reported honestly; manual add stays possible.
 * POST → register a model manually ({ id, name }) — auto-discovery is
 *        never a hard requirement for a valid model id.
 */

type Ctx = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const { id } = await ctx.params
  const res = await listRemoteModels(id)
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error, kind: res.kind, models: [] },
      { status: 502 }
    )
  }
  return NextResponse.json({ ok: true, models: res.models })
}

export async function POST(req: NextRequest, ctx: Ctx) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const { id } = await ctx.params
  let body: { modelId?: string; id?: string; name?: string } = {}
  try {
    body = (await req.json()) as { modelId?: string; id?: string; name?: string }
  } catch {
    /* handled below */
  }
  const modelId = (body.modelId || body.id || '').trim()
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : undefined
  if (!modelId) {
    return NextResponse.json({ ok: false, error: 'شناسه مدل لازم است' }, { status: 400 })
  }
  if (!findProvider(id)) {
    return NextResponse.json({ ok: false, error: 'اتصال یافت نشد' }, { status: 404 })
  }
  const res = addModel(id, modelId, name, 'manual')
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 })
  audit('llm_model_add', `${res.provider.name} → ${modelId}`)
  return NextResponse.json({ ok: true, provider: toPublic(res.provider) }, { status: 201 })
}
