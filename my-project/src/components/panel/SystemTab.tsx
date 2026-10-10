'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
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
  Bot,
  Boxes,
  Database,
  FileText,
  FolderOpen,
  Loader2,
  Play,
  Power,
  PowerOff,
  Recycle,
  RefreshCw,
  Server,
  Terminal,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { panelFetch, type SystemInfo } from '@/lib/panel'
import { useToast } from '@/hooks/use-toast'

/* ------------------------------------------------------------------ types */

type HardAction = 'factory-reset' | 'delete-project' | 'power-off-server'
type SysAction = 'services-stop' | 'services-start' | HardAction

interface ActionResponse {
  ok: boolean
  log?: string[]
  note?: string
  error?: string
}

/** Destructive actions and the exact Persian word the owner must type. */
const CONFIRM_WORDS: Record<HardAction, string> = {
  'factory-reset': 'ریست',
  'delete-project': 'حذف',
  'power-off-server': 'خاموش',
}

const ACTION_LABELS: Record<SysAction, string> = {
  'services-stop': 'خاموشی سرویس‌ها',
  'services-start': 'روشن کردن سرویس‌ها',
  'factory-reset': 'ریست کامل',
  'delete-project': 'حذف پروژه',
  'power-off-server': 'خاموشی وب‌سرور',
}

const DIALOG_TITLES: Record<HardAction, string> = {
  'factory-reset': 'ریست کامل پروژه انجام بشه؟',
  'delete-project': 'کل پروژه حذف بشه؟',
  'power-off-server': 'خاموشی کامل وب‌سرور انجام بشه؟',
}

const DIALOG_BUTTONS: Record<HardAction, string> = {
  'factory-reset': 'آره، ریست کامل کن',
  'delete-project': 'آره، حذف کن',
  'power-off-server': 'آره، خاموشش کن',
}

const WARN_FALLBACK = 'هشدار بارگذاری نشده؛ برای دیدن جزئیات همین تب رو رفرش کن.'

function fmtBytes(n: number | undefined): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

const SCROLLBAR =
  '[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent'

/* -------------------------------------------------------------- component */

