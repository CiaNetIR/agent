'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import {
  Activity,
  Ban,
  Bot,
  Clock,
  MessageCircle,
  Package,
  RefreshCw,
  Send,
  Server,
  ShieldAlert,
  Zap,
} from 'lucide-react'
import {
  clearStoredKey,
  EVENT_LABELS,
  panelFetch,
  tehranTime,
  type LlmSettings,
  type StatusData,
} from '@/lib/panel'

function fa(n: number): string {
  try {
    return n.toLocaleString('fa-IR', { maximumFractionDigits: 1 })
  } catch {
    return String(n)
  }
}

/** آپتایم با ارقام فارسی — معادل formatUptime ولی با toLocaleString('fa-IR') */
function faUptime(sec: number | null): string {
  if (sec == null) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${fa(h)} ساعت و ${fa(m)} دقیقه`
  return `${fa(m)} دقیقه`
}

/** one resource bar (RAM / disk) — turns amber when nearly full */
function resBar(label: string, used: number, total: number, pct: number) {
  const danger = pct >= 85
  return (
    <div key={label}>
      <div className="mb-1 flex items-center justify-between text-[11px]">
        <span className="text-zinc-400">{label}</span>
        <span className={danger ? 'font-bold text-amber-400' : 'text-zinc-500'}>
          {fa(used)} از {fa(total)} گیگ ({fa(pct)}٪)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full ${danger ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${Math.min(100, Math.max(2, pct))}%` }}
        />
      </div>
    </div>
  )
}

