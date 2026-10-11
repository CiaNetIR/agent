import { NextRequest, NextResponse } from 'next/server'
import { verifyKey } from '@/lib/panel-server'
import { audit } from '@/lib/panel-ops'
import { deleteProvider, findProvider, providerStatus, toPublic, updateProvider } from '@/lib/llm-providers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Single managed provider.
 * PATCH  → update (name/baseUrl/key/enabled/defaultModel/timeout)
 * DELETE → remove (also clears its stored key and defaults references)
 */

type Ctx = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, ctx: Ctx) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const { id } = await ctx.params
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400 })
  }
  const res = updateProvider(id, body)
  if (!res.ok) return NextResponse.json({ ok: false, error: res.error }, { status: 400 })
  audit('llm_provider_update', res.provider.name)
  return NextResponse.json({
    ok: true,
    provider: { ...toPublic(res.provider), status: providerStatus(res.provider) },
  })
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const { id } = await ctx.params
  const existing = findProvider(id)
  if (!existing) return NextResponse.json({ ok: false, error: 'اتصال یافت نشد' }, { status: 404 })
  const removed = deleteProvider(id)
  if (!removed) return NextResponse.json({ ok: false, error: 'حذف ناموفق' }, { status: 500 })
  audit('llm_provider_delete', existing.name)
  return NextResponse.json({ ok: true })
}
