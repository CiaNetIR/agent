import { NextRequest, NextResponse } from 'next/server'
import { isLocked, readPanelConfig, registerFail, registerSuccess, verifyKey } from '@/lib/panel-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const lock = isLocked()
  if (lock > 0) {
    return NextResponse.json(
      { ok: false, locked: true, retryInSec: lock },
      { status: 429 }
    )
  }
  let body: { key?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* ignore */
  }
  if (verifyKey(body.key)) {
    registerSuccess()
    const cfg = readPanelConfig()
    return NextResponse.json({ ok: true, termEnabled: cfg.termEnabled })
  }
  const remaining = registerFail()
  return NextResponse.json(
    { ok: false, remaining, locked: isLocked() > 0 },
    { status: 401 }
  )
}
