/**
 * Z agent core — WooCommerce REST (wc/v3) client + CSV product sync.
 * Consumer key/secret over HTTP Basic auth, standard WooCommerce REST API.
 * Sync rule (owner spec): new products in the CSV get CREATED, existing
 * ones get their price + stock (and name) UPDATED — matched by SKU.
 */
import { csvToProducts, db, finishRun, getSettings, startRun } from './lib'

export interface WooCfg {
  site: string
  key: string
  secret: string
}

export async function wooCfg(): Promise<WooCfg | null> {
  const s = await getSettings()
  if (!s.woo_site || !s.woo_key || !s.woo_secret) return null
  return { site: s.woo_site.replace(/\/+$/, ''), key: s.woo_key, secret: s.woo_secret }
}

function wooUrl(cfg: WooCfg, path: string, params: Record<string, string> = {}): string {
  const u = new URL(`${cfg.site}/wp-json/wc/v3/${path.replace(/^\/+/, '')}`)
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
  return u.toString()
}

function wooAuth(cfg: WooCfg): Record<string, string> {
  const basic = Buffer.from(`${cfg.key}:${cfg.secret}`).toString('base64')
  return { authorization: `Basic ${basic}`, 'content-type': 'application/json' }
}

async function wooFetch(cfg: WooCfg, method: string, p: string, params: Record<string, string> = {}, body?: unknown, timeoutMs = 30_000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(wooUrl(cfg, p, params), {
      method,
      headers: wooAuth(cfg),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    })
    const text = await res.text()
    let json: unknown = null
    try {
      json = JSON.parse(text)
    } catch {
      /* html error page etc */
    }
    return { status: res.status, ok: res.ok, json, text: text.slice(0, 400) }
  } finally {
    clearTimeout(t)
  }
}

/** connectivity + credentials test */
export async function wooTest(cfg: WooCfg): Promise<{ ok: boolean; detail: string }> {
  try {
    const r = await wooFetch(cfg, 'GET', 'products', { per_page: '1' })
    if (r.ok) {
      const env = (r.json as { environment?: { version?: string } } | null)?.environment?.version
      return { ok: true, detail: env ? `اتصال موفق — ووکامرس ${env}` : 'اتصال موفق' }
    }
    if (r.status === 401 || r.status === 403) return { ok: false, detail: 'کلید/رمز ووکامرس رد شد (۴۰۱/۴۰۳)' }
    if (r.status === 404) return { ok: false, detail: 'مسیر REST پیدا نشد (۴۰۴) — آدرس سایت و فعال بودن REST را چک کن' }
    return { ok: false, detail: `پاسخ ${r.status}: ${r.text.slice(0, 120)}` }
  } catch (e) {
    return { ok: false, detail: `اتصال برقرار نشد: ${e instanceof Error ? e.message : String(e)}` }
  }
}

interface WooProduct {
  id: number
  sku?: string
  name?: string
  regular_price?: string
  stock_quantity?: number | null
}

/** search product by exact SKU ( woo returns empty array when none) */
async function findBySku(cfg: WooCfg, sku: string): Promise<WooProduct | null> {
  const r = await wooFetch(cfg, 'GET', 'products', { sku, per_page: '5' })
  if (!r.ok) throw new Error(`جستجوی SKU ${sku}: پاسخ ${r.status}`)
  const arr = r.json as WooProduct[] | null
  const hit = (arr || []).find((p) => p.sku === sku)
  return hit || null
}

export interface SyncResult {
  ok: boolean
  total: number
  created: number
  updated: number
  unchanged: number
  errors: string[]
  configured: boolean
}

/** THE CSV → WooCommerce sync (create new / update price+stock+name by SKU) */
export async function wooSyncCsv(csvText: string, opts: { record?: boolean } = {}): Promise<SyncResult> {
  const cfg = await wooCfg()
  if (!cfg) {
    return { ok: false, configured: false, total: 0, created: 0, updated: 0, unchanged: 0, errors: [], }
  }
  const run = opts.record ? await startRun('woo_sync') : null
  const products = csvToProducts(csvText)
  let created = 0
  let updated = 0
  let unchanged = 0
  const errors: string[] = []

  for (const p of products.slice(0, 200)) {
    try {
      const mapped = await db.wooProductMap.findUnique({ where: { sku: p.sku } })
      let wooId = mapped?.wooId ?? null
      // no local map? ask the store (product might exist from before)
      if (!wooId) {
        const remote = await findBySku(cfg, p.sku)
        wooId = remote?.id ?? null
      }
      if (wooId) {
        const changed =
          !mapped ||
          mapped.price !== p.price ||
          mapped.stock !== p.stock ||
          mapped.name !== p.name
        if (changed) {
          const r = await wooFetch(cfg, 'PUT', `products/${wooId}`, {}, {
            name: p.name,
            regular_price: p.price,
            stock_quantity: p.stock,
            manage_stock: true,
          })
          if (r.status === 404 || r.status === 400) {
            // product was deleted from the store → clear the stale map and
            // fall through to the create path below
            await db.wooProductMap.deleteMany({ where: { sku: p.sku } })
            wooId = null
          } else if (!r.ok) {
            throw new Error(`آپدیت ${p.sku}: ${r.status}`)
          } else {
            updated++
          }
        } else {
          unchanged++
        }
      }
      if (!wooId) {
        const r = await wooFetch(cfg, 'POST', 'products', {}, {
          name: p.name,
          sku: p.sku,
          regular_price: p.price,
          stock_quantity: p.stock,
          manage_stock: true,
          type: 'simple',
          description: p.description || undefined,
        })
        if (!r.ok) throw new Error(`ساخت ${p.sku}: ${r.status} ${r.text.slice(0, 80)}`)
        const np = r.json as WooProduct
        wooId = np.id
        created++
      }
      await db.wooProductMap.upsert({
        where: { sku: p.sku },
        create: { sku: p.sku, wooId, name: p.name, price: p.price, stock: p.stock },
        update: { wooId, name: p.name, price: p.price, stock: p.stock },
      })
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }

  const result: SyncResult = {
    ok: errors.length === 0,
    configured: true,
    total: products.length,
    created,
    updated,
    unchanged,
    errors: errors.slice(0, 10),
  }
  if (run) {
    await finishRun(
      run.id,
      result.ok ? 'ok' : 'error',
      `همگام‌سازی ووکامرس: ${created} جدید، ${updated} آپدیت، ${unchanged} بدون تغییر${errors.length ? `، ${errors.length} خطا` : ''}`,
      result
    )
  }
  return result
}

/** orders since an ISO date — for the daily accounting report.
 *  Paginated: stores with >50 orders/day used to be silently undercounted. */
export async function wooOrdersSince(cfg: WooCfg, sinceIso: string): Promise<{ ok: boolean; orders: unknown[]; error?: string }> {
  try {
    const all: unknown[] = []
    for (let page = 1; page <= 10; page++) {
      const r = await wooFetch(cfg, 'GET', 'orders', {
        after: sinceIso,
        per_page: '50',
        page: String(page),
        status: 'any',
      })
      if (!r.ok) return { ok: false, orders: [], error: `پاسخ ${r.status}` }
      const batch = (r.json as unknown[]) || []
      all.push(...batch)
      if (batch.length < 50) break // last page reached
    }
    return { ok: true, orders: all }
  } catch (e) {
    return { ok: false, orders: [], error: e instanceof Error ? e.message : String(e) }
  }
}
