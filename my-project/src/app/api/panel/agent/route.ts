import { NextRequest, NextResponse } from 'next/server'
import { verifyKey } from '@/lib/panel-server'
import { audit } from '@/lib/panel-ops'
import { readFileSync } from 'fs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Panel «ایجنت» tab → agent core (:3004) proxy.
 * The browser only ever talks to this route (single origin, one auth path,
 * audited). GET ?op=… for reads, POST {op, data} for actions.
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

const GET_OPS: Record<string, { path: string; params?: string[] }> = {
  overview: { path: '/overview' },
  settings: { path: '/settings' },
  images: { path: '/images', params: ['limit'] },
  videos: { path: '/videos', params: ['limit'] },
  invoices: { path: '/invoices', params: ['limit'] },
  reports: { path: '/reports', params: ['limit'] },
  'woo-products': { path: '/woo/products', params: ['limit'] },
  'support-sessions': { path: '/support/sessions', params: ['limit'] },
  'support-messages': { path: '/support/messages', params: ['sessionId'] },
  chat: { path: '/chat', params: ['limit'] },
}
const POST_OPS: Record<string, { path: string; timeoutMs?: number }> = {
  settings: { path: '/settings' },
  'scraper-run': { path: '/scraper/run' },
  'woo-test': { path: '/woo/test' },
  'woo-sync': { path: '/woo/sync' },
  'report-now': { path: '/report/now', timeoutMs: 180_000 },
  'invoice-create': { path: '/invoice' },
  'image-generate': { path: '/image', timeoutMs: 300_000 },
  'image-send': { path: '/image/send' },
  'chat-send': { path: '/chat', timeoutMs: 300_000 },
  'chat-regenerate': { path: '/chat/regenerate', timeoutMs: 300_000 },
  'chat-delete': { path: '/chat/delete' },
  'chat-clear': { path: '/chat/clear' },
}

async function agentFetch(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
  timeoutMs = 150_000
): Promise<{ status: number; data: unknown }> {
  try {
    const res = await fetch(`${AGENT}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(method === 'GET' ? { 'x-panel-key': extraHeaders['x-panel-key'] || '' } : {}),
        ...extraHeaders,
      },
      body: method === 'POST' && body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    })
    const data = await res.json().catch(() => ({ ok: false, error: 'پاسخ نامعتبر سرویس ایجنت' }))
    return { status: res.status, data }
  } catch (e) {
    return {
      status: 503,
      data: { ok: false, error: `سرویس ایجنت در دسترس نیست: ${e instanceof Error ? e.message.slice(0, 120) : 'خطا'}` },
    }
  }
}

export async function GET(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const op = req.nextUrl.searchParams.get('op') || ''

  /* invoice HTML passthrough — returns text/html. The UI fetches this WITH
   * the panel-key header via panelFetch and renders it from a blob URL
   * (keeps the key out of URLs). */
  if (op === 'invoice-html') {
    const id = req.nextUrl.searchParams.get('id') || ''
    if (!/^[a-z0-9]{20,30}$/i.test(id)) {
      return NextResponse.json({ ok: false, error: 'شناسه فاکتور نامعتبر' }, { status: 400 })
    }
    try {
      const res = await fetch(`${AGENT}/invoice/html?id=${encodeURIComponent(id)}`, {
        headers: { 'x-panel-key': req.headers.get('x-panel-key') || '' },
        signal: AbortSignal.timeout(15_000),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
        return NextResponse.json(data, { status: res.status })
      }
      return new NextResponse(res.body, {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      })
    } catch {
      return NextResponse.json({ ok: false, error: 'سرویس ایجنت در دسترس نیست' }, { status: 503 })
    }
  }

  /* chat file passthrough — uploaded chat attachments (private, panel-key
   * authenticated both at the proxy and at the agent core). Returns raw bytes. */
  if (op === 'chat-file') {
    const mid = req.nextUrl.searchParams.get('mid') || ''
    const i = req.nextUrl.searchParams.get('i') || '0'
    if (!/^[a-z0-9]{20,30}$/i.test(mid) || !/^\d$/.test(i)) {
      return NextResponse.json({ ok: false, error: 'درخواست نامعتبر' }, { status: 400 })
    }
    try {
      const res = await fetch(`${AGENT}/chat/file?mid=${encodeURIComponent(mid)}&i=${encodeURIComponent(i)}`, {
        headers: { 'x-panel-key': req.headers.get('x-panel-key') || '' },
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
        return NextResponse.json(data, { status: res.status })
      }
      return new NextResponse(res.body, {
        status: 200,
        headers: {
          'content-type': res.headers.get('content-type') || 'application/octet-stream',
          'content-disposition': res.headers.get('content-disposition') || 'attachment',
          'cache-control': 'private, no-store',
        },
      })
    } catch {
      return NextResponse.json({ ok: false, error: 'سرویس ایجنت در دسترس نیست' }, { status: 503 })
    }
  }

  const def = GET_OPS[op]
  if (!def) return NextResponse.json({ ok: false, error: 'عملیات ناشناخته' }, { status: 400 })
  const params = new URLSearchParams()
  for (const k of def.params || []) {
    const v = req.nextUrl.searchParams.get(k)
    if (v) params.set(k, v)
  }
  const qs = params.toString()
  const r = await agentFetch('GET', def.path + (qs ? `?${qs}` : ''), undefined, {
    'x-panel-key': req.headers.get('x-panel-key') || '',
  })
  return NextResponse.json(r.data, { status: r.status })
}

export async function POST(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  let body: { op?: string; data?: Record<string, unknown> } = {}
  try {
    body = (await req.json()) as { op?: string; data?: Record<string, unknown> }
  } catch {
    /* ignore */
  }
  const op = String(body.op || '')
  const def = POST_OPS[op]
  if (!def) return NextResponse.json({ ok: false, error: 'عملیات ناشناخته' }, { status: 400 })
  audit('agent_api', op)
  const r = await agentFetch('POST', def.path, body.data || {}, {
    'x-panel-key': req.headers.get('x-panel-key') || '',
  }, def.timeoutMs)
  return NextResponse.json(r.data, { status: r.status })
}
