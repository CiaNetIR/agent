'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { useToast } from '@/hooks/use-toast'
import { panelFetch } from '@/lib/panel'
import {
  AlertTriangle,
  BellRing,
  Cable,
  Check,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCcw,
  Server,
} from 'lucide-react'

/* ------------------------------------------------------------------ */
/* types — mirror GET /api/connection-info                             */
/* ------------------------------------------------------------------ */

interface ConnModel {
  id: string
  label: string
  thinking: boolean
}

interface ConnDirect {
  baseUrl: string
  apiKey: string
  token: string
  chatId: string
  userId: string
}

interface ConnMonitor {
  alive: boolean
  lastPingAt: number
  lastPingOk: boolean
  lastPingStatus: number | string | null
  lastChangeAt: number
  failCount: number
  startedAt: number
}

interface ConnInfo {
  ok: boolean
  proxyKey: string
  proxyKeyConfigured: boolean
  models: ConnModel[]
  direct: ConnDirect | null
  monitor: ConnMonitor
  generatedAt: number
}

/* ---------- helpers ---------- */

function faNum(n: number): string {
  try {
    return n.toLocaleString('fa-IR')
  } catch {
    return String(n)
  }
}

function fmtMs(ms: number): string {
  if (!ms) return '—'
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      timeZone: 'Asia/Tehran',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(ms))
  } catch {
    return new Date(ms).toLocaleString('fa-IR')
  }
}

/* ---------- copy button with transient «کپی شد» feedback ---------- */

function CopyBtn({ value, ariaLabel }: { value: string; ariaLabel: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard denied — nothing to do */
    }
  }, [value])
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => void onCopy()}
      aria-label={ariaLabel}
      className="h-8 shrink-0 border-zinc-700 bg-zinc-950 text-[11px] text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'کپی شد' : 'کپی'}
    </Button>
  )
}

/* ---------- masked secret row (direct provider creds) ---------- */

function SecretRow({ name, value }: { name: string; value: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
      <code className="shrink-0 font-mono text-[11px] text-amber-300" dir="ltr">
        {name}
      </code>
      <p
        className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-300"
        dir="ltr"
        title={show ? value : undefined}
      >
        {show ? value : '••••••••••••••••••••'}
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={() => setShow((v) => !v)}
        aria-label={show ? `مخفی‌کردن ${name}` : `نمایش ${name}`}
        className="h-7 w-7 shrink-0 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
      >
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </Button>
      <CopyBtn value={value} ariaLabel={`کپی ${name}`} />
    </div>
  )
}

/* ---------- monitor label/value tile ---------- */

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
      <p className="text-[10px] text-zinc-500">{label}</p>
      <p className="mt-0.5 text-[12px] font-bold leading-5 text-zinc-200">{value}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* main tab                                                            */
/* ------------------------------------------------------------------ */

