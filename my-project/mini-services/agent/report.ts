/**
 * Z agent core — daily sales/accounting AI report.
 * Gathers today's real numbers (invoices, WooCommerce orders when
 * configured, product map, images, support chats, scraper runs) → LLM
 * analysis (thinking ON) in Persian → saved to DB + sent to Telegram.
 */
import { db, getSettings, sendqWrite, tehranDateStr } from './lib'
import { llmChat } from './llm'
import { wooCfg, wooOrdersSince } from './woo'

const REPORT_SYSTEM = `تو یک حسابدار و تحلیلگر فروش حرفه‌ای هستی که هر روز گزارش مالی و فروش یک فروشگاه اینترنتی را برای مالکش آماده می‌کند.

قواعد:
- فقط با عددهایی که داده شده‌ات کار کن؛ هیچ عددی از خودت نساز و تخمین نزن.
- گزارش را کوتاه و کاربردی بنویس (حداکثر ~۲۵ خط) با این بخش‌ها:
  ۱) خلاصهٔ فروش امروز (تعداد و مبلغ فاکتور‌ها)
  ۲) سفارش‌های ووکامرس (اگر داده شده)
  ۳) نکات قابل‌توجه (مثلاً کالای پرفروش، موجودی رو به اتمام از لیست محصولاتی که داده شده)
  ۴) یک توصیهٔ عملی برای فردا
- فارسی روان و خودمونیِ اداری بنویس، از ایموجی کم و به‌جا استفاده کن.
- مبلغ‌ها را با جداکنندهٔ هزارگان بنویس.`

export async function generateDailyReport(trigger: 'schedule' | 'manual'): Promise<{ ok: boolean; error?: string; report?: { id: string; content: string; sentTg: boolean } }> {
  const today = tehranDateStr()
  const dayStart = new Date(`${today}T00:00:00+03:30`).getTime()
  if (isNaN(dayStart)) return { ok: false, error: 'خطای تاریخ' }

  const settings = await getSettings()

  // invoices today
  const invoices = await db.agentInvoice.findMany({ where: { createdAt: { gte: new Date(dayStart) } }, orderBy: { createdAt: 'desc' } })
  const invTotal = invoices.reduce((a, i) => a + (Number(i.total) || 0), 0)

  // product map (stock overview)
  const products = await db.wooProductMap.findMany({ orderBy: { lastSyncAt: 'desc' }, take: 15 })

  // images today
  const imagesToday = await db.agentImage.count({ where: { dayDate: today } })

  // support today
  const supportSessions = await db.supportSession.count({ where: { lastAt: { gte: new Date(dayStart) } } })
  const supportMsgs = await db.supportMessage.count({ where: { createdAt: { gte: new Date(dayStart) } } })

  // scraper runs today
  const runs = await db.agentJobRun.count({ where: { job: 'scraper', status: 'ok', startedAt: { gte: new Date(dayStart) } } })

  // WooCommerce orders today (only when configured)
  let wooLines = 'ووکامرس: پیکربندی نشده'
  const cfg = await wooCfg()
  if (cfg) {
    const r = await wooOrdersSince(cfg, new Date(dayStart).toISOString())
    if (r.ok && r.orders.length) {
      const oo = r.orders as Record<string, unknown>[]
      const completed = oo.filter((o) => o.status === 'completed')
      const revenue = oo.reduce((a, o) => a + (Number(o.total) || 0), 0)
      wooLines = `سفارش‌های ووکامرس امروز: ${oo.length} سفارش (${completed.length} تکمیل‌شده) — جمع مبالغ ثبت‌شده: ${revenue.toLocaleString('fa-IR')}`
    } else if (r.ok) {
      wooLines = 'سفارش‌های ووکامرس امروز: هیچ سفارشی ثبت نشده'
    } else {
      wooLines = `خطای دریافت سفارش‌های ووکامرس: ${r.error}`
    }
  }

  const invList = invoices.length
    ? invoices.slice(0, 10).map((i) => `- ${i.number} | ${i.customer} | ${Number(i.total).toLocaleString('fa-IR')} ${i.currency} | ${i.status}`).join('\n')
    : 'فاکتوری صادر نشده'

  const productList = products.length
    ? products.map((p) => `- ${p.name || p.sku} | قیمت ${p.price} | موجودی ${p.stock}`).join('\n')
    : 'هنوز محصولی همگام نشده'

  const prompt = `داده‌های واقعی امروز (${today}) فروشگاه «${settings.support_store || 'فروشگاه'}»:

فروش/فاکتور امروز: ${invoices.length} فاکتور، جمع مبلغ ${invTotal.toLocaleString('fa-IR')}
${invList}

${wooLines}

وضعیت محصولات (آخرین همگام‌سازی):
${productList}

تصاویر تولیدشدهٔ امروز: ${imagesToday}
گفتگوهای پشتیبانی امروز: ${supportSessions} گفتگو / ${supportMsgs} پیام
اجرای موفق اسکرپر امروز: ${runs} بار

گزارش روزانهٔ حسابداری و فروش را طبق قواعد بنویس.`

  let content: string
  try {
    content = await llmChat(REPORT_SYSTEM, [{ role: 'user', content: prompt }], { thinking: true, timeoutMs: 120_000 })
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }

  const header = `📊 گزارش روزانهٔ فروش و حسابداری — ${today}\n(سرویس ایجنت — ${trigger === 'manual' ? 'دستی' : 'خودکار'})\n\n`
  const row = await db.agentReport.create({ data: { forDate: today, content: header + content, sentTg: false } })

  const sent = sendqWrite({ chat: settings.telegram_chat || 'me', text: (header + content).slice(0, 3900) })
  if (sent) await db.agentReport.update({ where: { id: row.id }, data: { sentTg: true } })

  return { ok: true, report: { id: row.id, content: header + content, sentTg: sent } }
}