export default function SystemTab() {
  const { toast } = useToast()
  const [data, setData] = useState<SystemInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<SysAction | null>(null)
  const [stopOpen, setStopOpen] = useState(false)
  const [confirmAction, setConfirmAction] = useState<HardAction | null>(null)
  const [typed, setTyped] = useState('')
  const [logLines, setLogLines] = useState<string[] | null>(null)
  const [attention, setAttention] = useState<{
    title: string
    note: string
    hint?: ReactNode
  } | null>(null)

  const mountedRef = useRef(true)
  const busyRef = useRef(false)
  const attentionRef = useRef(false)
  const attentionBtnRef = useRef<HTMLButtonElement | null>(null)

  /* ------------------------------------------------------------- loading */

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const res = await panelFetch('/api/panel/system')
        const json = (await res.json()) as SystemInfo & { error?: string }
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
      if (!busyRef.current && !attentionRef.current) void load(true)
    }, 20_000)
    return () => {
      mountedRef.current = false
      clearInterval(t)
    }
  }, [])

  // full-screen attention overlay must grab focus for keyboard/screen-reader users
  useEffect(() => {
    if (attention) attentionBtnRef.current?.focus()
  }, [attention])

  /* ------------------------------------------------------------- actions */

  async function runAction(action: SysAction, confirm?: string) {
    setBusy(action)
    busyRef.current = true
    try {
      const res = await panelFetch('/api/panel/system', {
        method: 'POST',
        body: JSON.stringify({ action, confirm }),
      })
      const json = (await res.json()) as ActionResponse
      if (!res.ok || !json.ok) {
        toast({
          title: `${ACTION_LABELS[action]} نشد`,
          description: json.error,
          variant: 'destructive',
        })
      } else if (action === 'services-stop' || action === 'services-start') {
        setLogLines(
          Array.isArray(json.log)
            ? json.log.filter((l) => typeof l === 'string' && l.trim() !== '')
            : []
        )
        toast({
          title: action === 'services-stop' ? 'سرویس‌ها خاموش شدن' : 'سرویس‌ها روشن شدن',
        })
      } else if (action === 'factory-reset') {
        toast({
          title: 'ریست کامل انجام شد',
          description: 'دیتای پنل پاک شد؛ رمز و کدها سالم موندن',
        })
      } else if (action === 'delete-project') {
        attentionRef.current = true
        setAttention({
          title: 'حذف پروژه شروع شد',
          note:
            json.note ||
            'پروژه در حال انتقال به سبد بازیافت است؛ پنل چند لحظه دیگر از دسترس خارج میشه.',
          hint: (
            <>
              راه برگشت: از ایجنت Z بخواه پروژه رو از سبد بازیافت{' '}
              <span dir="ltr" className="font-mono text-amber-200">
                ~/.trash
              </span>{' '}
              برگردونه.
            </>
          ),
        })
      } else {
        attentionRef.current = true
        setAttention({
          title: 'خاموشی وب‌سرور شروع شد',
          note:
            json.note ||
            'وب‌سرور در حال خاموشی کامل است؛ پنل از دسترس خارج میشه و خودکار برنمی‌گرده.',
          hint: 'برای روشن کردن دوباره فقط ایجنت Z یا خود پلتفرم می‌تونه وب‌سرور رو بالا بیاره.',
        })
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setBusy(null)
      busyRef.current = false
      setStopOpen(false)
      setConfirmAction(null)
      setTyped('')
      if (action !== 'delete-project' && action !== 'power-off-server') {
        setTimeout(() => void load(true), 1500)
      }
    }
  }

  function openHard(action: HardAction) {
    setTyped('')
    setConfirmAction(action)
  }

  function closeAttention() {
    attentionRef.current = false
    setAttention(null)
  }

  /* --------------------------------------------------------------- render */

  const info = data?.info
  const warn = (k: string) => data?.warnings?.[k] || WARN_FALLBACK
  const servicesUp = info
    ? info.watcherRunning || info.terminalAlive || info.instanceCount > 0
    : null
  const confirmWord = confirmAction ? CONFIRM_WORDS[confirmAction] : ''

  return (
    <div className="space-y-4">
      {/* ---------------- 1. وضعیت سیستم ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Server className="h-4 w-4 text-emerald-400" /> وضعیت سیستم
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={busy !== null}
            className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> رفرش
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {info ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <Bot className="h-3 w-3" /> دستیار اصلی
                </p>
                <div className="mt-1.5">
                  {info.watcherRunning ? (
                    <Badge className="bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">
                      فعال
                    </Badge>
                  ) : (
                    <Badge className="bg-red-500/15 text-red-300 ring-1 ring-red-500/40">
                      خاموش
                    </Badge>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <Terminal className="h-3 w-3" /> سرویس ترمینال
                </p>
                <div className="mt-1.5">
                  {info.terminalAlive ? (
                    <Badge className="bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">
                      فعال
                    </Badge>
                  ) : (
                    <Badge className="bg-red-500/15 text-red-300 ring-1 ring-red-500/40">
                      خاموش
                    </Badge>
                  )}
                </div>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <Database className="h-3 w-3" /> اکانت‌های افزوده
                </p>
                <p className="mt-1 font-mono text-xs font-bold text-zinc-200" dir="ltr">
                  {info.dbAccounts}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <Boxes className="h-3 w-3" /> اینستنس‌های فعال
                </p>
                <p className="mt-1 font-mono text-xs font-bold text-zinc-200" dir="ltr">
                  {info.instanceCount}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <Database className="h-3 w-3" /> حجم دیتابیس
                </p>
                <p className="mt-1 font-mono text-xs font-bold text-zinc-200" dir="ltr">
                  {fmtBytes(info.sizes?.db)}
                </p>
              </div>
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <FileText className="h-3 w-3" /> حجم لاگ پنل
                </p>
                <p className="mt-1 font-mono text-xs font-bold text-zinc-200" dir="ltr">
                  {fmtBytes(info.sizes?.audit)}
                </p>
              </div>
              <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 sm:col-span-4">
                <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <FolderOpen className="h-3 w-3" /> مسیر پروژه
                </p>
                <p dir="ltr" className="break-all font-mono text-xs text-zinc-300">
                  {info.projectDir}
                </p>
              </div>
              <div className="col-span-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 sm:col-span-4">
                <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                  <Recycle className="h-3 w-3" /> سبد بازیافت
                </p>
                <p dir="ltr" className="break-all font-mono text-xs text-zinc-300">
                  {info.trashDir}
                </p>
              </div>
            </div>
          ) : loading ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-14 rounded-lg bg-zinc-800/60" />
                ))}
              </div>
              <Skeleton className="h-11 w-full rounded-lg bg-zinc-800/60" />
              <Skeleton className="h-11 w-full rounded-lg bg-zinc-800/60" />
            </div>
          ) : (
            <p className="text-xs text-zinc-500">اطلاعاتی دریافت نشد.</p>
          )}
        </CardContent>
      </Card>

      {/* ---------------- 2. خاموش / روشن سرویس‌ها (soft power) ---------------- */}
      <Card className="border-teal-900/50 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Power className="h-4 w-4 text-teal-400" /> خاموش / روشن سرویس‌ها
          </CardTitle>
          {servicesUp !== null ? (
            servicesUp ? (
              <Badge className="bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">
                سرویس‌ها روشن
              </Badge>
            ) : (
              <Badge className="bg-zinc-500/15 text-zinc-300 ring-1 ring-zinc-500/40">
                سرویس‌ها خاموش
              </Badge>
            )
          ) : null}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setStopOpen(true)}
              disabled={busy !== null}
              className="h-8 border-amber-800/60 bg-amber-950/30 text-amber-300 hover:bg-amber-950/50"
            >
              {busy === 'services-stop' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Power className="h-3.5 w-3.5" />
              )}
              خاموش کردن سرویس‌ها
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runAction('services-start')}
              disabled={busy !== null}
              className="h-8 border-emerald-800/60 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-950/50"
            >
              {busy === 'services-start' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              روشن کردن سرویس‌ها
            </Button>
          </div>
          {logLines && (
            <div className="rounded-lg border border-zinc-800 bg-black/60 p-2.5">
              <p className="mb-1 text-[10px] text-zinc-500">خروجی آخرین عملیات:</p>
              <pre
                dir="ltr"
                className={`max-h-32 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-5 text-emerald-300 ${SCROLLBAR}`}
              >
                {logLines.join('\n')}
              </pre>
            </div>
          )}
          <p className="text-[10px] leading-5 text-zinc-600">
            پنل وب خودش هیچ‌وقت با این دکمه‌ها نمی‌خاموشه — این فقط سرویس‌های پس‌زمینه است.
          </p>
        </CardContent>
      </Card>

      {/* ---------------- 3. ریست هارد پروژه ---------------- */}
      <Card className="border-amber-900/50 bg-amber-950/20">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <TriangleAlert className="h-4 w-4 text-amber-400" /> ریست هارد پروژه
          </CardTitle>
          <Badge className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40">
            تایید تایپی: ریست
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[11px] leading-6 text-amber-200/70">{warn('factory-reset')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => openHard('factory-reset')}
            disabled={busy !== null}
            className="h-8 border-amber-700/70 bg-amber-950/40 text-amber-300 hover:bg-amber-900/50"
          >
            {busy === 'factory-reset' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <TriangleAlert className="h-3.5 w-3.5" />
            )}
            ریست کامل
          </Button>
        </CardContent>
      </Card>

      {/* ---------------- 4. حذف کامل پروژه ---------------- */}
      <Card className="border-red-900/50 bg-red-950/20">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Trash2 className="h-4 w-4 text-red-400" /> حذف کامل پروژه
          </CardTitle>
          <Badge className="bg-red-500/15 text-red-300 ring-1 ring-red-500/40">
            تایید تایپی: حذف
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[11px] leading-6 text-red-200/70">{warn('delete-project')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => openHard('delete-project')}
            disabled={busy !== null}
            className="h-8 border-red-800/70 bg-red-950/40 text-red-300 hover:bg-red-900/50"
          >
            {busy === 'delete-project' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
            حذف پروژه
          </Button>
        </CardContent>
      </Card>

      {/* ---------------- 5. خاموشی کامل وب‌سرور ---------------- */}
      <Card className="border-red-900/50 bg-red-950/20">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <PowerOff className="h-4 w-4 text-red-400" /> خاموشی کامل وب‌سرور
          </CardTitle>
          <Badge className="bg-red-500/15 text-red-300 ring-1 ring-red-500/40">
            تایید تایپی: خاموش
          </Badge>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[11px] leading-6 text-red-200/70">{warn('power-off-server')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => openHard('power-off-server')}
            disabled={busy !== null}
            className="h-8 border-red-800/70 bg-red-950/40 text-red-300 hover:bg-red-900/50"
          >
            {busy === 'power-off-server' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <PowerOff className="h-3.5 w-3.5" />
            )}
            خاموشی وب‌سرور
          </Button>
        </CardContent>
      </Card>

      {/* ---------------- footer note ---------------- */}
      <p className="pt-1 text-center text-[10px] leading-6 text-zinc-600">
        همه عملیات‌های خطرناک با تایید تایپی اجرا می‌شن و در لاگ سیستمی{' '}
        <span dir="ltr" className="font-mono text-zinc-500">
          /home/z/system-actions.log
        </span>{' '}
        ثبت می‌شن که حتی بعد از حذف پروژه هم می‌مونه.
      </p>

      {/* ---------------- services-stop confirm (بدون تایپ) ---------------- */}
      <AlertDialog
        open={stopOpen}
        onOpenChange={(o) => {
          if (!o) setStopOpen(false)
        }}
      >
        <AlertDialogContent dir="rtl" className="border-zinc-800 bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">سرویس‌ها خاموش بشن؟</AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-6">
              دستیار اصلی، همه اکانت‌ها و ترمینال قطع می‌شن؛ خود پنل روشن می‌مونه و از
              همین دکمه برمی‌گردونی.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={busy !== null}
              className="border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              بی‌خیال
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={busy !== null}
              onClick={(e) => {
                e.preventDefault()
                void runAction('services-stop')
              }}
              className="bg-amber-500 text-xs font-bold text-zinc-950 hover:bg-amber-400"
            >
              {busy === 'services-stop' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              آره، خاموش کن
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------------- typed confirm for destructive ops ---------------- */}
      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(o) => {
          if (!o) {
            setConfirmAction(null)
            setTyped('')
          }
        }}
      >
        <AlertDialogContent dir="rtl" className="border-zinc-800 bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">
              {confirmAction ? DIALOG_TITLES[confirmAction] : ''}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-6">
              {confirmAction ? warn(confirmAction) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Input
              dir="rtl"
              value={typed}
              disabled={busy !== null}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === 'Enter' &&
                  confirmAction &&
                  typed.trim() === CONFIRM_WORDS[confirmAction] &&
                  busy === null
                ) {
                  e.preventDefault()
                  void runAction(confirmAction, CONFIRM_WORDS[confirmAction])
                }
              }}
              placeholder={`بنویس: ${confirmWord}`}
              className="h-9 border-zinc-700 bg-zinc-900 text-sm text-zinc-100 placeholder:text-zinc-600"
            />
            <p className="text-[10px] leading-5 text-zinc-500">
              برای فعال شدن دکمه بنویس:{' '}
              <span className="font-bold text-amber-300">{confirmWord}</span>
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={busy !== null}
              className="border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              بی‌خیال
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={!confirmAction || typed.trim() !== confirmWord || busy !== null}
              onClick={(e) => {
                e.preventDefault()
                if (confirmAction) void runAction(confirmAction, CONFIRM_WORDS[confirmAction])
              }}
              className={
                confirmAction === 'factory-reset'
                  ? 'bg-amber-500 text-xs font-bold text-zinc-950 hover:bg-amber-400'
                  : 'bg-red-600 text-xs font-bold text-white hover:bg-red-500'
              }
            >
              {busy !== null && confirmAction !== null && busy === confirmAction ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : null}
              {confirmAction ? DIALOG_BUTTONS[confirmAction] : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---------------- full-screen attention (حذف / خاموشی سرور) ---------------- */}
      {attention && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
        >
          <div
            dir="rtl"
            className="w-full max-w-md space-y-3 rounded-xl border-2 border-red-500/60 bg-zinc-950 p-5 shadow-2xl shadow-red-950/60"
          >
            <div className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 animate-pulse text-red-400" />
              <p className="text-sm font-bold text-red-300">{attention.title}</p>
            </div>
            <p className="text-xs leading-6 text-zinc-300">{attention.note}</p>
            {attention.hint ? (
              <p className="text-xs leading-6 text-amber-300">{attention.hint}</p>
            ) : null}
            <Button
              ref={attentionBtnRef}
              variant="outline"
              size="sm"
              onClick={closeAttention}
              className="h-8 border-zinc-700 bg-zinc-900 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              باشه، فهمیدم
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
