/**
 * Z agent core — invoices (manual + real-time from WooCommerce order
 * webhooks). Persian RTL HTML file per invoice, saved under
 * /home/z/agent-files/invoices/, DB row, optional Telegram delivery via
 * the watcher sendq.
 */
import path from 'path'
import { randomBytes } from 'crypto'
import { writeFileSync } from 'fs'
import {
  INVOICE_DIR,
  db,
  ensureDir,
  getSettings,
  sendqWrite,
  tehranDateStr,
  tehranDayStartMs,
} from './lib'

export interface InvoiceItem {
  name: string
  qty: number
  price: string | number
}

export interface MakeInvoiceInput {
  customer: string
  items: InvoiceItem[]
  currency?: string
  orderId?: string
  status?: string
  sendTg?: boolean
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function tomanFmt(n: number): string {
  return n.toLocaleString('fa-IR')
}

function renderInvoiceHtml(o: {
  number: string
  store: string
  date: string
  customer: string
  items: InvoiceItem[]
  total: number
  currency: string
  status: string
  orderId: string
}): string {
  const rows = o.items
    .map(
      (it, i) => `<tr>
      <td>${tomanFmt(i + 1)}</td>
      <td>${esc(it.name)}</td>
      <td>${tomanFmt(Number(it.qty) || 1)}</td>
      <td>${tomanFmt(Number(it.price) || 0)}</td>
      <td>${tomanFmt((Number(it.qty) || 1) * (Number(it.price) || 0))}</td>
    </tr>`
    )
    .join('\n')
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>فاکتور ${esc(o.number)}</title>
<style>
  body{font-family:Tahoma,"Segoe UI",sans-serif;background:#0b0f0d;color:#e7ece9;margin:0;padding:24px}
  .card{max-width:640px;margin:0 auto;background:#121814;border:1px solid #233128;border-radius:14px;padding:28px}
  h1{font-size:18px;color:#f5c66b;margin:0 0 4px}
  .meta{color:#9fb0a6;font-size:12px;margin-bottom:18px;line-height:1.9}
  table{width:100%;border-collapse:collapse;font-size:13px;margin:14px 0}
  th,td{padding:8px 10px;border-bottom:1px solid #233128;text-align:right}
  th{color:#f5c66b;font-weight:700;font-size:12px}
  .total{display:flex;justify-content:space-between;background:#182019;border:1px solid #2c3a2f;border-radius:10px;padding:12px 16px;font-weight:700}
  .badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;border:1px solid #2f7a4f;color:#7ce3a8}
  .badge.pending{border-color:#8a6d2f;color:#f5c66b}
  footer{margin-top:18px;color:#71806f;font-size:11px;text-align:center}
</style>
</head>
<body>
<div class="card">
  <h1>🧾 فاکتور فروش — ${esc(o.store)}</h1>
  <div class="meta">
    شماره فاکتور: <b>${esc(o.number)}</b><br>
    تاریخ: ${esc(o.date)} &nbsp;|&nbsp; وضعیت: <span class="badge ${o.status === 'paid' ? '' : 'pending'}">${o.status === 'paid' ? 'پرداخت شده' : 'در انتظار پرداخت'}</span>${o.orderId ? ` &nbsp;|&nbsp; سفارش ووکامرس: #${esc(o.orderId)}` : ''}
  </div>
  <table>
    <thead><tr><th>#</th><th>کالا</th><th>تعداد</th><th>قیمت واحد</th><th>جمع</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="total"><span>مبلغ کل (${esc(o.currency)})</span><span>${tomanFmt(o.total)}</span></div>
  <footer>این فاکتور توسط دستیار هوشمند «Z» صادر شده است.</footer>
</div>
</body>
</html>`
}

/* serialize invoice creation — two concurrent webhook deliveries (or manual +
 * webhook) would otherwise read the same todayCount and race the orderId
 * dedupe (TOCTOU). Single process ⇒ a promise chain closes both races. */
let invoiceChain: Promise<unknown> = Promise.resolve()
export function makeInvoice(input: MakeInvoiceInput): Promise<{ ok: boolean; error?: string; invoice?: { id: string; number: string; total: string; sentTg: boolean } }> {
  const run = invoiceChain.then(() => makeInvoiceInner(input))
  invoiceChain = run.catch(() => {
    /* keep the chain alive after failures */
  })
  return run
}

async function makeInvoiceInner(input: MakeInvoiceInput): Promise<{ ok: boolean; error?: string; invoice?: { id: string; number: string; total: string; sentTg: boolean } }> {
  const items = (input.items || [])
    .filter((it) => it && typeof it.name === 'string' && it.name.trim())
    .slice(0, 60)
    .map((it) => ({ name: it.name.trim().slice(0, 120), qty: Number(it.qty) || 1, price: String(it.price ?? '0') }))
  if (items.length === 0) return { ok: false, error: 'حداقل یک ردیف کالا لازم است' }
  const customer = (input.customer || 'مشتری').trim().slice(0, 120)
  const currency = (input.currency || 'IRT').trim().slice(0, 8)
  const status = input.status === 'paid' || input.status === 'pending' ? input.status : 'issued'
  const total = items.reduce((acc, it) => acc + (it.qty * (Number(it.price) || 0)), 0)

  // orderId dedupe INSIDE the serialized section (webhook retries / order.updated
  // + order.created double deliveries must not mint duplicate invoices)
  if (input.orderId) {
    const dupe = await db.agentInvoice.findFirst({ where: { orderId: input.orderId } })
    if (dupe) return { ok: false, error: 'برای این سفارش قبلاً فاکتور صادر شده' }
  }

  const settings = await getSettings()
  const store = settings.support_store || 'فروشگاه من'
  const date = tehranDateStr()
  const todayCount = await db.agentInvoice.count({ where: { createdAt: { gte: new Date(tehranDayStartMs()) } } })
  const number = `INV-${date.replace(/-/g, '')}-${String(todayCount + 1).padStart(3, '0')}-${randomBytes(2).toString('hex').toUpperCase()}`

  ensureDir(INVOICE_DIR)
  const htmlPath = path.join(INVOICE_DIR, `${number}.html`)
  const html = renderInvoiceHtml({ number, store, date, customer, items, total, currency, status, orderId: input.orderId || '' })
  writeFileSync(htmlPath, html, 'utf8')

  const row = await db.agentInvoice.create({
    data: {
      number,
      orderId: input.orderId ? input.orderId.slice(0, 40) : null,
      customer,
      itemsJson: JSON.stringify(items),
      total: String(total),
      currency,
      status: input.status === 'paid' || input.status === 'pending' ? input.status : 'issued',
      htmlPath,
      sentTg: false,
    },
  })

  // real-time Telegram delivery (through the watcher client)
  let sent = false
  if (input.sendTg) {
    sent = sendqWrite({
      chat: settings.telegram_chat || 'me',
      file: htmlPath,
      caption: `🧾 فاکتور ${number} — ${customer} — مبلغ ${total.toLocaleString('fa-IR')} ${currency}${input.orderId ? ` (سفارش #${input.orderId})` : ''}`,
    })
    if (sent) await db.agentInvoice.update({ where: { id: row.id }, data: { sentTg: true } })
  }

  return { ok: true, invoice: { id: row.id, number, total: String(total), sentTg: sent } }
}

/** WooCommerce order webhook → invoice (real-time) */
export async function invoiceFromWooOrder(order: Record<string, unknown>): Promise<{ ok: boolean; error?: string }> {
  const orderId = String(order.id ?? order.number ?? '')
  if (!orderId) return { ok: false, error: 'سفارش بدون شناسه بود' }
  const existing = await db.agentInvoice.findFirst({ where: { orderId } })
  if (existing) return { ok: false, error: 'برای این سفارش قبلاً فاکتور صادر شده' }

  const billing = (order.billing || {}) as Record<string, string>
  const customer = [billing.first_name, billing.last_name].filter(Boolean).join(' ').trim() || `مشتری #${orderId}`
  const lineItems = (order.line_items || []) as Record<string, unknown>[]
  const items: InvoiceItem[] = lineItems.slice(0, 40).map((li) => ({
    name: String(li.name ?? 'کالا'),
    qty: Number(li.quantity ?? 1),
    price: String(li.price ?? li.subtotal ?? '0'),
  }))
  const status = String(order.status ?? '') === 'completed' ? 'paid' : 'pending'
  return makeInvoice({ customer, items, currency: 'IRT', orderId, status, sendTg: true })
}
