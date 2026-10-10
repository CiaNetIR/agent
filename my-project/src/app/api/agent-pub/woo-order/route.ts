import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * PUBLIC WooCommerce order webhook — new/updated orders arrive here and the
 * agent core issues the invoice in real time (HTML + Telegram delivery).
 * Configure in WooCommerce → Settings → Advanced → Webhooks:
 *   URL:  https://<your-gateway-domain>/api/agent-pub/woo-order?secret=<woo_webhook_secret>
 *   Event: Order created (and optionally Order updated)
 * WooCommerce ALSO signs every delivery with X-Wc-Webhook-Signature
 * (HMAC-SHA256 of the raw body, keyed by the delivery secret) — when present
 * we pass the ORIGINAL bytes + signature through untouched so the agent can
 * verify over exactly what WooCommerce sent.
 */

const AGENT = 'http://127.0.0.1:3004'

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

export async function POST(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret') || ''
  const sig = req.headers.get('x-wc-webhook-signature') || ''
  const raw = await req.text()
  try {
    JSON.parse(raw || 'null')
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400 })
  }
  try {
    const res = await fetch(`${AGENT}/internal/woo-order`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-token': internalToken(),
        ...(sig ? { 'x-wc-webhook-signature': sig } : {}),
      },
      // HMAC-signed deliveries: pass the ORIGINAL bytes through untouched so
      // the signature is verified over exactly what WooCommerce sent.
      // Legacy deliveries: wrap as { secret, order } like before.
      body: sig ? raw : JSON.stringify({ secret, order: JSON.parse(raw) }),
      signal: AbortSignal.timeout(60_000),
    })
    const data = (await res.json().catch(() => ({ ok: false, error: 'پاسخ نامعتبر' }))) as Record<string, unknown>
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ ok: false, error: 'سرویس ایجنت در دسترس نیست' }, { status: 503 })
  }
}
