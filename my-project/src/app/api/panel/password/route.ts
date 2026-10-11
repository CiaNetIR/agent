import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { verifyKey, PANEL_ENV } from '@/lib/panel-server'
import { audit, writeTextAtomic } from '@/lib/panel-ops'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Panel password change («تغییر رمز پنل») — rewrites the sha256 hash in
 * .secrets/panel.env atomically. The stored key in the browser (which is
 * the sha256 of the password) is refreshed by the client after success.
 */

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export async function POST(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let body: { current?: string; next?: string }
  try {
    body = (await req.json()) as { current?: string; next?: string }
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400 })
  }

  const current = String(body.current || '')
  const next = String(body.next || '')

  // the request is already authenticated by the (old) key; still verify the
  // typed current password explicitly — belt and suspenders
  if (!verifyKey(sha256(current))) {
    return NextResponse.json({ ok: false, error: 'رمز فعلی درست نیست' }, { status: 401 })
  }
  if (next.length < 8 || next.length > 64) {
    return NextResponse.json({ ok: false, error: 'رمز جدید باید ۸ تا ۶۴ کاراکتر باشد' }, { status: 400 })
  }
  if (next === current) {
    return NextResponse.json({ ok: false, error: 'رمز جدید باید با رمز فعلی فرق داشته باشه' }, { status: 400 })
  }

  try {
    const raw = readFileSync(PANEL_ENV, 'utf8')
    const lines = raw.split('\n').map((line) =>
      line.startsWith('PANEL_PASSWORD_SHA256=') ? `PANEL_PASSWORD_SHA256=${sha256(next)}` : line
    )
    writeTextAtomic(PANEL_ENV, lines.join('\n').replace(/\n*$/, '\n'))
  } catch {
    return NextResponse.json({ ok: false, error: 'نوشتن فایل رمز ممکن نشد' }, { status: 500 })
  }

  audit('password_change', 'ok')
  return NextResponse.json({ ok: true })
}
