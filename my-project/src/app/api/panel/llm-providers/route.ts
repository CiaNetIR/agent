import { NextRequest, NextResponse } from 'next/server'
import { verifyKey } from '@/lib/panel-server'
import { db } from '@/lib/db'
import { testProviderConnection, discoverModels } from '@/lib/llm-provider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) return NextResponse.json({ ok: false }, { status: 401 })
  try {
    const providers = await db.llmProvider.findMany({ orderBy: { createdAt: 'asc' } })
    const safe = providers.map((p) => ({ ...p, apiKey: p.apiKey ? '••••••••' : '', hasKey: !!p.apiKey }))
    return NextResponse.json({ ok: true, providers: safe })
  } catch { return NextResponse.json({ ok: false, error: 'خطا در خواندن provider‌ها' }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) return NextResponse.json({ ok: false }, { status: 401 })
  let body: {
    id?: string; name?: string; kind?: string; baseUrl?: string; apiKey?: string; model?: string
    enabled?: boolean; isDefault?: boolean; isFallback?: boolean; temperature?: number; maxTokens?: number; timeoutMs?: number; action?: string
  }
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400 }) }

  if (body.action === 'discover' && body.baseUrl) {
    try { const models = await discoverModels(body.baseUrl, body.apiKey || '', body.kind || 'openai'); return NextResponse.json({ ok: true, models }) }
    catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'شناسایی مدل‌ها ناموفق بود' }, { status: 502 }) }
  }
  if (body.action === 'test') {
    try {
      const result = await testProviderConnection({ baseUrl: body.baseUrl || '', apiKey: body.apiKey || '', model: body.model || '', kind: body.kind || 'openai', timeoutMs: body.timeoutMs || 30000 })
      return NextResponse.json({ ok: true, result })
    } catch (e) { return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : 'تست ناموفق بود' }, { status: 502 }) }
  }
  if (!body.name?.trim()) return NextResponse.json({ ok: false, error: 'نام الزامی است' }, { status: 400 })
  if (!body.kind) return NextResponse.json({ ok: false, error: 'نوع Provider الزامی است' }, { status: 400 })
  try {
    if (body.isDefault) await db.llmProvider.updateMany({ where: { isDefault: true }, data: { isDefault: false } })
    const data = {
      name: body.name.trim(), kind: body.kind, baseUrl: body.baseUrl || '', apiKey: body.apiKey || '',
      model: body.model || '', enabled: body.enabled ?? true, isDefault: body.isDefault ?? false,
      isFallback: body.isFallback ?? false, temperature: body.temperature ?? 0.7, maxTokens: body.maxTokens ?? 4096, timeoutMs: body.timeoutMs ?? 90000,
    }
    if (body.id) {
      const updateData = { ...data }; if (!body.apiKey) delete (updateData as Record<string, unknown>).apiKey
      const provider = await db.llmProvider.update({ where: { id: body.id }, data: updateData })
      return NextResponse.json({ ok: true, provider: { ...provider, apiKey: '••••••••', hasKey: !!provider.apiKey } })
    } else {
      const provider = await db.llmProvider.create({ data })
      return NextResponse.json({ ok: true, provider: { ...provider, apiKey: '••••••••', hasKey: !!provider.apiKey } })
    }
  } catch { return NextResponse.json({ ok: false, error: 'ذخیره Provider ناموفق بود' }, { status: 500 }) }
}

export async function DELETE(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) return NextResponse.json({ ok: false }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, error: 'شناسه الزامی است' }, { status: 400 })
  try { await db.llmProvider.delete({ where: { id } }); return NextResponse.json({ ok: true }) }
  catch { return NextResponse.json({ ok: false, error: 'حذف ناموفق بود' }, { status: 500 }) }
}