export default function StatusTab() {
  const [data, setData] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [backingUp, setBackingUp] = useState(false)
  const [llm, setLlm] = useState<LlmSettings['settings'] | null>(null)
  const { toast } = useToast()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const stoppedRef = useRef(false)

  const load = useCallback(async (): Promise<boolean> => {
    if (stoppedRef.current) return false
    try {
      const res = await panelFetch('/api/panel/status')
      if (res.status === 401) {
        /* نشست منقضی — بدون توست تکراری: توقف پولینگ + پاک‌کردن کلید + برگشت به قفل */
        if (stoppedRef.current) return false
        stoppedRef.current = true
        if (timerRef.current) clearInterval(timerRef.current)
        clearStoredKey()
        window.location.reload()
        return false
      }
      const json: StatusData = await res.json()
      setData(json)
      return json.ok
    } catch {
      /* keep old data */
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    timerRef.current = setInterval(load, 30_000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [load])

  /* تنظیمات واقعی مغز دستیار — یکبار موقع mount؛ روی شکست بج «پیش‌فرض» می‌مونه */
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await panelFetch('/api/panel/llm-settings')
        const json = (await res.json()) as LlmSettings
        if (alive && res.ok && json.ok && json.settings) setLlm(json.settings)
      } catch {
        /* keep null → badge «پیش‌فرض» */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  /* رفرش دستی: اسپینر روی دکمه + توست کوتاه در صورت شکست */
  async function manualRefresh() {
    setLoading(true)
    const ok = await load()
    if (!ok) toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
  }

  async function requestBackup() {
    if (backingUp) return
    setBackingUp(true)
    try {
      const res = await panelFetch('/api/panel/backup', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.ok) {
        toast({
          title: 'بکاپ فوری ثبت شد ✅',
          description: 'حداکثر ۱۰ ثانیه دیگه فایل بکاپ میاد تو Saved Messages تلگرامت.',
        })
      } else {
        toast({ title: 'نشد', description: json.error || 'دوباره امتحان کن', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setBackingUp(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl bg-zinc-800/60" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl bg-zinc-800/60" />
      </div>
    )
  }
  if (!data?.ok) {
    return (
      <Card className="border-red-900 bg-red-950/30">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4 text-red-300">
          <div className="flex items-center gap-3">
            <ShieldAlert className="h-5 w-5" />
            وضعیت خوانده نشد — یکبار رفرش کن.
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void manualRefresh()}
            className="h-8 border-red-800/60 bg-red-950/40 text-red-200 hover:bg-red-950/60"
          >
            <RefreshCw className="h-3.5 w-3.5" /> تلاش دوباره
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { watcher, state, today, blacklist, events, system: sys } = data
  const statusBadge = !watcher.running
    ? { label: 'خاموش', cls: 'bg-red-500/15 text-red-400 ring-red-500/40' }
    : watcher.paused
      ? { label: 'توقف موقت', cls: 'bg-amber-500/15 text-amber-400 ring-amber-500/40' }
      : { label: 'فعال', cls: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/40' }

  return (
    <div className="space-y-4">
      {/* stat cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-zinc-400">وضعیت دستیار</p>
              <p className="mt-1 text-lg font-bold text-zinc-100">واتچر Z</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {faUptime(watcher.uptimeSec)} بالاست
              </p>
            </div>
            <Badge className={`ring-1 ${statusBadge.cls}`}>{statusBadge.label}</Badge>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-zinc-400">کل جواب‌های ارسالی</p>
              <p className="mt-1 text-2xl font-black text-emerald-400">
                {fa(state.replies_total)}
              </p>
            </div>
            <Send className="h-8 w-8 text-emerald-500/40" />
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-zinc-400">امروز (به وقت تهران)</p>
              <p className="mt-1 text-sm text-zinc-200">
                {fa(today.incoming)} پیام اومده
              </p>
              <p className="text-[11px] text-zinc-500">{fa(today.replies)} جواب رفته</p>
            </div>
            <MessageCircle className="h-8 w-8 text-amber-500/40" />
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-zinc-400">دوره فعالیت</p>
              <p className="mt-1 text-lg font-bold text-zinc-100">
                {state.permanent ? 'همیشه فعال' : 'محدود'}
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                استارت‌ها: {fa(state.started_count)}
              </p>
            </div>
            <Clock className="h-8 w-8 text-zinc-500/40" />
          </CardContent>
        </Card>
      </div>

      {/* منابع سرور (CPU / RAM / دیسک) */}
      {sys ? (
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                <Server className="h-4 w-4 text-emerald-400" /> منابع سرور
              </div>
              <div className="flex flex-wrap gap-1.5">
                <Badge className="bg-zinc-800 text-zinc-300">{fa(sys.cpuCores)} هسته CPU</Badge>
                <Badge className={sys.load1 >= sys.cpuCores ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40' : 'bg-zinc-800 text-zinc-300'}>
                  بار: {fa(sys.load1)}
                </Badge>
                <Badge className="bg-zinc-800 text-zinc-300">آپتایم: {fa(sys.uptimeH)} ساعت</Badge>
              </div>
            </div>
            <p className="truncate text-[11px] text-zinc-500" dir="ltr">
              {sys.cpuModel}
            </p>
            <div className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
              {resBar('حافظه (RAM)', sys.memUsedGb, sys.memTotalGb, sys.memPct)}
              {resBar('دیسک', +(sys.disk.totalGb - sys.disk.freeGb).toFixed(1), sys.disk.totalGb, sys.disk.usedPct)}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* actions + meta */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-zinc-200">
              <Package className="h-4 w-4 text-emerald-400" /> بکاپ فوری
            </div>
            <p className="text-xs leading-6 text-zinc-400">
              یه فایل بکاپ کامل (سشن + تنظیمات + کد) همین الان میره تو
              Saved Messages تلگرامت.
            </p>
            <Button
              onClick={requestBackup}
              disabled={backingUp}
              className="w-full bg-emerald-600 font-bold hover:bg-emerald-500"
            >
              {backingUp ? 'در حال ثبت…' : 'بکاپ بگیر و بفرست'}
            </Button>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-zinc-200">
              <Bot className="h-4 w-4 text-amber-400" /> مغز دستیار
            </div>
            <div className="flex flex-wrap gap-1.5">
              {llm ? (
                <>
                  <Badge className="bg-zinc-800 text-zinc-300">{llm.model}</Badge>
                  <Badge className="bg-zinc-800 text-zinc-300">
                    {llm.thinking ? 'حالت تفکر فعال' : 'حالت تفکر خاموش'}
                  </Badge>
                  <Badge className="bg-zinc-800 text-zinc-300">{fa(llm.retries)} تلاش</Badge>
                  <Badge
                    className="max-w-full truncate bg-zinc-800 text-zinc-300"
                    title={llm.footer}
                  >
                    {llm.footer}
                  </Badge>
                </>
              ) : (
                <Badge className="bg-zinc-800 text-zinc-300">پیش‌فرض</Badge>
              )}
            </div>
            <p className="text-xs text-zinc-500">جزئیات کامل توی تب «تنظیمات Z»</p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-zinc-200">
              <Ban className="h-4 w-4 text-red-400" /> بلاک‌لیست ({fa(blacklist.length)})
            </div>
            {blacklist.length === 0 ? (
              <p className="text-xs text-zinc-500">خالی</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {blacklist.map((b) => (
                  <Badge
                    key={b.username}
                    dir="ltr"
                    className="bg-red-500/10 text-red-400 ring-1 ring-red-500/30"
                  >
                    @{b.username}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* recent events */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Activity className="h-4 w-4 text-emerald-400" /> رویدادهای اخیر
          </CardTitle>
          <div data-slot="card-action" className="flex items-center gap-2">
            <span className="hidden text-[10px] text-zinc-500 sm:inline">هر ۳۰ ثانیه رفرش میشه</span>
            <Button
              variant="outline"
              size="sm"
              aria-label="رفرش"
              title="رفرش"
              onClick={() => void manualRefresh()}
              className="h-8 min-h-9 min-w-9 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-80 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            {events.length === 0 ? (
              <p className="p-4 text-center text-xs text-zinc-500">هنوز رویدادی ثبت نشده</p>
            ) : (
              <ul className="space-y-1.5">
                {events.map((ev, i) => (
                  <li
                    key={`${ev.ts}-${i}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-zinc-900"
                  >
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">
                      {tehranTime(ev.ts)}
                    </span>
                    <span
                      className={`shrink-0 font-medium ${
                        ev.event === 'reply_send'
                          ? 'text-emerald-400'
                          : ev.event === 'llm_fail' || ev.event === 'backup_fail'
                            ? 'text-red-400'
                            : 'text-zinc-300'
                      }`}
                    >
                      {EVENT_LABELS[ev.event] || ev.event}
                    </span>
                    {ev.chat_id ? (
                      <span className="shrink-0 text-[10px] text-zinc-600" dir="ltr">
                        #{ev.chat_id}
                      </span>
                    ) : null}
                    {ev.detail ? (
                      <span className="truncate text-zinc-500" dir="auto">
                        {ev.detail}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        <Zap className="h-3 w-3 text-amber-500/70" />
        دستیار به هیچ دستوری خاموش نمیشه؛ توقف موقت فقط از شل سرور ممکنه.
      </p>
    </div>
  )
}
