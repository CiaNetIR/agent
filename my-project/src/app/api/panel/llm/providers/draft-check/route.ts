import { NextRequest, NextResponse } from 'next/server'
import { verifyKey } from '@/lib/panel-server'
import { audit } from '@/lib/panel-ops'
import { listRemoteModels, testProvider, createProvider, deleteProvider } from '@/lib/llm-providers'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Draft operations for the add-provider wizard — run against UNSAVED
 * connection details so the owner can discover models and test the
 * connection BEFORE committing anything. A temporary provider record
 * is created, used, and deleted within the same request; its API key
 * is written to the key store and wiped in the same request.
 *
 * body: { action: 'models' | 'test', draft: ProviderInput, modelId? }
 */

interface DraftBody {
  action?: 'models' | 'test'
  draft?: Record<string, unknown>
  modelId?: string
}

export async function POST(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  let body: DraftBody
  try {
    body = (await req.json()) as DraftBody
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400 })
  }
  const draft = body.draft || {}
  const action = body.action

  // build a temporary provider, operate on it, then clean up
  const created = createProvider({ ...draft, name: `__draft__${Date.now()}` })
  if (!created.ok) {
    return NextResponse.json({ ok: false, error: created.error }, { status: 400 })
  }
  const tmpId = created.provider.id
  try {
    if (action === 'models') {
      const res = await listRemoteModels(tmpId)
      if (!res.ok) {
        return NextResponse.json({ ok: false, error: res.error, kind: res.kind, models: [] }, { status: 502 })
      }
      return NextResponse.json({ ok: true, models: res.models })
    }
    if (action === 'test') {
      const res = await testProvider(tmpId, body.modelId)
      if (!res.ok) {
        return NextResponse.json(
          { ok: false, error: res.error, kind: res.kind, record: res.record },
          { status: 502 }
        )
      }
      return NextResponse.json({ ok: true, record: res.record })
    }
    return NextResponse.json({ ok: false, error: 'action نامعتبر' }, { status: 400 })
  } finally {
    deleteProvider(tmpId) // also wipes the temp key from the key store
    audit('llm_draft_check', `${action || '?'} ok`)
  }
}
