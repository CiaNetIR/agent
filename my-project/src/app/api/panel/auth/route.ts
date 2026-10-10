import { NextRequest, NextResponse } from 'next/server'
import { isLocked, readPanelConfig, remainingFails, verifyKey } from '@/lib/panel-server'

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
  // verifyKey itself counts the attempt (fail → lockout counter, success → reset)
  if (verifyKey(body.key)) {
    const cfg = readPanelConfig()
    return NextResponse.json({ ok: true, termEnabled: cfg.termEnabled })
  }
  return NextResponse.json(
    { ok: false, remaining: remainingFails(), locked: isLocked() > 0 },
    { status: 401 }
  )
}
