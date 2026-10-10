'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { useToast } from '@/hooks/use-toast'
import {
  CheckCircle2,
  ChevronDown,
  HelpCircle,
  Loader2,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Square,
  Trash2,
  Users,
} from 'lucide-react'
import {
  panelFetch,
  tehranTime,
  EVENT_LABELS,
  type TgAccountRow,
} from '@/lib/panel'

/** عدد با ارقام فارسی — برای شمارنده‌های قابل‌مشاهده کاربر */
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

/* ------------------------------------------------------------------ */
/* add / edit dialog (remounts fresh per open via key on parent side) */
/* ------------------------------------------------------------------ */

function AccountDialog({
  account,
  onOpenChange,
  onDone,
}: {
  account: TgAccountRow | null // null = create mode
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const isEdit = account !== null
  const [label, setLabel] = useState(account?.label ?? '')
  const [topic, setTopic] = useState(account?.topic ?? '')
  const [phone, setPhone] = useState(account?.phone ?? '')
  const [session, setSession] = useState('')
  const [persona, setPersona] = useState(account?.persona ?? '')
  const [footer, setFooter] = useState(account?.footer ?? '')
  const [thinking, setThinking] = useState(account?.thinking ?? true)
  const [guideOpen, setGuideOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!label.trim()) {
      toast({ title: 'عنوان اکانت لازم است', variant: 'destructive' })
      return
    }
    if (!isEdit && !topic.trim()) {
      toast({ title: 'موضوع/حوزه لازم است', variant: 'destructive' })
      return
    }
    if (!isEdit && session.trim().length < 40) {
      toast({
        title: 'سشن‌استرینگ معتبر نیست',
        description: 'رشته‌ای که Telethon (StringSession) می‌دهد اینجا بذار.',
        variant: 'destructive',
      })
      return
    }
    setSaving(true)
    try {
      const body = isEdit
        ? {
            op: 'update',
            id: account.id,
            label: label.trim(),
            topic: topic.trim(),
            phone: phone.trim(),
            session: session.trim(),
            persona,
            footer,
            thinking,
            enabled: account.enabled,
          }
        : {
            op: 'create',
            label: label.trim(),
            topic: topic.trim(),
            phone: phone.trim(),
            session: session.trim(),
            persona,
            footer,
            thinking,
          }
      const res = await panelFetch('/api/panel/accounts', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
      }
      if (!res.ok || !json.ok) {
        toast({
          title: isEdit ? 'ذخیره نشد' : 'اکانت اضافه نشد',
          description: json.error,
          variant: 'destructive',
        })
      } else {
        toast({
          title: isEdit ? 'ذخیره شد ✓' : 'اکانت اضافه شد ✓',
          description: isEdit
            ? 'تغییرات روی اکانت اعمال شد.'
            : 'برای روشن شدن، دکمه «روشن» روی کارتش رو بزن.',
        })
        onDone()
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        dir="rtl"
        className="max-h-[88vh] overflow-y-auto border-zinc-800 bg-zinc-950 sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="text-sm text-zinc-100">
            {isEdit ? `ویرایش اکانت — ${account.label}` : 'افزودن اکانت جدید'}
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-5">
            {isEdit
              ? 'سشن رو خالی بذاری، همون سشن قبلی دست‌نخورده می‌مونه.'
              : 'هر اکانت یه دستیار ایزوله با سشن، موضوع و شخصیت خودشه.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="acc-label" className="text-xs text-zinc-300">
              عنوان اکانت *
            </Label>
            <Input
              id="acc-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="مثلاً فروشگاه دوم"
              maxLength={40}
              className="h-9 border-zinc-800 bg-zinc-900 text-sm text-zinc-100 placeholder:text-zinc-600"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acc-topic" className="text-xs text-zinc-300">
              موضوع/حوزه *
            </Label>
            <Input
              id="acc-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="مثلاً پشتیبانی نرم‌افزار"
              maxLength={80}
              className="h-9 border-zinc-800 bg-zinc-900 text-sm text-zinc-100 placeholder:text-zinc-600"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acc-phone" className="text-xs text-zinc-300">
              شماره تلفن (اختیاری)
            </Label>
            <Input
              id="acc-phone"
              dir="ltr"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+98912xxxxxxx"
              className="h-9 border-zinc-800 bg-zinc-900 font-mono text-sm text-zinc-100 placeholder:text-zinc-600"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acc-session" className="text-xs text-zinc-300">
              سشن‌استرینگ تلگرام {isEdit ? '' : '*'}
            </Label>
            <Textarea
              id="acc-session"
              dir="ltr"
              value={session}
              onChange={(e) => setSession(e.target.value)}
              placeholder={
                isEdit
                  ? 'خالی = بدون تغییر سشن'
                  : 'رشته‌ی بلند StringSession تلگرام اینجا پیست کن'
              }
              rows={3}
              className="min-h-16 border-zinc-800 bg-zinc-900 font-mono text-xs text-zinc-100 placeholder:text-zinc-600"
            />
            <Collapsible open={guideOpen} onOpenChange={setGuideOpen}>
              <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-amber-400/90 transition-colors hover:text-amber-300">
                <HelpCircle className="h-3.5 w-3.5" />
                سشن‌استرینگ از کجا بیارم؟
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${guideOpen ? 'rotate-180' : ''}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
                <ul className="space-y-1.5 text-[11px] leading-5 text-zinc-400">
                  <li>— سشنِ هر اکانت جدا از بقیه است؛ هر سشن فقط یه کلاینت مجاز داره.</li>
                  <li>
                    — با api_id و api_hash همون tg.env یه ابزار سشن‌ساز Telethon
                    (StringSession) بساز یا از ایجنت پایتون همین پنل بخواه برات بسازه.
                  </li>
                  <li>— خروجی یه رشته‌ی بلند base64-مانند است؛ کلش رو مستقیم همین‌جا پیست کن.</li>
                  <li>
                    — سشن اکانت اصلی فروشگاه رو اینجا نذار — قانون تک‌کلاینت می‌شکنه و یکی از
                    دوتا اکانت آفلاین میشه.
                  </li>
                </ul>
              </CollapsibleContent>
            </Collapsible>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acc-persona" className="text-xs text-zinc-300">
              شخصیت اختصاصی (SYSTEM_PROMPT)
            </Label>
            <Textarea
              id="acc-persona"
              dir="rtl"
              value={persona}
              onChange={(e) => setPersona(e.target.value)}
              placeholder="خالی = شخصیت پیش‌فرض VPN | STAR"
              rows={3}
              className="min-h-16 border-zinc-800 bg-zinc-900 text-xs leading-6 text-zinc-100 placeholder:text-zinc-600"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="acc-footer" className="text-xs text-zinc-300">
              فوتر اختصاصی
            </Label>
            <Input
              id="acc-footer"
              dir="rtl"
              value={footer}
              onChange={(e) => setFooter(e.target.value)}
              placeholder="خالی = فوتر پیش‌فرض"
              maxLength={300}
              className="h-9 border-zinc-800 bg-zinc-900 text-sm text-zinc-100 placeholder:text-zinc-600"
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <div>
              <p className="text-xs font-bold text-zinc-200">حالت تفکر</p>
              <p className="mt-0.5 text-[10px] text-zinc-500">جواب‌های دقیق‌تر، کمی کندتر</p>
            </div>
            <Switch
              checked={thinking}
              onCheckedChange={setThinking}
              className="h-6 w-11 data-[state=checked]:bg-emerald-600"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
          >
            بی‌خیال
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={saving}
            className="bg-emerald-600 text-xs font-bold text-zinc-950 hover:bg-emerald-500"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isEdit ? (
              <Pencil className="h-3.5 w-3.5" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            {isEdit ? 'ذخیره' : 'اضافه کن'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* «اتصال ساده» wizard — phone → code → (2FA password) → done          */
/* ------------------------------------------------------------------ */

interface WizardAccount {
  id: string
  label: string
  topic?: string
  phone: string
  name: string
  username: string
}

const WIZARD_STEPS = ['شماره تلفن', 'کد تایید', 'رمز دو مرحله‌ای'] as const

function SimpleLoginWizard({
  onOpenChange,
  onDone,
}: {
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'send' | 'complete' | null>(null)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState('')
  const [done, setDone] = useState<WizardAccount | null>(null)
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  })

  /* a previous send-code still alive? jump straight to the code step */
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await panelFetch('/api/panel/tg-login', {
          method: 'POST',
          body: JSON.stringify({ op: 'status' }),
        })
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          pending?: boolean
          phone?: string
        }
        if (alive && res.ok && json.ok && json.pending && json.phone) {
          setPhone(json.phone)
          setStep(2)
        }
      } catch {
        /* net hiccup — start from step 1 */
      } finally {
        if (alive) setChecking(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  /* success → auto-close (~1.8s) + list refresh happens in parent */
  useEffect(() => {
    if (!done) return
    const t = setTimeout(() => onDoneRef.current(), 1800)
    return () => clearTimeout(t)
  }, [done])

  function cancelPending() {
    void panelFetch('/api/panel/tg-login', {
      method: 'POST',
      body: JSON.stringify({ op: 'cancel' }),
    }).catch(() => {})
  }

  function close(cancel: boolean) {
    if (done) {
      onDoneRef.current()
      return
    }
    /* a step is submitting — keep the dialog open (mirrors AccountDialog's saving guard) */
    if (busy !== null) return
    if (cancel) cancelPending()
    onOpenChange(false)
  }

  async function post(body: Record<string, string>) {
    const res = await panelFetch('/api/panel/tg-login', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    return (await res.json().catch(() => ({}))) as {
      ok?: boolean
      status?: string
      error?: string
      account?: WizardAccount
    }
  }

  async function sendCode() {
    const p = phone.trim().replace(/[\s()-]/g, '')
    if (!/^\+?\d{7,15}$/.test(p)) {
      setError('شماره معتبر نیست — مثل +989123456789 واردش کن')
      return
    }
    setError('')
    setBusy('send')
    try {
      const json = await post({ op: 'send-code', phone: p })
      if (json.ok) {
        setPhone(p)
        setCode('')
        setStep(2)
      } else {
        setError(json.error || 'ارسال کد نشد — یه بار دیگه امتحان کن')
      }
    } catch {
      setError('ارتباط برقرار نشد')
    } finally {
      setBusy(null)
    }
  }

  async function complete(withPassword: boolean) {
    const c = code.trim()
    if (!/^\d{4,8}$/.test(c)) {
      setError('کد باید ۴ تا ۸ رقم باشه')
      return
    }
    if (withPassword && !password) {
      setError('رمز دو مرحله‌ای رو وارد کن')
      return
    }
    setError('')
    setBusy('complete')
    try {
      const json = withPassword
        ? await post({ op: 'complete', code: c, password })
        : await post({ op: 'complete', code: c })
      if (json.ok && json.status === 'logged_in' && json.account) {
        setDone(json.account)
        toast({ title: 'اکانت وصل شد ✓', description: json.account.label })
      } else if (json.ok && json.status === '2fa_needed') {
        setStep(3)
      } else if (json.status === 'no_pending') {
        setError('درخواست کد منقضی شده — دوباره کد بگیر')
        setStep(1)
      } else if (json.status === 'bad_code') {
        setError('کد اشتباهه — دوباره واردش کن')
      } else if (json.status === 'expired') {
        setError('کد منقضی شده — با «ویرایش شماره» برگرد و کد جدید بگیر')
      } else if (json.status === 'bad_password') {
        setError('رمز دو مرحله‌ای اشتباهه — دوباره بزنش')
      } else {
        setError(json.error || 'ورود کامل نشد — دوباره امتحان کن')
      }
    } catch {
      setError('ارتباط برقرار نشد')
    } finally {
      setBusy(null)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) close(true)
      }}
    >
      <DialogContent dir="rtl" className="max-h-[88vh] overflow-y-auto border-zinc-800 bg-zinc-950 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm text-zinc-100">
            اتصال ساده اکانت تلگرام
          </DialogTitle>
          <DialogDescription className="text-[11px] leading-5">
            {done
              ? 'اکانت وصل شد و به لیست اضافه شد.'
              : 'فقط شماره و کد تایید لازمه — اگه رمز دو مرحله‌ای داشته باشی، خودش می‌پرسه.'}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <CheckCircle2 className="h-12 w-12 text-emerald-400" />
            <p className="text-sm font-bold text-zinc-100">{done.label}</p>
            {done.username ? (
              <p className="font-mono text-xs text-emerald-400" dir="ltr">
                @{done.username}
              </p>
            ) : null}
            {done.phone ? (
              <p className="font-mono text-xs text-zinc-400" dir="ltr">
                {done.phone}
              </p>
            ) : null}
            <p className="text-[11px] text-zinc-600">در حال بستن خودکار…</p>
          </div>
        ) : checking ? (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> بررسی اتصال نیمه‌کاره قبلی…
          </div>
        ) : (
          <div className="space-y-3">
            {/* progress */}
            <div className="flex items-center gap-1.5">
              {[1, 2, 3].map((s) => (
                <span
                  key={s}
                  className={`h-1 flex-1 rounded-full ${
                    step >= s ? 'bg-emerald-500' : 'bg-zinc-800'
                  }`}
                />
              ))}
            </div>
            <p className="text-xs font-bold text-zinc-300">
              مرحله {step} از ۳ — {WIZARD_STEPS[step - 1]}
            </p>

            {step === 1 ? (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-phone" className="text-xs text-zinc-300">
                    شماره تلفن
                  </Label>
                  <Input
                    id="wiz-phone"
                    dir="ltr"
                    inputMode="tel"
                    autoFocus
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && busy !== 'send') void sendCode()
                    }}
                    placeholder="+989123456789"
                    className="h-8 border-zinc-700 bg-zinc-950 font-mono text-sm text-zinc-100 placeholder:text-zinc-600"
                  />
                  <p className="text-[11px] leading-5 text-zinc-500">
                    کد تایید به تلگرامِ همون شماره میره (پیامک تلگرام یا اپ خودش).
                  </p>
                </div>
                {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
                <div className="flex justify-end">
                  <Button
                    onClick={() => void sendCode()}
                    disabled={busy === 'send'}
                    className="h-8 bg-emerald-600 text-xs font-bold text-zinc-950 hover:bg-emerald-500"
                  >
                    {busy === 'send' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Smartphone className="h-3.5 w-3.5" />
                    )}
                    ارسال کد
                  </Button>
                </div>
              </div>
            ) : null}

            {step === 2 ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-center">
                  <p className="text-[10px] text-zinc-500">
                    کد تایید برای این شماره ارسال شد:
                  </p>
                  <p className="font-mono text-sm text-zinc-100" dir="ltr">
                    {phone}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-code" className="text-xs text-zinc-300">
                    کد تایید
                  </Label>
                  <Input
                    id="wiz-code"
                    dir="ltr"
                    inputMode="numeric"
                    autoFocus
                    value={code}
                    onChange={(e) =>
                      setCode(e.target.value.replace(/\D/g, '').slice(0, 8))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && busy !== 'complete') void complete(false)
                    }}
                    placeholder="12345"
                    className="h-8 border-zinc-700 bg-zinc-950 text-center font-mono text-sm tracking-widest text-zinc-100 placeholder:text-zinc-600"
                  />
                  <p className="text-[11px] leading-5 text-zinc-500">
                    اگه کد نیومد، ۱-۲ دقیقه صبر کن یا با «ویرایش شماره» برگرد و دوباره
                    درخواست کد بده.
                  </p>
                </div>
                {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    onClick={() => close(true)}
                    disabled={busy === 'complete'}
                    className="h-8 border-zinc-700 bg-zinc-950 text-xs text-zinc-400 hover:bg-zinc-800"
                  >
                    انصراف
                  </Button>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => {
                        setError('')
                        setStep(1)
                      }}
                      disabled={busy === 'complete'}
                      className="h-8 border-zinc-700 bg-zinc-950 text-xs text-zinc-200 hover:bg-zinc-800"
                    >
                      ویرایش شماره
                    </Button>
                    <Button
                      onClick={() => void complete(false)}
                      disabled={busy === 'complete' || code.length < 4}
                      className="h-8 bg-emerald-600 text-xs font-bold text-zinc-950 hover:bg-emerald-500"
                    >
                      {busy === 'complete' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : null}
                      بررسی کد
                    </Button>
                  </div>
                </div>
              </div>
            ) : null}

            {step === 3 ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg border border-amber-800/50 bg-amber-950/20 p-2.5">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
                  <p className="text-[11px] leading-5 text-zinc-300">
                    این اکانت رمز دو مرحله‌ای داره — رمز ابری (Cloud Password) تلگرامت رو
                    وارد کن.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="wiz-pass" className="text-xs text-zinc-300">
                    رمز دو مرحله‌ای
                  </Label>
                  <Input
                    id="wiz-pass"
                    type="password"
                    dir="ltr"
                    autoFocus
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && busy !== 'complete') void complete(true)
                    }}
                    placeholder="••••••••"
                    className="h-8 border-zinc-700 bg-zinc-950 font-mono text-sm text-zinc-100 placeholder:text-zinc-600"
                  />
                </div>
                {error ? <p className="text-[11px] text-red-400">{error}</p> : null}
                <div className="flex items-center justify-between gap-2">
                  <Button
                    variant="outline"
                    onClick={() => close(true)}
                    disabled={busy === 'complete'}
                    className="h-8 border-zinc-700 bg-zinc-950 text-xs text-zinc-400 hover:bg-zinc-800"
                  >
                    انصراف
                  </Button>
                  <Button
                    onClick={() => void complete(true)}
                    disabled={busy === 'complete' || !password}
                    className="h-8 bg-emerald-600 text-xs font-bold text-zinc-950 hover:bg-emerald-500"
                  >
                    {busy === 'complete' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : null}
                    ورود
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* main tab                                                            */
/* ------------------------------------------------------------------ */

