import { NextRequest, NextResponse } from 'next/server'
import { verifyKey } from '@/lib/panel-server'
import { audit } from '@/lib/panel-ops'
import {
  createProvider,
  listProviders,
  providerStatus,
  toPublic,
  type ProviderPublic,
} from '@/lib/llm-providers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Managed LLM providers (multi-provider registry).
 * GET  → list (keys masked — raw keys NEVER leave the server)
 * POST → create a new provider connection
 */

export async function GET(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const providers: ProviderPublic[] = listProviders().map(toPublic)
  return NextResponse.json({
    ok: true,
    providers: providers.map((p) => ({ ...p, status: providerStatus(p) })),
  })
}

export async function POST(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400 })
  }
  const res = createProvider(body)
  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 400 })
  }
  audit('llm_provider_create', `${res.provider.name} (${res.provider.kind})`)
  return NextResponse.json({ ok: true, provider: toPublic(res.provider) }, { status: 201 })
}
