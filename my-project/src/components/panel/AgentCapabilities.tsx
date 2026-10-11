'use client'

import { useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/hooks/use-toast'
import {
  Bot,
  FileText,
  ImagePlus,
  Loader2,
  MessagesSquare,
  Radar,
  Receipt,
  RefreshCw,
  Send,
  ShoppingCart,
} from 'lucide-react'
import { panelFetch } from '@/lib/panel'

/* ------------------------------------------------------------------ */
/* types — verified against agent core :3004 /overview (capabilities) */
/* ------------------------------------------------------------------ */

export interface CapabilitiesData {
  watcher: { mainRunning: boolean; instancesTotal: number; instancesRunning: number }
  scraper: { enabled: boolean; sendTxt: boolean }
  woo: { autoSync: boolean; configured: boolean }
  invoiceAuto: boolean
  report: { enabled: boolean; time: string }
  images: { enabled: boolean; usedToday: number; quota: number }
  support: { enabled: boolean; sessions: number }
}

interface OverviewForCaps {
  ok: boolean
  scraper: { enabled: boolean; lastRun: { status: string; at: string } | null; nextRunAt: string | null }
  woo: { configured: boolean; site: string }
  report: { last: { forDate: string; at: string } | null }
  invoices: { today: number }
  capabilities?: CapabilitiesData
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function fa(n: number): string {
  try {
    return n.toLocaleString('fa-IR')
  } catch {
    return String(n)
  }
}

function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'medium' }).format(new Date(iso))
  } catch {
    return iso
  }
}

/* ------------------------------------------------------------------ */
/* capability card                                                     */
/* ------------------------------------------------------------------ */