type Op = 'start' | 'stop' | 'restart' | 'delete'

const OP_TITLES: Record<Op, string> = {
  start: 'روشن',
  stop: 'خاموش',
  restart: 'ری‌استارت',
  delete: 'حذف',
}

export default function AccountsTab() {
  const { toast } = useToast()
  const [accounts, setAccounts] = useState<TgAccountRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<Record<string, Op>>({})
  const [dialog, setDialog] = useState<{ seq: number; account: TgAccountRow | null } | null>(null)
  const [wizard, setWizard] = useState<{ seq: number } | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TgAccountRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const mountedRef = useRef(true)
  const opsInFlight = useRef(0)

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const res = await panelFetch('/api/panel/accounts')
        const json = (await res.json()) as {
          ok: boolean
          accounts?: TgAccountRow[]
          error?: string
        }
        if (!res.ok || !json.ok) {
          if (!silent) toast({ title: 'خطا', description: json.error, variant: 'destructive' })
        } else if (mountedRef.current) {
          setAccounts(json.accounts ?? [])
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
      if (opsInFlight.current === 0) void load(true)
    }, 15_000)
    return () => {
      mountedRef.current = false
      clearInterval(t)
    }
  }, [])

  function setBusyId(id: string, op: Op | null) {
    setBusy((b) => {
      const nb = { ...b }
      if (op) nb[id] = op
      else delete nb[id]
      return nb
    })
  }

  async function runOp(acc: TgAccountRow, op: Exclude<Op, 'delete'>) {
    setBusyId(acc.id, op)
    opsInFlight.current += 1
    try {
      const res = await panelFetch('/api/panel/accounts', {
        method: 'POST',
        body: JSON.stringify({ op, id: acc.id }),
      })
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        output?: string
      }
      if (!res.ok || !json.ok) {
        toast({
          title: `${OP_TITLES[op]} نشد`,
          description: json.output || json.error,
          variant: 'destructive',
        })
      } else {
        toast({
          title: `${OP_TITLES[op]} شد ✓`,
          description: json.output ? String(json.output).slice(0, 200) : undefined,
        })
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      opsInFlight.current -= 1
      setBusyId(acc.id, null)
      setTimeout(() => void load(true), 1500)
    }
  }

  async function runDelete() {
    if (!deleteTarget) return
    const acc = deleteTarget
    setDeleting(true)
    setBusyId(acc.id, 'delete')
    opsInFlight.current += 1
    try {
      const res = await panelFetch('/api/panel/accounts', {
        method: 'POST',
        body: JSON.stringify({ op: 'delete', id: acc.id }),
      })
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) {
        toast({ title: 'حذف نشد', description: json.error, variant: 'destructive' })
      } else {
        toast({ title: 'اکانت حذف شد ✓' })
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      opsInFlight.current -= 1
      setBusyId(acc.id, null)
      setDeleting(false)
      setDeleteTarget(null)
      void load(true)
    }
  }

  /* ---------------- loading / error ---------------- */

  if (accounts === null && loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-36 w-full rounded-xl bg-zinc-800/60" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-80 w-full rounded-xl bg-zinc-800/60" />
          <Skeleton className="h-80 w-full rounded-xl bg-zinc-800/60" />
        </div>
      </div>
    )
  }

  if (accounts === null) {
    return (
      <Card className="border-red-900 bg-red-950/30">
        <CardContent className="flex flex-wrap items-center justify-between gap-2 p-4 text-red-300">
          <p className="text-sm">لیست اکانت‌ها دریافت نشد.</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="h-8 border-red-800/60 bg-red-950/40 text-red-200 hover:bg-red-950/60"
          >
            <RefreshCw className="h-3.5 w-3.5" /> تلاش دوباره
          </Button>
        </CardContent>
      </Card>
    )
  }

  /* ---------------- render ---------------- */

  return (
    <div className="space-y-4">
      {/* ---------------- header ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Users className="h-4 w-4 text-emerald-400" /> مدیریت چند اکانت
          </CardTitle>
          <div data-slot="card-action" className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load()}
              className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> رفرش
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialog({ seq: Date.now(), account: null })}
              className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
            >
              <Plus className="h-3.5 w-3.5" /> افزودن پیشرفته
            </Button>
            <Button
              size="sm"
              onClick={() => setWizard({ seq: Date.now() })}
              className="h-8 bg-emerald-600 font-bold text-zinc-950 shadow-lg shadow-emerald-500/25 hover:bg-emerald-500"
            >
              <Smartphone className="h-3.5 w-3.5" /> اتصال ساده
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs leading-6 text-zinc-400">
            هر اکانتی اینجا اضافه کنی، یه دستیار ایزوله با سشن خودش، موضوع و شخصیت خودشه و
            می‌تونه همزمان با بقیه روشن باشه. قانون تک‌کلاینت به ازای هر سشن رعایت میشه — سشنِ
            اکانت اصلی هیچ‌وقت دوباره استفاده نمی‌شه.
          </p>
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
            <ShieldCheck className="h-4 w-4 shrink-0 text-amber-400" />
            <p className="flex-1 text-[11px] leading-5 text-zinc-400">
              اکانت اصلی فروشگاه{' '}
              <span className="font-mono text-zinc-200" dir="ltr">
                (@VpnStarZ)
              </span>{' '}
              جدا از اینجاست و از تب‌های «وضعیت» و «سرویس‌ها» مدیریت میشه.
            </p>
            <Badge className="bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700">فقط-خواندنی</Badge>
          </div>
          <p className="text-[10px] leading-5 text-zinc-600">
            وضعیت اکانت‌ها هر ۱۵ ثانیه خودکار رفرش میشه.
          </p>
        </CardContent>
      </Card>

      {/* ---------------- account cards ---------------- */}
      {accounts.length === 0 ? (
        <Card className="border-dashed border-zinc-800 bg-zinc-900/40">
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <Users className="h-8 w-8 text-zinc-600" />
            <p className="text-sm font-bold text-zinc-300">هنوز اکانتی اضافه نکردی</p>
            <p className="max-w-md text-xs leading-6 text-zinc-500">
              با دکمه «اتصال ساده» فقط با شماره‌ت لاگین کن، یا با «افزودن پیشرفته» سشن آماده
              بذار — هر اکانت یه دستیار ایزوله با موضوع و شخصیت خودشه و می‌تونه همزمان با
              اکانت اصلی و بقیه روشن باشه.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {accounts.map((acc) => {
            const st = acc.status
            const busyOp = busy[acc.id] ?? null
            const cardDisabled = busyOp !== null
            return (
              <Card key={acc.id} className="flex flex-col border-zinc-800 bg-zinc-900/70">
                <CardHeader className="space-y-2 pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-sm font-bold text-zinc-100">{acc.label}</CardTitle>
                    {st.running ? (
                      <Badge className="bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">
                        فعال
                      </Badge>
                    ) : st.lastError ? (
                      <Badge className="bg-red-500/15 text-red-300 ring-1 ring-red-500/40">
                        خطا
                      </Badge>
                    ) : (
                      <Badge className="bg-zinc-700/40 text-zinc-300 ring-1 ring-zinc-600/50">
                        خاموش
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {acc.topic ? (
                      <Badge className="max-w-full truncate bg-zinc-800 text-zinc-300">
                        {acc.topic}
                      </Badge>
                    ) : null}
                    {acc.phone ? (
                      <span className="font-mono text-[10px] text-zinc-500" dir="ltr">
                        {acc.phone}
                      </span>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
                  <div className="flex flex-wrap gap-1.5">
                    <Badge className="bg-zinc-800 text-zinc-300">
                      آپتایم {faUptime(st.uptimeSec)}
                    </Badge>
                    <Badge className="bg-zinc-800 text-zinc-300">جواب‌ها {fa(st.repliesTotal)}</Badge>
                    <Badge className="bg-zinc-800 text-zinc-300">
                      استارت‌ها {fa(st.startedCount)}
                    </Badge>
                  </div>

                  {st.lastError ? (
                    <p className="truncate text-xs text-red-400" title={st.lastError}>
                      {st.lastError}
                    </p>
                  ) : null}

                  <div
                    className="max-h-40 flex-1 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-2"
                    dir="rtl"
                  >
                    {st.events.length === 0 ? (
                      <p className="py-3 text-center text-[11px] text-zinc-600">
                        هنوز رویدادی ثبت نشده
                      </p>
                    ) : (
                      <ul className="space-y-1">
                        {st.events.map((ev, i) => (
                          <li
                            key={`${ev.ts}-${i}`}
                            className="flex items-baseline gap-1.5 text-xs text-zinc-400"
                          >
                            <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">
                              {tehranTime(ev.ts)}
                            </span>
                            <span
                              className={`shrink-0 ${
                                ev.event === 'reply_send'
                                  ? 'text-emerald-400'
                                  : ev.event === 'llm_fail' || ev.event === 'fatal'
                                    ? 'text-red-400'
                                    : 'text-zinc-300'
                              }`}
                            >
                              {EVENT_LABELS[ev.event] || ev.event}
                            </span>
                            {ev.detail ? (
                              <span className="truncate text-zinc-500" dir="auto">
                                — {ev.detail}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runOp(acc, 'start')}
                      disabled={cardDisabled || st.running}
                      className="h-8 border-emerald-800/60 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-950/50"
                    >
                      {busyOp === 'start' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      روشن
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runOp(acc, 'stop')}
                      disabled={cardDisabled || (!st.running && !st.supervisorAlive)}
                      className="h-8 border-amber-800/60 bg-amber-950/30 text-amber-300 hover:bg-amber-950/50"
                    >
                      {busyOp === 'stop' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Square className="h-3.5 w-3.5" />
                      )}
                      خاموش
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runOp(acc, 'restart')}
                      disabled={cardDisabled}
                      className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                    >
                      {busyOp === 'restart' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                      ری‌استارت
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDialog({ seq: Date.now(), account: acc })}
                      disabled={cardDisabled}
                      className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                    >
                      {busyOp ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Pencil className="h-3.5 w-3.5" />
                      )}
                      ویرایش
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteTarget(acc)}
                      disabled={cardDisabled}
                      className="h-8 border-red-900/60 bg-red-950/30 text-red-300 hover:bg-red-950/50"
                    >
                      {busyOp === 'delete' ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                      حذف
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ---------------- add / edit dialog ---------------- */}
      {dialog ? (
        <AccountDialog
          key={dialog.seq}
          account={dialog.account}
          onOpenChange={(o) => {
            if (!o) setDialog(null)
          }}
          onDone={() => {
            setDialog(null)
            void load(true)
          }}
        />
      ) : null}

      {/* ---------------- simple login wizard ---------------- */}
      {wizard ? (
        <SimpleLoginWizard
          key={wizard.seq}
          onOpenChange={(o) => {
            if (!o) setWizard(null)
          }}
          onDone={() => {
            setWizard(null)
            void load(true)
          }}
        />
      ) : null}

      {/* ---------------- delete confirm ---------------- */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => {
          if (!o && !deleting) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent dir="rtl" className="border-zinc-800 bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">
              حذف اکانت{deleteTarget ? ` «${deleteTarget.label}»` : ''}؟
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-6">
              سرویسش خاموش، فایل‌هاش و رکوردش پاک میشه؛ سشنِ اکانت اصلی دست نمی‌خوره.
              برگشتی نداره — ادامه بدم؟
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={deleting}
              className="border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
            >
              بی‌خیال
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void runDelete()
              }}
              disabled={deleting}
              className="bg-red-600 text-xs font-bold text-zinc-50 hover:bg-red-500"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              آره، حذف کن
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
