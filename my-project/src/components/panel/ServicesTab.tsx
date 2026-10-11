'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
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
import {
  CloudUpload,
  Cpu,
  HardDrive,
  Loader2,
  MemoryStick,
  Monitor,
  Pause,
  Play,
  RefreshCw,
  Server,
  Terminal,
  Timer,
  Zap,
} from 'lucide-react'
import { panelFetch, formatUptime, tehranTime } from '@/lib/panel'
import { useToast } from '@/hooks/use-toast'

interface ServicesData {
  ok: boolean
  watcher: {
    running: boolean
    pid: number | null
    uptimeSec: number | null
    paused: boolean
    supervisorAlive: boolean
    mode: string
    repliesTotal: number
  }
  terminal: {
    alive: boolean
    pid: number | null
    portOk: boolean
  }
  backups: {
    alive: boolean
    pid: number | null
    running: boolean
    lastRunAt: string | null
    lastOkAt: string | null
    lastCommit: string | null
    lastError: string | null
    nextRunAt: string | null
  }
  vnc: {
    alive: boolean
    pid: number | null
    webOk: boolean
    desktopUp: boolean
  }
  system: {
    os: string
    kernel: string
    cpus: number
    uptimeSec: number
    panelUptimeSec: number
    load: number[]
    disk: { total: number; used: number; avail: number; pct: number } | null
    mem: { total: number; used: number; pct: number }
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function memBarClass(pct: number): string {
  if (pct >= 90) return '[&>div]:bg-red-500'
  if (pct >= 70) return '[&>div]:bg-amber-400'
  return '[&>div]:bg-emerald-500'
}

export default function ServicesTab() {
  const { toast } = useToast()
  const [data, setData] = useState<ServicesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [confirmRestart, setConfirmRestart] = useState<'watcher' | 'terminal' | 'backups' | 'vnc' | null>(null)
  const mountedRef = useRef(true)
  // ref mirror of actionBusy — the 20s silent-refresh interval must see the
  // CURRENT busy action, not the stale first-render closure (was: always null
  // → silent refreshes kept flashing «خاموش» badges mid-restart)
  const busyRef = useRef<string | null>(null)

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const res = await panelFetch('/api/panel/services')
        const json = (await res.json()) as ServicesData & { error?: string }
        if (!res.ok || !json.ok) {
          if (!silent) toast({ title: 'خطا', description: json.error, variant: 'destructive' })
        } else if (mountedRef.current) {
          setData(json)
        }
      } catch {
        if (!silent) toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    mountedRef.current = true
    void load()
    const t = setInterval(() => {
      if (!busyRef.current) void load(true)
    }, 20_000)
    return () => {
      mountedRef.current = false
      clearInterval(t)
    }
  }, [])