function CapCard({
  icon,
  title,
  desc,
  on,
  busy,
  onToggle,
  status,
}: {
  icon: ReactNode
  title: string
  desc: string
  on: boolean
  busy: boolean
  onToggle: (next: boolean) => void
  status: string
}) {
  return (
    <Card className={`border-zinc-800 transition-colors ${on ? 'bg-zinc-900/70' : 'bg-zinc-950/70'}`}>
      <CardContent className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                on
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-500'
              }`}
            >
              {icon}
            </span>
            <p className="text-sm font-bold text-zinc-100">{title}</p>
          </div>
          {busy ? (
            <div className="flex h-6 w-11 items-center justify-center" aria-busy="true">
              <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
            </div>
          ) : (
            <Switch checked={on} onCheckedChange={onToggle} aria-label={title} />
          )}
        </div>
        <p className="min-h-[2.5rem] text-[11px] leading-5 text-zinc-500">{desc}</p>
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${on ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
          <span className={`truncate ${on ? 'text-emerald-400/90' : 'text-zinc-500'}`} title={status}>
            {status}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

/* ------------------------------------------------------------------ */
/* main                                                                */
/* ------------------------------------------------------------------ */

export default function AgentCapabilities({
  overview,
  loading,
  onRefresh,
  onChanged,
}: {
  /** live overview from the parent AgentTab — single 30s poll, no duplicate */
  overview: OverviewForCaps | null
  loading: boolean
  onRefresh: () => void
  onChanged?: (keys?: string[]) => void
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [confirmWatcherOff, setConfirmWatcherOff] = useState(false)

  function setBusyKey(key: string, on: boolean) {
    setBusy((b) => {
      const nb = { ...b }
      if (on) nb[key] = true
      else delete nb[key]
      return nb
    })
  }

  /** toggle a settings-backed capability (scraper / txt / woo-sync / invoice-auto / report / images / support) */
  async function toggleSetting(
    key: string,
    on: boolean,
    title: string,
    onDesc?: string,
    offDesc?: string
  ) {
    setBusyKey(key, true)
    try {
      const res = await panelFetch('/api/panel/agent', {
        method: 'POST',
        body: JSON.stringify({ op: 'settings', data: { [key]: on ? '1' : '0' } }),
      })
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) {
        toast({ title: 'اعمال نشد', description: json.error, variant: 'destructive' })
      } else {
        toast({ title: `${title} ${on ? 'روشن شد ✓' : 'خاموش شد'}`, description: on ? onDesc ?? 'از الان فعاله.' : offDesc ?? 'از الان غیرفعاله.' })
        onChanged?.([key])
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setBusyKey(key, false)
    }
  }

  /** master toggle: main watcher + all account instances (real processes) */
  async function doToggleWatcher(on: boolean) {
    setBusyKey('watcher', true)
    try {
      const res = await panelFetch('/api/panel/accounts', {
        method: 'POST',
        body: JSON.stringify({ op: 'toggle-all', on }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        main?: boolean
        instances?: number
        instancesTotal?: number
        error?: string
      }
      if (!res.ok || !json.ok) {
        toast({ title: 'اعمال نشد', description: json.error, variant: 'destructive' })
      } else if (on && json.main === false) {
        // ok:true but the main watcher never started — don't celebrate
        toast({
          title: 'اکانت‌ها فعال شد ولی واتچر اصلی استارت نشد!',
          description: `واتچر اصلی استارت نشد! — ${fa(json.instances ?? 0)} اکانت هم فعال شدن.`,
          variant: 'destructive',
        })
      } else {
        toast({
          title: on ? 'پاسخگوی تلگرام روشن شد ✓' : 'پاسخگوی تلگرام خاموش شد',
          description: on
            ? `واتچر اصلی ${json.main ? 'استارت شد' : 'استارت نشد!'} — ${fa(json.instances ?? 0)} اکانت هم فعال شدن.`
            : `واتچر اصلی ${json.main === false ? 'متوقف نشد!' : 'متوقف شد'} — ${fa(json.instances ?? 0)} اکانت هم خاموش شدن.`,
        })
      }
      onChanged?.()
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setBusyKey('watcher', false)
    }
  }

  /* ---------------- loading / stale-service guards ---------------- */

  if (loading && !overview) {
    return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-36 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/50" />
        ))}
      </div>
    )
  }

  const caps = overview?.capabilities
  if (!caps) {
    return (
      <Card className="border-dashed border-zinc-800 bg-zinc-900/40">
        <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
          <Bot className="h-7 w-7 text-zinc-600" />
          <p className="text-xs font-bold text-zinc-300">قابلیت‌ها خوانده نشد</p>
          <p className="max-w-sm text-[11px] leading-5 text-zinc-500">
            سرویس ایجنت جواب نداد یا هنوز نسخهٔ جدیدش بالا نیامده. یکبار دیگه تلاش کن.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
          >
            <RefreshCw className="h-3.5 w-3.5" /> تلاش دوباره
          </Button>
        </CardContent>
      </Card>
    )
  }

  /* ---------------- derived status lines ---------------- */

  const watcherOn = caps.watcher.mainRunning || caps.watcher.instancesRunning > 0
  const watcherStatus = caps.watcher.mainRunning
    ? `واتچر اصلی فعاله${caps.watcher.instancesTotal > 0 ? ` — ${fa(caps.watcher.instancesRunning)} از ${fa(caps.watcher.instancesTotal)} اکانت فعال` : ''}`
    : caps.watcher.instancesRunning > 0
      ? `واتچر اصلی خاموشه — ولی ${fa(caps.watcher.instancesRunning)} اکانت هنوز فعاله`
      : 'هیچ پاسخ‌گویی روشن نیست'

  const scraperStatus = caps.scraper.enabled
    ? overview?.scraper.nextRunAt
      ? `اجرای بعدی به‌زودی — آخرین: ${fmtDay(overview.scraper.lastRun?.at)}`
      : 'زمان‌بندی فعاله'
    : `زمان‌بندی خوابه — آخرین اجرا: ${fmtDay(overview?.scraper.lastRun?.at ?? null)}`

  const txtStatus = caps.scraper.sendTxt
    ? caps.scraper.enabled
      ? 'خروجی متنی هر اسکرپ می‌ره تلگرام'
      : 'فعاله ولی اسکرپر خاموشه'
    : 'خروجی TXT فقط ذخیره می‌شه'

  const wooStatus = !caps.woo.configured
    ? 'ووکامرس تنظیم نشده (تب ووکامرس)'
    : caps.woo.autoSync
      ? `بعد از هر اسکرپ با ${overview?.woo.site || 'سایت'} همگام می‌شه`
      : 'همگام‌سازی فقط دستی از تب ووکامرس'

  const invoiceStatus = `امروز ${fa(overview?.invoices.today ?? 0)} فاکتور صادر شده`

  const reportStatus = caps.report.enabled
    ? `هر روز ساعت ${caps.report.time} تهران${overview?.report.last ? ` — آخرین: ${fmtDay(overview.report.last.at)}` : ''}`
    : `خاموشه — آخرین گزارش: ${fmtDay(overview?.report.last?.at ?? null)}`

  const imageStatus = caps.images.enabled
    ? `امروز ${fa(caps.images.usedToday)} از ${fa(caps.images.quota)} تصویر`
    : `سهمیهٔ روزانه: ${fa(caps.images.quota)} — ولی تولید قطعه`

  const supportStatus = caps.support.enabled
    ? `${fa(caps.support.sessions)} گفتگوی ثبت‌شده`
    : 'ویجت سایت جواب نمی‌ده'

  /* ---------------- render ---------------- */

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4">
          <p className="text-xs leading-6 text-zinc-400">
            تک‌تک قابلیت‌های ایجنت از همین‌جا روشن و خاموش می‌شن — هر کلید فوراً اعمال می‌شه و وضعیت زندهٔ هر
            قابلیت هم پایینش نوشته شده.
          </p>
          <div className="flex items-center gap-2">
            <Badge className="bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700">رفرش خودکار: ۳۰ ثانیه</Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> رفرش
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <CapCard
          icon={<Bot className="h-4 w-4" />}
          title="پاسخگوی تلگرام"
          desc="جواب خودکار به پیام‌های خصوصی مشتری‌ها + دستورهای Saved Messages. خاموش‌کردنش واتچر اصلی و همهٔ اکانت‌ها رو متوقف می‌کنه."
          on={watcherOn}
          busy={!!busy.watcher}
          onToggle={(next) => {
            if (next) void doToggleWatcher(true)
            else setConfirmWatcherOff(true)
          }}
          status={watcherStatus}
        />
        <CapCard
          icon={<Radar className="h-4 w-4" />}
          title="اسکرپر زمان‌بندی‌شده"
          desc="اجرای خودکار اسکریپت پایتون هر ۳۰ دقیقه (قابل تغییر) با سه خروجی TXT / CSV / JSON."
          on={caps.scraper.enabled}
          busy={!!busy.scraper_enabled}
          onToggle={(next) => void toggleSetting('scraper_enabled', next, 'اسکرپر', 'زمان‌بندی اجرای اسکرپر فعاله.', 'زمان‌بندی اجرای اسکرپر متوقف شد.')}
          status={scraperStatus}
        />
        <CapCard
          icon={<Send className="h-4 w-4" />}
          title="ارسال TXT به تلگرام"
          desc="خروجی متنی هر اجرای اسکرپر، خودکار به چت تلگرامِ تعیین‌شده ارسال می‌شه."
          on={caps.scraper.sendTxt}
          busy={!!busy.scraper_send_txt}
          onToggle={(next) => void toggleSetting('scraper_send_txt', next, 'ارسال TXT', 'خروجی متنی به تلگرام می‌ره.', 'ارسال متنی قطع شد؛ فقط ذخیره می‌شه.')}
          status={txtStatus}
        />
        <CapCard
          icon={<ShoppingCart className="h-4 w-4" />}
          title="همگام‌سازی ووکامرس"
          desc="بعد از هر اسکرپ: محصول جدید بساز و قیمت/موجودی رو در سایت ووکامرسی آپدیت کن."
          on={caps.woo.autoSync}
          busy={!!busy.woo_auto_sync}
          onToggle={(next) => void toggleSetting('woo_auto_sync', next, 'همگام‌سازی ووکامرس', 'بعد از هر اسکرپ خودکار همگام می‌شه.', 'همگام‌سازی خودکار قطع شد.')}
          status={wooStatus}
        />
        <CapCard
          icon={<Receipt className="h-4 w-4" />}
          title="فاکتور خودکار سفارش‌ها"
          desc="سفارش جدید در ووکامرس → فاکتور HTML لحظه‌ای + ارسال به تلگرام (از طریق وبهوک)."
          on={caps.invoiceAuto}
          busy={!!busy.invoice_auto}
          onToggle={(next) => void toggleSetting('invoice_auto', next, 'فاکتور خودکار', 'برای هر سفارش جدید فاکتور صادر می‌شه.', 'سفارش‌ها دریافت می‌شن ولی فاکتور ساخته نمی‌شه.')}
          status={invoiceStatus}
        />
        <CapCard
          icon={<FileText className="h-4 w-4" />}
          title="گزارش روزانهٔ فروش"
          desc="هر روز سر ساعت تعیین‌شده، آنالیز فروش و امور حسابداری ساخته و به تلگرام می‌ره."
          on={caps.report.enabled}
          busy={!!busy.report_enabled}
          onToggle={(next) => void toggleSetting('report_enabled', next, 'گزارش روزانه', 'گزارش روزانه طبق زمان‌بندی می‌ره تلگرامت.', 'گزارش روزانه دیگه ساخته نمی‌شه.')}
          status={reportStatus}
        />
        <CapCard
          icon={<ImagePlus className="h-4 w-4" />}
          title="تولید تصویر"
          desc="تولید تصویر با هوش مصنوعی از پنل یا دستور image در تلگرام — تا ۱۵۰ تصویر در روز."
          on={caps.images.enabled}
          busy={!!busy.image_enabled}
          onToggle={(next) => void toggleSetting('image_enabled', next, 'تولید تصویر', 'دستور image و ساخت تصویر از پنل فعاله.', 'تولید تصویر قطع شد.')}
          status={imageStatus}
        />
        <CapCard
          icon={<MessagesSquare className="h-4 w-4" />}
          title="پشتیبانی سایت"
          desc="ویجت چت هوشمند روی سایتت که به سؤالات مشتری‌ها جواب می‌ده (قابل امبد در هر صفحه)."
          on={caps.support.enabled}
          busy={!!busy.support_enabled}
          onToggle={(next) => void toggleSetting('support_enabled', next, 'پشتیبانی سایت', 'ویجت سایت جواب می‌ده.', 'ویجت سایت دیگه جواب نمی‌ده.')}
          status={supportStatus}
        />
      </div>

      {/* confirm before killing the live auto-responder */}
      <AlertDialog open={confirmWatcherOff} onOpenChange={setConfirmWatcherOff}>
        <AlertDialogContent dir="rtl" className="border-zinc-800 bg-zinc-950 sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm text-zinc-100">پاسخگوی تلگرام خاموش بشه؟</AlertDialogTitle>
            <AlertDialogDescription className="text-[11px] leading-6">
              واتچر اصلی و همهٔ اکانت‌های در حال اجرا متوقف می‌شن و دیگه هیچ جواب خودکاری به مشتری‌ها داده
              نمی‌شه تا خودت دوباره روشنش کنی. بقیهٔ قابلیت‌ها دست‌نخورده می‌مونن.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel className="h-8 border-zinc-700 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100">
              بی‌خیال
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void doToggleWatcher(false)}
              className="h-8 bg-red-600 text-xs font-bold text-white hover:bg-red-500"
            >
              خاموشش کن
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
