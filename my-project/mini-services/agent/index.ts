/**
 * Z agent core (:3004) — HTTP API + scheduler.
 *
 * Panel endpoints: x-panel-key (same sha256 as the web panel).
 * Internal endpoints (/internal/*): x-internal-token (used by the Next.js
 * public proxy routes: site support chat + WooCommerce order webhook).
 *
 * Scheduler (20 s tick):
 *   - scraper every N minutes (default 30) → TXT→Telegram, CSV→WooCommerce,
 *     JSON→DB
 *   - daily accounting report at HH:mm Tehran time
 *   - imgreq polling: owner Telegram command «image» → generate → reply
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { existsSync, readdirSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'fs'
import path from 'path'
import { createHmac, randomBytes } from 'crypto'
import {
  AGENT_VERSION,
  IMAGES_PUBLIC_DIR,
  INSTANCES_ROOT,
  PROJECT_DIR,
  SENDQ_DIR,
  WATCHER_DIR,
  checkInternal,
  checkPanelAuth,
  db,
  finishRun,
  getSettings,
  getSetting,
  maskSettings,
  releaseImageQuota,
  reserveImageQuota,
  safeEq,
  sendqWrite,
  setSetting,
  startRun,
  tehranDateStr,
  tehranDayStartMs,
  tehranHHMM,
  tgLiveness,
} from './lib'
import { llmImageSmart, imageExtFromBase64, IMAGE_SIZES, llmProviderInfo } from './llm'
import { wooCfg, wooSyncCsv, wooTest } from './woo'
import { generateDailyReport } from './report'
import { makeInvoice, invoiceFromWooOrder } from './invoices'
import { supportChat, defaultSiteKey } from './support'
import { runScraper, isScraping } from './scraper'
import { chatSend, chatHistory, chatRegenerate, chatDelete, chatClear, chatFileAsync } from './chat'
import { reconcileStaleVideos } from './video'

const PORT = 3004
const startedAt = Date.now()
/* sliding-window rate limiter for the PUBLIC woo webhook (30/min) */
const wooHits: number[] = []

/* ---------------- tiny http helpers ---------------- */

function json(res: ServerResponse, code: number, body: unknown) {
  const buf = Buffer.from(JSON.stringify(body))
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
  })
  res.end(buf)
}

