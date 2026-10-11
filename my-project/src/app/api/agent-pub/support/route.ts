import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PUBLIC support-chat endpoint for the owner's shop site (widget.js calls
 * this). CORS is open by design (site visitors) — abuse is handled at the
 * agent core (site key + per-session/global rate limits).
 */

const AGENT = 'http://127.0.0.1:3004'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
}

function internalToken(): string {
  try {
    for (const line of readFileSync('/home/z/my-project/.secrets/panel.env', 'utf8').split('\n')) {
      const m = line.match(/^INTERNAL_TOKEN=(.+)$/)
      if (m) return m[1].trim()
    }
  } catch {
    /* missing */
  }
  return ''
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

export async function POST(req: NextRequest) {
  let body: { siteKey?: string; sessionId?: string; message?: string } = {}
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400, headers: CORS })
  }
  const message = String(body.message || '').trim()
  if (!message || message.length > 1000) {
    return NextResponse.json({ ok: false, error: 'پیام نامعتبر' }, { status: 400, headers: CORS })
  }
  try {
    const res = await fetch(`${AGENT}/internal/support`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-token': internalToken() },
      body: JSON.stringify({
        siteKey: String(body.siteKey || ''),
        sessionId: String(body.sessionId || ''),
        message,
        userAgent: String(req.headers.get('user-agent') || '').slice(0, 200),
      }),
      signal: AbortSignal.timeout(75_000),
    })
    const data = (await res.json().catch(() => ({ ok: false, error: 'پاسخ نامعتبر' }))) as Record<string, unknown>
    return NextResponse.json(data, { status: res.status, headers: CORS })
  } catch {
    return NextResponse.json(
      { ok: false, error: 'پشتیبانی فعلاً در دسترس نیست' },
      { status: 503, headers: CORS }
    )
  }
}
