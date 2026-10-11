import { NextRequest, NextResponse } from 'next/server'
import { verifyKey } from '@/lib/panel-server'
import { removeModel, setModelEnabled } from '@/lib/llm-providers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Per-model operations on a provider's registered models.
 * PATCH  → { providerId, modelId, enabled } toggle
 * DELETE → { providerId, modelId } remove
 */

export async function PATCH(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  let body: { providerId?: string; modelId?: string; enabled?: boolean } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400 })
  }
  if (!body.providerId || !body.modelId || typeof body.enabled !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'providerId و modelId و enabled لازم است' }, { status: 400 })
  }
  const ok = setModelEnabled(body.providerId, body.modelId, body.enabled)
  if (!ok) return NextResponse.json({ ok: false, error: 'اتصال یا مدل یافت نشد' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  let body: { providerId?: string; modelId?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400 })
  }
  if (!body.providerId || !body.modelId) {
    return NextResponse.json({ ok: false, error: 'providerId و modelId لازم است' }, { status: 400 })
  }
  const ok = removeModel(body.providerId, body.modelId)
  if (!ok) return NextResponse.json({ ok: false, error: 'اتصال یا مدل یافت نشد' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
