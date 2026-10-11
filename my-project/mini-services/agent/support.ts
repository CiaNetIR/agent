/**
 * Z agent core — website support agent (public chat).
 * Sessions + messages in the DB, LLM answers with the store persona +
 * product context (live WooCommerce catalog when configured).
 * Rate limits: 20 user messages/hour per session, 400/day global.
 */
import { createHash } from 'crypto'
import { db, getSettings, tehranDayStartMs } from './lib'
import { llmChat, type ChatMsg } from './llm'
import { wooCfg } from './woo'

const SESSION_HOURLY = 20
const GLOBAL_DAILY = 400
const MAX_MSG = 1000
const NEW_SESSIONS_PER_HOUR = 30

/* in-memory throttle for NEW-session creation — random-sessionId spam used to
 * mint unbounded SupportSession rows before any quota check ran */
let newSessionTimes: number[] = []

export interface SupportInput {
  siteKey: string
  sessionId?: string
  message: string
  userAgent?: string
}

export interface SupportOutput {
  ok: boolean
  error?: string
  sessionId?: string
  reply?: string
}

function hashId(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 24)
}

export async function supportChat(input: SupportInput): Promise<SupportOutput> {
  const settings = await getSettings()

  if (settings.support_enabled !== '1') {
    return { ok: false, error: 'پشتیبانی فعلاً غیرفعال است.' }
  }
  if (!input.siteKey || input.siteKey !== settings.support_site_key) {
    return { ok: false, error: 'کلید سایت نامعتبر است.' }
  }
  const message = (input.message || '').trim().slice(0, MAX_MSG)
  if (!message) return { ok: false, error: 'پیام خالی بود.' }

  // global daily quota FIRST — before anything is written (unauthenticated
  // spam must not grow the DB)
  const dayStart = new Date(tehranDayStartMs())
  const globalToday = await db.supportMessage.count({
    where: { role: 'user', createdAt: { gte: dayStart } },
  })
  if (globalToday >= GLOBAL_DAILY) {
    return { ok: false, error: 'پشتیبانی امروز به سهمیهٔ روزانه رسیده؛ فردا دوباره پیام بدهید.' }
  }

  // find or create session
  let sessionId = (input.sessionId || '').trim().slice(0, 64)
  let session = sessionId ? await db.supportSession.findUnique({ where: { id: sessionId } }) : null
  if (!session) {
    const now = Date.now()
    newSessionTimes = newSessionTimes.filter((t) => now - t < 3_600_000)
    if (newSessionTimes.length >= NEW_SESSIONS_PER_HOUR) {
      return { ok: false, error: 'ترافیک زیاد است؛ کمی بعد دوباره تلاش کنید.' }
    }
    newSessionTimes.push(now)
    session = await db.supportSession.create({
      data: { siteKey: input.siteKey, userAgent: (input.userAgent || '').slice(0, 200) },
    })
    sessionId = session.id
  }

  // rate limits
  const hourAgo = new Date(Date.now() - 3_600_000)
  const recentUserMsgs = await db.supportMessage.count({
    where: { sessionId, role: 'user', createdAt: { gte: hourAgo } },
  })
  if (recentUserMsgs >= SESSION_HOURLY) {
    return { ok: false, error: 'پیام‌هایتان زیاد بوده؛ کمی صفر صبر کنید 🙏', sessionId }
  }

  await db.supportMessage.create({ data: { sessionId, role: 'user', content: message } })

  // context: last 12 messages
  const history = await db.supportMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: 12,
  })
  const msgs: ChatMsg[] = history
    .reverse()
    .map((m) => ({ role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const), content: m.content.slice(0, 1500) }))

  // product context from the synced catalog (or live woo list)
  let productContext = ''
  const mapCount = await db.wooProductMap.count()
  if (mapCount > 0) {
    const products = await db.wooProductMap.findMany({ orderBy: { lastSyncAt: 'desc' }, take: 20 })
    productContext = '\n\nلیست محصولات (قیمت/موجودی واقعی — فقط از همین‌ها بگو):\n' +
      products.map((p) => `- ${p.name || p.sku} | قیمت: ${p.price} | موجودی: ${p.stock}`).join('\n')
  } else {
    const cfg = await wooCfg()
    if (cfg) {
      try {
        const r = await fetch(`${cfg.site}/wp-json/wc/v3/products?per_page=20&status=publish&consumer_key=${encodeURIComponent(cfg.key)}&consumer_secret=${encodeURIComponent(cfg.secret)}`)
        if (r.ok) {
          const arr = (await r.json()) as Record<string, unknown>[]
          if (Array.isArray(arr) && arr.length) {
            productContext = '\n\nلیست محصولات (از سایت):\n' +
              arr.map((p) => `- ${p.name} | قیمت: ${p.regular_price} ${p.stock_status === 'instock' ? '| موجود' : '| ناموجود'}`).join('\n')
          }
        }
      } catch {
        /* no product context — fine */
      }
    }
  }

  const system = `${settings.support_persona}

نام فروشگاه: «${settings.support_store || 'فروشگاه'}»${productContext || `

⚠️ لیست محصولات: هنوز هیچ محصولی به تو معرفی نشده. دربارهٔ قیمت، موجودی یا لیست محصولات هیچ عدد و اسمی از خودت نساز؛ صادقانه بگو اطلاعات دقیق همین الان در دسترست نیست و همکار انسانی سریع خبرش می‌کنه. فقط سوالات عمومی (نحوه خرید، ارسال و…) را جواب بده.`}`

  let reply: string
  try {
    reply = await llmChat(system, msgs, { thinking: false, timeoutMs: 60_000 })
  } catch {
    reply = 'الان یه اشکال پیش اومده؛ چند لحظه بعد دوباره پیام بده 🙏'
  }

  await db.supportMessage.create({ data: { sessionId, role: 'assistant', content: reply.slice(0, 2000) } })
  await db.supportSession.update({ where: { id: sessionId }, data: { lastAt: new Date() } })

  return { ok: true, sessionId, reply: reply.slice(0, 2000) }
}

export function defaultSiteKey(): string {
  return hashId(`site-${Date.now()}-${Math.random()}`)
}