export default function ApiTab() {
  const { toast } = useToast()
  const [info, setInfo] = useState<ConnInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [confirmRotate, setConfirmRotate] = useState(false)
  /* origin is browser-only — read after mount (this tab never SSRs, but stay safe) */
  const [origin, setOrigin] = useState('')

  useEffect(() => {
    setOrigin(window.location.origin)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await panelFetch('/api/connection-info')
      const j = (await res.json().catch(() => ({}))) as Partial<ConnInfo> & {
        ok?: boolean
        error?: string
      }
      if (!res.ok || !j.ok) {
        setInfo(null)
        setError(
          res.status === 401
            ? 'دسترسی نداری — یه بار از پنل خارج شو و دوباره وارد شو.'
            : j.error || `سرور جواب نداد (کد ${res.status})`,
        )
      } else {
        setInfo(j as ConnInfo)
      }
    } catch {
      setInfo(null)
      setError('ارتباط با سرور برقرار نشد.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const baseUrl = `${origin}/api/openai/v1`

  const opencodeJson = useMemo(() => {
    const models: Record<string, { name: string }> = {}
    for (const m of info?.models ?? []) models[m.id] = { name: m.label }
    return JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        provider: {
          starvpn: {
            npm: '@ai-sdk/openai-compatible',
            name: 'StarVPN API',
            options: { baseURL: baseUrl, apiKey: info?.proxyKey ?? '' },
            models,
          },
        },
      },
      null,
      2,
    )
  }, [baseUrl, info])

  const rotate = useCallback(async () => {
    if (rotating) return
    setRotating(true)
    try {
      const res = await panelFetch('/api/connection-info', {
        method: 'POST',
        body: JSON.stringify({ action: 'rotate' }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; proxyKey?: string; error?: string }
      if (!res.ok || !j.ok || !j.proxyKey) {
        toast({
          title: 'ساخت مجدد کلید نشد',
          description: j.error || `سرور جواب نداد (کد ${res.status})`,
          variant: 'destructive',
        })
      } else {
        setInfo((prev) =>
          prev ? { ...prev, proxyKey: j.proxyKey as string, proxyKeyConfigured: true } : prev,
        )
        toast({
          title: 'کلید جدید ساخته شد ✓',
          description: 'کلید قبلی همین الان بی‌اعتبار شد — کانفیگ ابزارت رو با کلید جدید (همین کارت) آپدیت کن.',
        })
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setRotating(false)
      setConfirmRotate(false)
    }
  }, [rotating, toast])

  /* ---------- loading / error ---------- */

  if (loading) {
    return (
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 pt-6">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
          <p className="text-xs text-zinc-400">در حال دریافت اطلاعات اتصال…</p>
        </CardContent>
      </Card>
    )
  }

  if (error || !info) {
    return (
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardContent className="flex min-h-48 flex-col items-center justify-center gap-3 pt-6 text-center">
          <AlertTriangle className="h-6 w-6 text-amber-400" />
          <p className="text-xs text-zinc-300">{error || 'اطلاعات اتصال در دسترس نیست.'}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="h-8 border-zinc-700 bg-zinc-950 text-xs text-zinc-300 hover:bg-zinc-800"
          >
            <RefreshCw className="h-3.5 w-3.5" /> تلاش دوباره
          </Button>
        </CardContent>
      </Card>
    )
  }

  const mon = info.monitor

  /* ---------- ready ---------- */

  return (
    <div className="space-y-4">
      {/* ---------------- card 1: coding tools ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Cable className="h-4 w-4 shrink-0 text-emerald-400" />
            اتصال ابزارهای کدنویسی (OpenCode و هر ابزار OpenAI-سازگار)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* base url */}
          <div className="space-y-1.5">
            <Label htmlFor="api-base-url" className="text-[11px] font-bold text-zinc-400">
              بیس‌یو‌آر‌ال (Base URL)
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="api-base-url"
                readOnly
                dir="ltr"
                value={baseUrl}
                className="h-8 flex-1 border-zinc-700 bg-zinc-950 text-left font-mono text-[11px] text-zinc-200 focus-visible:ring-emerald-500/50"
              />
              <CopyBtn value={baseUrl} ariaLabel="کپی بیس‌یو‌آر‌ال" />
            </div>
          </div>

          {/* proxy key */}
          <div className="space-y-1.5">
            <Label htmlFor="api-key" className="text-[11px] font-bold text-zinc-400">
              کلید API (API Key)
            </Label>
            {info.proxyKeyConfigured && info.proxyKey ? (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Input
                    id="api-key"
                    readOnly
                    dir="ltr"
                    type={showKey ? 'text' : 'password'}
                    value={info.proxyKey}
                    className="h-8 border-zinc-700 bg-zinc-950 pr-9 text-left font-mono text-[11px] text-zinc-200 focus-visible:ring-emerald-500/50"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowKey((v) => !v)}
                    aria-label={showKey ? 'مخفی‌کردن کلید' : 'نمایش کلید'}
                    className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                  >
                    {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <CopyBtn value={info.proxyKey} ariaLabel="کپی کلید API" />
              </div>
            ) : (
              <p className="rounded-lg border border-amber-800/60 bg-amber-950/20 p-2.5 text-[11px] leading-5 text-amber-300">
                کلید پروکسی هنوز ساخته نشده — با دکمهٔ «ساخت مجدد کلید» پایین همین کارت یکی بساز.
              </p>
            )}
            <p className="text-[10px] leading-5 text-zinc-600">
              همین آدرس و همین کلید رو هر ابزار OpenAI-سازگاری (OpenCode و اسکریپت‌ها و ابزارهای خودت) قبول می‌کنه.
            </p>
          </div>

          {/* models */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-zinc-400">مدل‌ها</p>
            <div className="flex flex-wrap gap-2">
              {info.models.map((m) => (
                <Badge
                  key={m.id}
                  variant="outline"
                  className="gap-1.5 border-zinc-700 bg-zinc-950 px-2.5 py-1 text-[10px] text-zinc-300"
                >
                  <code className="font-mono text-emerald-300" dir="ltr">
                    {m.id}
                  </code>
                  <span className="text-zinc-400">{m.label}</span>
                </Badge>
              ))}
            </div>
          </div>

          {/* opencode.json snippet */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-bold text-zinc-400">کانفیگ آمادهٔ opencode.json</p>
              <CopyBtn value={opencodeJson} ariaLabel="کپی کانفیگ opencode" />
            </div>
            <pre
              dir="ltr"
              className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-left font-mono text-[11px] leading-5 text-zinc-300"
            >
              {opencodeJson}
            </pre>
          </div>

          {/* 3-step guide */}
          <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <p className="text-[11px] font-bold text-zinc-300">راه‌اندازی در ۳ قدم</p>
            <ol className="space-y-2 text-[11px] leading-6 text-zinc-400">
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-950/50 text-[10px] font-black text-emerald-300 ring-1 ring-emerald-800/60">
                  ۱
                </span>
                نصب OpenCode روی سیستمت
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-950/50 text-[10px] font-black text-emerald-300 ring-1 ring-emerald-800/60">
                  ۲
                </span>
                <span>
                  ذخیرهٔ همین کانفیگ در{' '}
                  <code className="font-mono text-[10px] text-emerald-300" dir="ltr">
                    ~/.config/opencode/opencode.json
                  </code>{' '}
                  (ویندوز:{' '}
                  <code className="font-mono text-[10px] text-emerald-300" dir="ltr">
                    %USERPROFILE%\.config\opencode\opencode.json
                  </code>
                  )
                </span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-950/50 text-[10px] font-black text-emerald-300 ring-1 ring-emerald-800/60">
                  ۳
                </span>
                اجرای opencode و انتخاب مدل StarVPN API
              </li>
            </ol>
          </div>

          {/* rotate */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-800 pt-3">
            <p className="max-w-md text-[10px] leading-5 text-zinc-600">
              اگه فکر می‌کنی کلید لو رفته یا برای ابزار جدید می‌خوای، یه کلید تازه بساز — کلید قبلی بلافاصله
              بی‌اعتبار می‌شه و باید توی ابزارت عوضش کنی.
            </p>
            <AlertDialog open={confirmRotate} onOpenChange={setConfirmRotate}>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={rotating}
                  className="h-8 border-amber-800/60 bg-amber-950/30 text-[11px] font-bold text-amber-300 hover:bg-amber-950/50"
                >
                  {rotating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3.5 w-3.5" />
                  )}
                  ساخت مجدد کلید
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent dir="rtl" className="border-zinc-800 bg-zinc-950">
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-zinc-100">کلید جدید ساخته بشه؟</AlertDialogTitle>
                  <AlertDialogDescription className="text-zinc-400">
                    کلید فعلی بی‌اعتبار می‌شود و باید در ابزارت عوضش کنی. مطمئنی؟
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter className="flex-row gap-2">
                  <AlertDialogCancel className="border-zinc-700 bg-zinc-900 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100">
                    نه، بی‌خیال
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void rotate()}
                    className="bg-amber-600 text-white hover:bg-amber-500"
                  >
                    آره، بساز
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>

      {/* ---------------- card 2: direct provider ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Server className="h-4 w-4 shrink-0 text-amber-400" />
            اتصال مستقیم provider (فقط از داخل خود سرور)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {info.direct ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="api-direct-url" className="text-[11px] font-bold text-zinc-400">
                  آدرس مستقیم provider
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="api-direct-url"
                    readOnly
                    dir="ltr"
                    value={info.direct.baseUrl}
                    className="h-8 flex-1 border-zinc-700 bg-zinc-950 text-left font-mono text-[11px] text-zinc-200 focus-visible:ring-emerald-500/50"
                  />
                  <CopyBtn value={info.direct.baseUrl} ariaLabel="کپی آدرس مستقیم" />
                </div>
              </div>

              <p className="flex items-start gap-2 rounded-lg border border-red-900/60 bg-red-950/20 p-2.5 text-[11px] leading-5 text-red-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                این آدرس فقط از داخل سرور در دسترس است (شبکهٔ خصوصی provider). برای ابزارهای بیرونی (روی
                لپ‌تاپ/کامپیوتر خودت) از بیس‌یو‌آر‌ال کارت بالا استفاده کن. کلید مستقیم خیلی محرمانه است — جایی
                عمومی ذخیره/ارسالش نکن.
              </p>

              <div className="space-y-2">
                <p className="text-[11px] font-bold text-zinc-400">اعتبارنامه‌های مستقیم</p>
                <SecretRow name="apiKey" value={info.direct.apiKey} />
                <SecretRow name="token" value={info.direct.token} />
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <p className="text-[10px] text-zinc-500">شناسهٔ چت (chatId)</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-300" dir="ltr">
                    {info.direct.chatId || '—'}
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <p className="text-[10px] text-zinc-500">شناسهٔ کاربر (userId)</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-300" dir="ltr">
                    {info.direct.userId || '—'}
                  </p>
                </div>
              </div>
            </>
          ) : (
            <p className="text-xs text-zinc-500">
              اطلاعات اتصال مستقیم provider روی سرور پیدا نشد — اتصال ابزارها از کارت بالا انجام می‌شه.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ---------------- card 3: api monitor ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <BellRing className="h-4 w-4 shrink-0 text-emerald-400" />
            مانیتور API و هشدار تلگرام
          </CardTitle>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold ${
              mon.alive
                ? 'bg-emerald-950/40 text-emerald-300 ring-1 ring-emerald-800/60'
                : 'bg-red-950/40 text-red-300 ring-1 ring-red-900/60'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${mon.alive ? 'animate-pulse bg-emerald-400' : 'bg-red-400'}`}
              aria-hidden
            />
            {mon.alive ? 'فعال و در حال نظارت' : 'خاموش'}
          </span>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <InfoTile
              label="آخرین سلامت‌سنجی"
              value={mon.lastPingAt ? fmtMs(mon.lastPingAt) : 'هنوز انجام نشده'}
            />
            <InfoTile
              label="نتیجهٔ آخرین سلامت‌سنجی"
              value={`${mon.lastPingOk ? 'سالم' : 'ناموفق'}${
                mon.lastPingStatus != null ? ` (کد ${mon.lastPingStatus})` : ''
              }`}
            />
            <InfoTile label="خطاهای متوالی" value={faNum(mon.failCount)} />
            <InfoTile
              label="آخرین تغییر شناسایی‌شده"
              value={mon.lastChangeAt ? fmtMs(mon.lastChangeAt) : '—'}
            />
          </div>
          <p className="text-[10px] leading-5 text-zinc-600">
            هر تغییر در آدرس/کلید/نسخهٔ provider و هر قطعی، به‌صورت خودکار به سیو مسیج تلگرامت ارسال می‌شود.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