  async function runAction(action: string, title: string) {
    busyRef.current = action
    setActionBusy(action)
    try {
      const res = await panelFetch('/api/panel/services', {
        method: 'POST',
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        toast({ title: `${title} نشد`, description: json.error, variant: 'destructive' })
      } else {
        toast({
          title: `${title} شد ✓`,
          description: json.output ? String(json.output).slice(0, 200) : undefined,
        })
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      busyRef.current = null
      setActionBusy(null)
      setConfirmRestart(null)
      setTimeout(() => void load(true), 1500)
    }
  }

  const w = data?.watcher
  const sys = data?.system

  return (
    <div className="space-y-4">
      {/* ---------------- system ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Server className="h-4 w-4 text-emerald-400" /> سیستم (محیط ابری)
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> رفرش
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {sys ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <Timer className="h-3 w-3" /> آپتایم سرور
                  </p>
                  <p className="mt-1 text-xs font-bold text-zinc-200">
                    {formatUptime(sys.uptimeSec)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <Zap className="h-3 w-3" /> آپتایم پنل
                  </p>
                  <p className="mt-1 text-xs font-bold text-zinc-200">
                    {formatUptime(sys.panelUptimeSec)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                    <Cpu className="h-3 w-3" /> پردازنده
                  </p>
                  <p className="mt-1 text-xs font-bold text-zinc-200" dir="ltr">
                    {sys.cpus} × CPU · load {sys.load?.[0] ?? '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <p className="text-[10px] text-zinc-500">سیستم‌عامل</p>
                  <p className="mt-1 truncate text-xs font-bold text-zinc-200" title={sys.os}>
                    {sys.os}
                  </p>
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <p className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span className="flex items-center gap-1.5">
                      <HardDrive className="h-3.5 w-3.5 text-emerald-400" /> دیسک
                    </span>
                    <span dir="ltr" className="font-mono text-zinc-300">
                      {sys.disk
                        ? `${fmtBytes(sys.disk.used)} / ${fmtBytes(sys.disk.total)} (${sys.disk.pct}%)`
                        : '—'}
                    </span>
                  </p>
                  <Progress
                    value={sys.disk ? sys.disk.pct : 0}
                    className="h-2 bg-zinc-800 [&>div]:bg-emerald-500"
                  />
                </div>
                <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <p className="flex items-center justify-between text-[11px] text-zinc-400">
                    <span className="flex items-center gap-1.5">
                      <MemoryStick className="h-3.5 w-3.5 text-amber-400" /> حافظه
                    </span>
                    <span dir="ltr" className="font-mono text-zinc-300">
                      {fmtBytes(sys.mem.used)} / {fmtBytes(sys.mem.total)} ({sys.mem.pct}%)
                    </span>
                  </p>
                  <Progress
                    value={sys.mem.pct}
                    className={`h-2 bg-zinc-800 ${memBarClass(sys.mem.pct)}`}
                  />
                </div>
              </div>
              <p className="text-[11px] leading-5 text-zinc-500">
                این آمار مالِ محیط ابریِ دستیاره (کانتینر مدیریت‌شده — بدون روت)؛ خروجی
                رم/دیسک ممکنه سطح هاست رو نشون بده.
              </p>
            </>
          ) : loading ? (
            <div className="flex h-24 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
            </div>
          ) : (
            <p className="text-xs text-zinc-500">اطلاعاتی دریافت نشد.</p>
          )}
        </CardContent>
      </Card>

      {/* ---------------- watcher ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Zap className="h-4 w-4 text-amber-400" /> دستیار تلگرام (واتچر)
          </CardTitle>
          {w ? (
            w.paused ? (
              <Badge className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40">مکث</Badge>
            ) : w.running ? (
              <Badge className="bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">
                روشن
              </Badge>
            ) : (
              <Badge className="bg-red-500/15 text-red-300 ring-1 ring-red-500/40">خاموش</Badge>
            )
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          {w ? (
            <>
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <p className="text-[10px] text-zinc-500">PID</p>
                  <p className="mt-0.5 font-mono text-xs font-bold text-zinc-200" dir="ltr">
                    {w.pid ?? '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <p className="text-[10px] text-zinc-500">آپتایم</p>
                  <p className="mt-0.5 text-xs font-bold text-zinc-200">
                    {formatUptime(w.uptimeSec)}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <p className="text-[10px] text-zinc-500">جواب‌های کل</p>
                  <p className="mt-0.5 font-mono text-xs font-bold text-zinc-200" dir="ltr">
                    {w.repliesTotal}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void runAction('watcher-pause', 'مکث')}
                  disabled={!w.running || w.paused || actionBusy !== null}
                  className="h-8 border-amber-800/60 bg-amber-950/30 text-amber-300 hover:bg-amber-950/50"
                >
                  {actionBusy === 'watcher-pause' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Pause className="h-3.5 w-3.5" />
                  )}
                  مکث موقت
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void runAction('watcher-resume', 'ادامه')}
                  disabled={!w.paused || actionBusy !== null}
                  className="h-8 border-emerald-800/60 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-950/50"
                >
                  {actionBusy === 'watcher-resume' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="h-3.5 w-3.5" />
                  )}
                  ادامه
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmRestart('watcher')}
                  disabled={actionBusy !== null}
                  className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                >
                  {actionBusy === 'watcher-restart' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  ری‌استارت
                </Button>
              </div>
              <p className="text-[11px] leading-5 text-zinc-500">
                «مکث» امنه و پیام‌ها بعد از «ادامه» جبران می‌شن. ری‌استارت فقط وقتی لازمه
                که وضعیت خراب باشه (چند ثانیه دستیار آفلاین میشه).
              </p>
            </>
          ) : (
            <p className="text-xs text-zinc-500">وضعیت دریافت نشد.</p>
          )}
        </CardContent>
      </Card>

      {/* ---------------- terminal service ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Terminal className="h-4 w-4 text-emerald-400" /> سرویس ترمینال
          </CardTitle>
          {data?.terminal ? (
            data.terminal.alive ? (
              data.terminal.portOk ? (
                <Badge className="bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">
                  فعال
                </Badge>
              ) : (
                <Badge className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40">
                  نیمه‌فعال
                </Badge>
              )
            ) : (
              <Badge className="bg-red-500/15 text-red-300 ring-1 ring-red-500/40"> از‌کار‌افتاده</Badge>
            )
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-zinc-500" dir="ltr">
              port :3001 · pid {data?.terminal.pid ?? '—'}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmRestart('terminal')}
              disabled={actionBusy !== null}
              className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
            >
              {actionBusy === 'terminal-restart' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              ری‌استارت
            </Button>
          </div>
          <p className="text-[11px] leading-5 text-zinc-500">
            اگه ترمینال تبِ «ترمینال» وصل نمیشه یا به‌هم ریخته، یه ری‌استارت بزن — بعدش
            از اون تب دوباره «وصل شو».
          </p>
        </CardContent>
      </Card>

      {/* ---------------- hourly GitHub backup service ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <CloudUpload className="h-4 w-4 text-emerald-400" /> بکاپ خودکار گیت‌هاب
          </CardTitle>
          {data?.backups ? (
            data.backups.alive ? (
              <Badge className="bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">فعال</Badge>
            ) : (
              <Badge className="bg-red-500/15 text-red-300 ring-1 ring-red-500/40">از‌کار‌افتاده</Badge>
            )
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          {data?.backups ? (
            <>
              <div className="grid grid-cols-2 gap-3 text-center sm:grid-cols-3">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <p className="text-[10px] text-zinc-500">آخرین بکاپ موفق</p>
                  <p className="mt-0.5 text-xs font-bold text-zinc-200">
                    {data.backups.lastOkAt ? tehranTime(data.backups.lastOkAt) : '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <p className="text-[10px] text-zinc-500">اجرای بعدی</p>
                  <p className="mt-0.5 text-xs font-bold text-zinc-200">
                    {data.backups.nextRunAt ? tehranTime(data.backups.nextRunAt) : '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <p className="text-[10px] text-zinc-500">کامیت آخر</p>
                  <p className="mt-0.5 font-mono text-xs font-bold text-zinc-200" dir="ltr">
                    {data.backups.lastCommit ? data.backups.lastCommit.slice(0, 7) : '—'}
                  </p>
                </div>
              </div>
              {data.backups.lastError ? (
                <p className="rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2 text-[11px] leading-5 text-red-300">
                  خطای آخرین اجرا: {data.backups.lastError}
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void runAction('backup-now', 'شروع بکاپ')}
                  disabled={actionBusy !== null || data.backups.running}
                  className="h-8 border-emerald-800/60 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-950/50"
                >
                  {actionBusy === 'backup-now' || data.backups.running ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CloudUpload className="h-3.5 w-3.5" />
                  )}
                  همین حالا بکاپ بگیر
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmRestart('backups')}
                  disabled={actionBusy !== null}
                  className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                >
                  {actionBusy === 'backups-restart' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  ری‌استارت
                </Button>
              </div>
              <p className="text-[11px] leading-5 text-zinc-500">
                هر ۳۰ دقیقه، کل سرور (پروژه + شل‌اسکریپت‌ها + واتچر + فاکتورها + اسکرپر) با تست بیلد کامل
                روی گیت‌هاب خصوصی ذخیره می‌شه — تاریخچهٔ کامل در BACKUP-LOG.md ریپو.
              </p>
            </>
          ) : (
            <p className="text-xs text-zinc-500">وضعیت دریافت نشد.</p>
          )}
        </CardContent>
      </Card>

      {/* ---------------- VNC desktop service ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Monitor className="h-4 w-4 text-emerald-400" /> دسکتاپ گرافیکی (noVNC)
          </CardTitle>
          {data?.vnc ? (
            data.vnc.alive && data.vnc.desktopUp ? (
              <Badge className="bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">فعال</Badge>
            ) : data.vnc.alive || data.vnc.desktopUp ? (
              <Badge className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40">نیمه‌فعال</Badge>
            ) : (
              <Badge className="bg-red-500/15 text-red-300 ring-1 ring-red-500/40">قطع</Badge>
            )
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] text-zinc-500" dir="ltr">
              port :6080 · pid {data?.vnc.pid ?? '—'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => window.open('/?XTransformPort=6080', '_blank', 'noopener')}
                disabled={actionBusy !== null}
                className="h-8 bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500"
              >
                <Monitor className="h-3.5 w-3.5" />
                باز کردن دسکتاپ
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmRestart('vnc')}
                disabled={actionBusy !== null}
                className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
              >
                {actionBusy === 'vnc-restart' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                ری‌استارت
              </Button>
            </div>
          </div>
          <p className="text-[11px] leading-5 text-zinc-500">
            محیط گرافیکی XFCE سرور مستقیم توی مرورگر — با رمز VNC (فایل .secrets/vnc.env)
            وارد شو.
          </p>
        </CardContent>
      </Card>

      {/* ---------- restart confirm ---------- */}
      <AlertDialog
        open={confirmRestart !== null}
        onOpenChange={(o) => !o && setConfirmRestart(null)}
      >
        <AlertDialogContent dir="rtl" className="border-zinc-800 bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">
              {confirmRestart === 'watcher'
                ? 'واتچر ری‌استارت بشه؟'
                : confirmRestart === 'terminal'
                  ? 'سرویس ترمینال ری‌استارت بشه؟'
                  : confirmRestart === 'backups'
                    ? 'سرویس بکاپ‌گیری ری‌استارت بشه؟'
                    : 'دسکتاپ گرافیکی ری‌استارت بشه؟'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-6">
              {confirmRestart === 'watcher'
                ? 'دستیار چند ثانیه قطع میشه و دوباره بالا میاد (سشن و تنظیمات دست‌نخورده می‌مونه). ادامه بدم؟'
                : confirmRestart === 'terminal'
                  ? 'اگه ترمینال باز داری بسته میشه؛ بعدش از تب ترمینال دوباره وصل شو. ادامه بدم؟'
                  : confirmRestart === 'backups'
                    ? 'زمان‌بندی ۳۰ دقیقه‌ای از نو چیده میشه و اگه آخرین بکاپ قدیمی باشه بلافاصله یک دور اجرا میشه. ادامه بدم؟'
                    : 'دسکتاپ چند ثانیه قطع میشه و دوباره بالا میاد. ادامه بدم؟'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800">
              بی‌خیال
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                if (confirmRestart === 'watcher') void runAction('watcher-restart', 'ری‌استارت')
                else if (confirmRestart === 'terminal') void runAction('terminal-restart', 'ری‌استارت')
                else if (confirmRestart === 'backups') void runAction('backups-restart', 'ری‌استارت')
                else void runAction('vnc-restart', 'ری‌استارت')
              }}
              className="bg-amber-500 text-xs font-bold text-zinc-950 hover:bg-amber-400"
            >
              آره، ری‌استارت کن
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