function readBody(req: IncomingMessage, maxLen = 1024 * 1024): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    let size = 0
    let destroyed = false
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > maxLen) {
        destroyed = true
        resolve({})
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (destroyed) return
      const raw = Buffer.concat(chunks).toString('utf8')
      let parsed: unknown
      try {
        parsed = JSON.parse(raw || '{}')
      } catch {
        parsed = {}
      }
      const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
      // keep the RAW text (non-enumerable) for HMAC verification of the woo webhook
      Object.defineProperty(body, '__raw', { value: raw, enumerable: false })
      resolve(body)
    })
    req.on('error', () => resolve({}))
  })
}

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url || '/', 'http://localhost')
  const p = url.pathname.replace(/\/+$/, '') || '/'
  const method = (req.method || 'GET').toUpperCase()

  /* ---------- health (no auth — status only) ---------- */
  if (p === '/healthz') return json(res, 200, { ok: true, version: AGENT_VERSION, uptimeSec: Math.floor((Date.now() - startedAt) / 1000) })

  /* ---------- internal (Next.js proxy only) ---------- */
  if (p === '/internal/support' && method === 'POST') {
    if (!checkInternal(req.headers['x-internal-token'] as string)) return json(res, 401, { ok: false, error: 'unauthorized' })
    const body = await readBody(req)
    const out = await supportChat({
      siteKey: String(body.siteKey || ''),
      sessionId: String(body.sessionId || ''),
      message: String(body.message || ''),
      userAgent: String(req.headers['user-agent'] || ''),
    })
    return json(res, out.ok ? 200 : 400, out)
  }
  if (p === '/internal/woo-order' && method === 'POST') {
    if (!checkInternal(req.headers['x-internal-token'] as string)) return json(res, 401, { ok: false, error: 'unauthorized' })
    // rate limit (public endpoint — spam must not mint unlimited job runs)
    const nowMs = Date.now()
    while (wooHits.length && nowMs - wooHits[0] > 60_000) wooHits.shift()
    if (wooHits.length >= 30) return json(res, 429, { ok: false, error: 'درخواست زیاد — کمی بعد دوباره' })
    wooHits.push(nowMs)
    const body = await readBody(req, 64 * 1024)
    const wantSecret = await getSetting('woo_webhook_secret')
    if (!wantSecret) return json(res, 403, { ok: false, error: 'راز وبهوک تنظیم نشده' })
    // HMAC-SHA256 over the RAW body (WooCommerce X-Wc-Webhook-Signature) when
    // present; otherwise legacy shared-secret (query/body), timing-safe either way
    const sig = String(req.headers['x-wc-webhook-signature'] || '')
    let authed = false
    if (sig) {
      const expect = createHmac('sha256', wantSecret).update(String(body.__raw || '')).digest('hex')
      authed = safeEq(sig, expect)
    } else {
      authed = safeEq(String(body.secret || url.searchParams.get('secret') || ''), wantSecret)
    }
    if (!authed) return json(res, 403, { ok: false, error: 'راز وبهوک نامعتبر' })
    // HMAC-signed deliveries arrive as the RAW WooCommerce payload (root = the
    // order object itself); legacy deliveries arrive wrapped as { secret, order }
    const order = sig ? body : (body.order as Record<string, unknown> | undefined)
    if (!order || typeof order !== 'object') return json(res, 400, { ok: false, error: 'سفارش نامعتبر' })
    // auto-invoice can be switched off from the panel («قابلیت‌ها»)
    if ((await getSetting('invoice_auto')) === '0') {
      const run = await startRun('invoice')
      await finishRun(run.id, 'skipped', 'فاکتور خودکار خاموش است — سفارش دریافت شد ولی فاکتور ساخته نشد')
      return json(res, 200, { ok: true, skipped: true, reason: 'فاکتور خودکار خاموش است' })
    }
    const run = await startRun('invoice')
    const r = await invoiceFromWooOrder(order)
    await finishRun(run.id, r.ok ? 'ok' : 'skipped', r.ok ? 'فاکتور لحظه‌ای صادر شد' : r.error || 'رد شد')
    return json(res, r.ok ? 200 : 400, r)
  }

  /* ---------- panel endpoints (x-panel-key) ---------- */
  if (!checkPanelAuth(req.headers['x-panel-key'] as string)) {
    return json(res, 401, { ok: false, error: 'رمز پنل نامعتبر یا قفل موقت' })
  }

  /* ----- overview ----- */
  if (p === '/overview' && method === 'GET') {
    const settings = await getSettings()
    const today = tehranDateStr()
    const lastRuns = await db.agentJobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 10 })
    const lastScraper = lastRuns.find((r) => r.job === 'scraper')
    const imagesToday = await db.agentImage.count({ where: { dayDate: today } })
    const gallery = await db.agentImage.findMany({ orderBy: { createdAt: 'desc' }, take: 12 })
    const invoicesToday = await db.agentInvoice.count({ where: { createdAt: { gte: new Date(tehranDayStartMs()) } } })
    const lastInvoices = await db.agentInvoice.findMany({ orderBy: { createdAt: 'desc' }, take: 5 })
    const lastReport = await db.agentReport.findFirst({ orderBy: { createdAt: 'desc' } })
    const wooProductsCount = await db.wooProductMap.count()
    const supportSessions = await db.supportSession.count()
    const lastSession = await db.supportSession.findFirst({ orderBy: { lastAt: 'desc' } })
    const wooConf = await wooCfg()
    const tg = tgLiveness()
    const nextScrapeAt = lastScraper && settings.scraper_enabled === '1'
      ? new Date(new Date(lastScraper.startedAt).getTime() + Math.max(1, parseInt(settings.scraper_every_min || '30', 10) || 30) * 60_000).toISOString()
      : null
    return json(res, 200, {
      ok: true,
      agent: {
        version: AGENT_VERSION,
        uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
        scrapingNow: isScraping(),
        llm: await llmProviderInfo(),
      },
      scraper: {
        enabled: settings.scraper_enabled === '1',
        script: settings.scraper_script,
        everyMin: parseInt(settings.scraper_every_min || '30', 10) || 30,
        sendTxt: settings.scraper_send_txt === '1',
        lastRun: lastScraper ? { status: lastScraper.status, summary: lastScraper.summary, at: lastScraper.startedAt.toISOString() } : null,
        nextRunAt: nextScrapeAt,
      },
      runs: lastRuns.map((r) => ({ id: r.id, job: r.job, status: r.status, summary: r.summary, at: r.startedAt.toISOString() })),
      woo: {
        configured: !!wooConf,
        site: settings.woo_site,
        autoSync: settings.woo_auto_sync === '1',
        products: wooProductsCount,
        lastSync: lastRuns.find((r) => r.job === 'woo_sync')?.startedAt.toISOString() || null,
      },
      report: {
        enabled: settings.report_enabled === '1',
        time: settings.report_time,
        last: lastReport ? { forDate: lastReport.forDate, at: lastReport.createdAt.toISOString(), sentTg: lastReport.sentTg } : null,
      },
      images: { quota: parseInt(settings.image_quota || '150', 10) || 150, usedToday: imagesToday, gallery: gallery.map((g) => ({ id: g.id, prompt: g.prompt.slice(0, 80), path: g.path, at: g.createdAt.toISOString() })) },
      invoices: { today: invoicesToday, last: lastInvoices.map((i) => ({ id: i.id, number: i.number, customer: i.customer, total: i.total, currency: i.currency, status: i.status, at: i.createdAt.toISOString() })) },
      support: { enabled: settings.support_enabled === '1', sessions: supportSessions, lastAt: lastSession?.lastAt.toISOString() || null },
      capabilities: {
        watcher: { mainRunning: tg.mainRunning, instancesTotal: tg.instancesTotal, instancesRunning: tg.instancesRunning },
        scraper: { enabled: settings.scraper_enabled === '1', sendTxt: settings.scraper_send_txt === '1' },
        woo: { autoSync: settings.woo_auto_sync === '1', configured: !!wooConf },
        invoiceAuto: settings.invoice_auto === '1',
        report: { enabled: settings.report_enabled === '1', time: settings.report_time },
        images: { enabled: settings.image_enabled === '1', usedToday: imagesToday, quota: parseInt(settings.image_quota || '150', 10) || 150 },
        support: { enabled: settings.support_enabled === '1', sessions: supportSessions },
      },
    })
  }

  /* ----- settings ----- */
  if (p === '/settings' && method === 'GET') {
    const s = await getSettings()
    return json(res, 200, { ok: true, settings: maskSettings(s), sizes: IMAGE_SIZES })
  }
  if (p === '/settings' && method === 'POST') {
    const body = await readBody(req, 128 * 1024)
    const allowed = [
      'scraper_enabled', 'scraper_script', 'scraper_every_min', 'scraper_send_txt',
      'telegram_chat', 'woo_site', 'woo_key', 'woo_secret', 'woo_auto_sync', 'woo_webhook_secret',
      'report_enabled', 'report_time', 'image_quota', 'image_size',
      'image_enabled', 'invoice_auto',
      'support_enabled', 'support_store', 'support_persona', 'support_welcome', 'public_base_url',
      'chat_persona',
    ]
    let n = 0
    for (const k of allowed) {
      if (body[k] !== undefined) {
        let v = String(body[k]).trim()
        // "…" mask coming back unchanged = keep the old value
        if ((k === 'woo_key' || k === 'woo_secret') && /…/.test(v)) continue
        if (k === 'scraper_every_min') v = String(Math.min(1440, Math.max(5, parseInt(v || '30', 10) || 30)))
        if (k === 'image_quota') v = String(Math.min(1000, Math.max(1, parseInt(v || '150', 10) || 150)))
        if (k === 'image_enabled' || k === 'invoice_auto') v = v === '0' || v === 'false' ? '0' : '1'
        if (k === 'report_time' && !/^\d{1,2}:\d{2}$/.test(v)) continue
        if (k === 'image_size' && !IMAGE_SIZES.includes(v)) continue
        if (k === 'scraper_script' && !v.startsWith('/home/z/')) continue
        if (v.length > 16_000) v = v.slice(0, 16_000)
        await setSetting(k, v)
        n++
      }
    }
    return json(res, 200, { ok: true, updated: n })
  }

  /* ----- scraper ----- */
  if (p === '/scraper/run' && method === 'POST') {
    const r = await runScraper('manual')
    return json(res, r.ok ? 200 : 400, r)
  }

  /* ----- woo ----- */
  if (p === '/woo/test' && method === 'POST') {
    const cfg = await wooCfg()
    if (!cfg) return json(res, 400, { ok: false, detail: 'اول آدرس سایت و کلیدها را در تنظیمات وارد کن' })
    const r = await wooTest(cfg)
    return json(res, r.ok ? 200 : 400, r)
  }
  if (p === '/woo/sync' && method === 'POST') {
    // use the latest stored CSV output
    const lastCsv = await db.agentScrapeOutput.findFirst({ where: { kind: 'csv' }, orderBy: { createdAt: 'desc' } })
    if (!lastCsv) return json(res, 400, { ok: false, error: 'هنوز خروجی CSV ای از اسکرپر موجود نیست؛ اول اسکرپر را اجرا کن' })
    const r = await wooSyncCsv(lastCsv.content, { record: true })
    return json(res, r.ok ? 200 : 400, r)
  }
  if (p === '/woo/products' && method === 'GET') {
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '20', 10) || 20))
    const rows = await db.wooProductMap.findMany({ orderBy: { lastSyncAt: 'desc' }, take: limit })
    return json(res, 200, { ok: true, products: rows })
  }

  /* ----- reports ----- */
  if (p === '/report/now' && method === 'POST') {
    const r = await generateDailyReport('manual')
    return json(res, r.ok ? 200 : 500, r)
  }
  if (p === '/reports' && method === 'GET') {
    const limit = Math.min(30, Math.max(1, parseInt(url.searchParams.get('limit') || '10', 10) || 10))
    const rows = await db.agentReport.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
    return json(res, 200, { ok: true, reports: rows })
  }

  /* ----- invoices ----- */
  if (p === '/invoices' && method === 'GET') {
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '30', 10) || 30))
    const rows = await db.agentInvoice.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
    return json(res, 200, {
      ok: true,
      invoices: rows.map((i) => ({ id: i.id, number: i.number, orderId: i.orderId, customer: i.customer, total: i.total, currency: i.currency, status: i.status, sentTg: i.sentTg, at: i.createdAt.toISOString() })),
    })
  }
  if (p === '/invoice' && method === 'POST') {
    const body = await readBody(req)
    const items = Array.isArray(body.items) ? (body.items as { name?: string; qty?: number; price?: string | number }[]) : []
    const r = await makeInvoice({
      customer: String(body.customer || 'مشتری'),
      items: items.map((it) => ({ name: String(it.name || ''), qty: Number(it.qty) || 1, price: String(it.price ?? '0') })),
      currency: String(body.currency || 'IRT'),
      sendTg: body.sendTg === true,
    })
    return json(res, r.ok ? 200 : 400, r)
  }
  if (p === '/invoice/html' && method === 'GET') {
    const id = url.searchParams.get('id') || ''
    const row = /^[a-z0-9]{20,30}$/i.test(id) ? await db.agentInvoice.findUnique({ where: { id } }) : null
    if (!row || !row.htmlPath || !existsSync(row.htmlPath)) return json(res, 404, { ok: false, error: 'فاکتور پیدا نشد' })
    const html = (await import('fs')).readFileSync(row.htmlPath, 'utf8')
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    return void res.end(html)
  }

  /* ----- images ----- */
  if (p === '/image' && method === 'POST') {
    if ((await getSetting('image_enabled')) === '0') {
      return json(res, 400, { ok: false, error: 'قابلیت تولید تصویر خاموش است — از تب «قابلیت‌ها» روشنش کن' })
    }
    const body = await readBody(req)
    const prompt = String(body.prompt || '').trim().slice(0, 900)
    if (!prompt) return json(res, 400, { ok: false, error: 'توضیح تصویر لازم است' })
    const count = Math.min(4, Math.max(1, parseInt(String(body.count || '1'), 10) || 1))
    const size = IMAGE_SIZES.includes(String(body.size)) ? String(body.size) : await getSetting('image_size')
    const quota = parseInt(await getSetting('image_quota') || '150', 10) || 150
    const today = tehranDateStr()
    const used = await db.agentImage.count({ where: { dayDate: today } })
    if (!reserveImageQuota(count, used, quota)) {
      return json(res, 429, { ok: false, error: `سهمیهٔ امروز پر است (${used}/${quota}) — فردا دوباره یا سهمیه را بالا ببر` })
    }
    const run = await startRun('image')
    const made: { id: string; path: string }[] = []
    const errors: string[] = []
    try {
      for (let i = 0; i < count; i++) {
        try {
          const b64 = await llmImageSmart(prompt, size)
          mkdirSync(IMAGES_PUBLIC_DIR, { recursive: true })
          const rel = `img-${Date.now()}-${randomBytes(3).toString('hex')}${imageExtFromBase64(b64)}`
          writeFileSync(path.join(IMAGES_PUBLIC_DIR, rel), Buffer.from(b64, 'base64'))
          const row = await db.agentImage.create({ data: { prompt, path: `/agent-images/${rel}`, size, dayDate: today } })
          made.push({ id: row.id, path: row.path })
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e))
        }
      }
      // optional telegram delivery of every generated image
      if (body.sendTg === true && made.length) {
        for (const m of made) {
          sendqWrite({
            chat: await getSetting('telegram_chat'),
            file: path.join(PROJECT_DIR, 'public', m.path.replace(/^\//, '')),
            caption: `🎨 ${prompt.slice(0, 200)}`,
          })
        }
      }
      const summary = `${made.length} تصویر ساخته شد${errors.length ? `، ${errors.length} خطا` : ''} (${used + made.length}/${quota} امروز)`
      await finishRun(run.id, made.length ? 'ok' : 'error', summary, { errors })
      return json(res, made.length ? 200 : 500, { ok: made.length > 0, images: made, errors, usedToday: used + made.length, quota })
    } finally {
      releaseImageQuota(count)
    }
  }
  if (p === '/images' && method === 'GET') {
    const limit = Math.min(60, Math.max(1, parseInt(url.searchParams.get('limit') || '24', 10) || 24))
    const rows = await db.agentImage.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
    const today = tehranDateStr()
    const usedToday = await db.agentImage.count({ where: { dayDate: today } })
    const quota = parseInt(await getSetting('image_quota') || '150', 10) || 150
    return json(res, 200, { ok: true, images: rows.map((r) => ({ id: r.id, prompt: r.prompt, path: r.path, at: r.createdAt.toISOString() })), usedToday, quota })
  }
  if (p === '/image/send' && method === 'POST') {
    const body = await readBody(req)
    const id = String(body.id || '')
    const row = /^[a-z0-9]{20,30}$/i.test(id) ? await db.agentImage.findUnique({ where: { id } }) : null
    if (!row) return json(res, 404, { ok: false, error: 'تصویر پیدا نشد' })
    const abs = path.join(PROJECT_DIR, 'public', row.path.replace(/^\//, ''))
    const sent = sendqWrite({ chat: await getSetting('telegram_chat'), file: abs, caption: `🎨 ${row.prompt.slice(0, 200)}` })
    return json(res, sent ? 200 : 500, { ok: sent })
  }

  /* ----- videos (background «ویدیو:» jobs) ----- */
  if (p === '/videos' && method === 'GET') {
    const limit = Math.min(30, Math.max(1, parseInt(url.searchParams.get('limit') || '12', 10) || 12))
    const rows = await db.agentVideo.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
    const processing = rows.filter((r) => r.status === 'processing').length
    return json(res, 200, {
      ok: true,
      processing,
      videos: rows.map((r) => ({
        id: r.id, prompt: r.prompt, status: r.status, quality: r.quality, size: r.size,
        fps: r.fps, withAudio: r.withAudio, durationSec: r.durationSec,
        clipsDone: r.clipsDone, clipsTotal: r.clipsTotal, path: r.path,
        error: r.error, at: r.createdAt.toISOString(),
      })),
    })
  }

  /* ----- chat (owner's personal thread) ----- */
  if (p === '/chat' && method === 'GET') {
    const limit = Math.min(300, Math.max(1, parseInt(url.searchParams.get('limit') || '120', 10) || 120))
    const messages = await chatHistory(limit)
    return json(res, 200, { ok: true, messages })
  }
  if (p === '/chat' && method === 'POST') {
    const body = await readBody(req, 20 * 1024 * 1024)
    const r = await chatSend({
      message: String(body.message || ''),
      files: Array.isArray(body.files) ? (body.files as { name?: string; mime?: string; b64?: string }[]) : [],
      thinking: body.thinking !== false,
    })
    return json(res, r.ok ? 200 : 400, r)
  }
  if (p === '/chat/regenerate' && method === 'POST') {
    const body = await readBody(req)
    const r = await chatRegenerate(body.thinking === undefined ? undefined : body.thinking !== false)
    return json(res, r.ok ? 200 : 400, r)
  }
  if (p === '/chat/delete' && method === 'POST') {
    const body = await readBody(req)
    const r = await chatDelete(String(body.id || ''))
    return json(res, r.ok ? 200 : 404, r)
  }
  if (p === '/chat/clear' && method === 'POST') {
    const r = await chatClear()
    return json(res, 200, r)
  }
  if (p === '/chat/file' && method === 'GET') {
    const f = await chatFileAsync(String(url.searchParams.get('mid') || ''), parseInt(url.searchParams.get('i') || '0', 10) || 0)
    if (!f.ok) return json(res, 404, { ok: false, error: f.error })
    try {
      const buf = (await import('fs')).readFileSync(f.abs)
      const inline = f.mime.startsWith('image/')
      res.writeHead(200, {
        'content-type': f.mime,
        'content-length': buf.length,
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'cache-control': 'private, max-age=3600',
      })
      return void res.end(buf)
    } catch {
      return json(res, 404, { ok: false, error: 'فایل قابل خواندن نیست' })
    }
  }

  /* ----- support ----- */
  if (p === '/support/sessions' && method === 'GET') {
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') || '30', 10) || 30))
    const rows = await db.supportSession.findMany({ orderBy: { lastAt: 'desc' }, take: limit })
    const out: { id: string; msgs: number; lastAt: string; lastSnippet: string }[] = []
    for (const s of rows) {
      const msgs = await db.supportMessage.count({ where: { sessionId: s.id } })
      const last = await db.supportMessage.findFirst({ where: { sessionId: s.id }, orderBy: { createdAt: 'desc' } })
      out.push({ id: s.id, msgs, lastAt: s.lastAt.toISOString(), lastSnippet: last?.content.slice(0, 90) || '' })
    }
    return json(res, 200, { ok: true, sessions: out })
  }
  if (p === '/support/messages' && method === 'GET') {
    const sessionId = url.searchParams.get('sessionId') || ''
    if (!/^[a-z0-9]{20,30}$/i.test(sessionId)) return json(res, 400, { ok: false, error: 'شناسه گفتگو نامعتبر' })
    const rows = await db.supportMessage.findMany({ where: { sessionId }, orderBy: { createdAt: 'asc' }, take: 200 })
    return json(res, 200, { ok: true, messages: rows.map((m) => ({ id: m.id, role: m.role, content: m.content, at: m.createdAt.toISOString() })) })
  }

  return json(res, 404, { ok: false, error: 'مسیر ناشناخته' })
}

/* ---------------- scheduler ---------------- */

let tickBusy = false
/* when the scheduled daily report fails (LLM down), back off 15 min instead
 * of re-entering generateDailyReport on every 20 s tick */
let reportRetryAt = 0

async function tick(): Promise<void> {
  if (tickBusy) return
  tickBusy = true
  try {
    const settings = await getSettings()

    /* scraper due? */
    if (settings.scraper_enabled === '1' && !isScraping()) {
      const everyMs = Math.max(5, parseInt(settings.scraper_every_min || '30', 10) || 30) * 60_000
      const last = await db.agentJobRun.findFirst({ where: { job: 'scraper', status: { in: ['ok', 'error', 'skipped'] } }, orderBy: { startedAt: 'desc' } })
      const dueAt = last ? new Date(last.startedAt).getTime() + everyMs : 0
      if (Date.now() >= dueAt) await runScraper('schedule')
    }

    /* daily report due? (HH:mm Tehran, once per day) */
    if (settings.report_enabled === '1') {
      const [h, m] = (settings.report_time || '08:30').split(':').map((x) => parseInt(x, 10) || 0)
      const nowHM = tehranHHMM()
      const [nh, nm] = nowHM.split(':').map((x) => parseInt(x, 10) || 0)
      if (nh * 60 + nm >= h * 60 + m) {
        const today = tehranDateStr()
        const existing = await db.agentReport.findFirst({ where: { forDate: today } })
        if (!existing && Date.now() >= reportRetryAt) {
          const r = await generateDailyReport('schedule')
          reportRetryAt = r.ok ? 0 : Date.now() + 15 * 60_000
        }
      }
    }

    /* imgreq polling (main watcher + every instance) */
    await pollImgreq()
  } catch (e) {
    console.error('[tick]', e)
  } finally {
    tickBusy = false
  }
}

async function pollImgreq(): Promise<void> {
  const dirs = [path.join(WATCHER_DIR, 'imgreq')]
  try {
    for (const name of readdirSync(INSTANCES_ROOT)) {
      const d = path.join(INSTANCES_ROOT, name, 'imgreq')
      if (existsSync(d)) dirs.push(d)
    }
  } catch {
    /* no instances */
  }

  for (const dir of dirs) {
    let names: string[] = []
    try {
      names = readdirSync(dir).filter((n) => n.endsWith('.json')).sort()
    } catch {
      continue
    }
    for (const name of names.slice(0, 3)) {
      const file = path.join(dir, name)
      try {
        const req = JSON.parse((await import('fs')).readFileSync(file, 'utf8')) as { chat_id?: number; prompt?: string; src?: string }
        const prompt = String(req.prompt || '').trim()
        const chatId = req.chat_id
        if (!prompt || !chatId) throw new Error('imgreq بدشکل')
        const today = tehranDateStr()
        const quota = parseInt(await getSetting('image_quota') || '150', 10) || 150
        const used = await db.agentImage.count({ where: { dayDate: today } })
        // reply through the SAME watcher tree the request came from
        const sendqDir = req.src && req.src !== 'main' && existsSync(path.join(INSTANCES_ROOT, req.src))
          ? path.join(INSTANCES_ROOT, req.src, 'sendq')
          : SENDQ_DIR
        // image capability switched off from the panel → tell the owner honestly
        if ((await getSetting('image_enabled')) === '0') {
          sendqTo(sendqDir, { chat: chatId, text: '😔 قابلیت تولید تصویر موقتاً خاموشه؛ از پنل «قابلیت‌ها» روشنش کن.' })
          rmSync(file, { force: true })
          continue
        }
        if (!reserveImageQuota(1, used, quota)) {
          sendqTo(sendqDir, { chat: chatId, text: `😞 سهمیهٔ تولید تصویر امروز پر شده (${used}/${quota}).` })
          rmSync(file, { force: true })
          continue
        }
        const run = await startRun('image')
        try {
          const size = await getSetting('image_size')
          const b64 = await llmImageSmart(prompt, size)
          mkdirSync(IMAGES_PUBLIC_DIR, { recursive: true })
          const rel = `img-${Date.now()}-${randomBytes(3).toString('hex')}${imageExtFromBase64(b64)}`
          const abs = path.join(IMAGES_PUBLIC_DIR, rel)
          writeFileSync(abs, Buffer.from(b64, 'base64'))
          await db.agentImage.create({ data: { prompt, path: `/agent-images/${rel}`, size, dayDate: today } })
          const okSend = sendqTo(sendqDir, { chat: chatId, file: abs, caption: `🎨 ${prompt.slice(0, 200)}` })
          await finishRun(run.id, 'ok', `تصویر Telegram ساخته شد${okSend ? ' و در صف ارسال رفت' : ''}`)
        } catch (e) {
          sendqTo(sendqDir, { chat: chatId, text: '😞 تولید تصویر الان گیر کرد؛ کمی بعد دوباره بگو.' })
          await finishRun(run.id, 'error', `imgreq: ${e instanceof Error ? e.message.slice(0, 120) : 'error'}`)
        } finally {
          releaseImageQuota(1)
        }
        rmSync(file, { force: true })
      } catch {
        rmSync(file, { force: true })
      }
    }
  }
}

/** sendq writer that can target an instance tree (not just the main watcher) */
function sendqTo(dir: string, item: { chat: string | number; text?: string; file?: string; caption?: string }): boolean {
  try {
    mkdirSync(dir, { recursive: true })
    const name = `sq-${Date.now()}-${randomBytes(3).toString('hex')}.json`
    const tmp = path.join(dir, `${name}.tmp`)
    writeFileSync(tmp, JSON.stringify(item), 'utf8')
    renameSync(tmp, path.join(dir, name))
    return true
  } catch {
    return false
  }
}

/* ---------------- boot ---------------- */

/** one-time random defaults for public site key + woo webhook secret */
async function initDefaults() {
  if (!(await getSetting('support_site_key'))) await setSetting('support_site_key', defaultSiteKey())
  if (!(await getSetting('woo_webhook_secret'))) await setSetting('woo_webhook_secret', randomBytes(16).toString('hex'))
}

const server = createServer((req, res) => {
  route(req, res).catch((e) => {
    console.error('[route]', e)
    try {
      json(res, 500, { ok: false, error: 'خطای داخلی سرویس ایجنت' })
    } catch {
      /* headers already sent */
    }
  })
})

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`[agent] Z agent core v${AGENT_VERSION} on :${PORT}`)
  await initDefaults().catch(() => {})
  // video jobs left «processing» by a previous run are dead — mark + tell the owner
  await reconcileStaleVideos().catch((e) => console.error('[video-reconcile]', e))
  // first tick after 5 s (let the db settle), then every 20 s
  setTimeout(tick, 5_000)
  setInterval(tick, 20_000)
})

process.on('unhandledRejection', (e) => console.error('[unhandled]', e))
process.on('uncaughtException', (e) => console.error('[uncaught]', e))
