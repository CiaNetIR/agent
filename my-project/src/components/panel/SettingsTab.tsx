'use client'

import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Contrast, Eye, EyeOff, KeyRound, Loader2, Palette, Pipette, RotateCcw, Type } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { DEFAULT_THEME, panelFetch, setStoredKey, sha256Hex, type PanelTheme } from '@/lib/panel'

interface SettingsTabProps {
  theme?: PanelTheme
  onThemeChange?: (t: PanelTheme) => void
}

/* ---------- ready-made color sets (main / second / dim) ---------- */

const PRESETS: { name: string; main: string; second: string; dim: string }[] = [
  { name: 'پیش‌فرض روشن', main: '#f4f4f5', second: '#d4d4d8', dim: '#a1a1aa' },
  { name: 'سفید خالص', main: '#ffffff', second: '#f4f4f5', dim: '#c9c9ce' },
  { name: 'کهربایی', main: '#fde68a', second: '#fcd34d', dim: '#f59e0b' },
  { name: 'سبز روشن', main: '#a7f3d0', second: '#6ee7b7', dim: '#34d399' },
  { name: 'فیروزه‌ای', main: '#a5f3fc', second: '#67e8f9', dim: '#22d3ee' },
  { name: 'صورتی روشن', main: '#fbcfe8', second: '#f9a8d4', dim: '#f472b6' },
]

const ZOOMS: { label: string; value: number }[] = [
  { label: 'کوچک‌تر', value: 0.95 },
  { label: 'عادی', value: 1 },
  { label: 'درشت', value: 1.08 },
  { label: 'درشت‌تر', value: 1.16 },
]

/* ---------- one exact-color picker tile with live sample ---------- */

function ColorField({
  label,
  sample,
  value,
  onPick,
}: {
  label: string
  sample: string
  value: string
  onPick: (hex: string) => void
}) {
  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] text-zinc-500">{label}</p>
        <p className="font-mono text-[10px] text-zinc-600" dir="ltr">
          {value}
        </p>
      </div>
      <div className="flex items-center gap-2.5">
        <input
          type="color"
          value={value}
          onChange={(e) => onPick(e.target.value)}
          aria-label={label}
          className="h-8 w-10 shrink-0 cursor-pointer rounded-md border border-zinc-700 bg-zinc-950 p-0.5"
        />
        {/* inline style on purpose: shows the EXACT color, unaffected by theme vars */}
        <p className="truncate text-xs" style={{ color: value }}>
          {sample}
        </p>
      </div>
    </div>
  )
}

export default function SettingsTab({ theme, onThemeChange }: SettingsTabProps) {
  const { toast } = useToast()

  /* ---------- password change state ---------- */
  const [pwCurrent, setPwCurrent] = useState('')
  const [pwNext, setPwNext] = useState('')
  const [pwConfirm, setPwConfirm] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwSubmitted, setPwSubmitted] = useState(false)
  const [pwShowCurrent, setPwShowCurrent] = useState(false)
  const [pwShowNext, setPwShowNext] = useState(false)
  const [pwShowConfirm, setPwShowConfirm] = useState(false)

  const lenOk = pwNext.length >= 8 && pwNext.length <= 64
  const sameAsCurrent = pwNext !== '' && pwCurrent !== '' && pwNext === pwCurrent
  const pwValid = pwCurrent !== '' && lenOk && pwNext === pwConfirm && !sameAsCurrent

  const currentErr = pwSubmitted && pwCurrent === '' ? 'رمز فعلی رو وارد کن' : ''
  const nextErr =
    (pwNext !== '' || pwSubmitted) && !lenOk
      ? 'رمز جدید باید ۸ تا ۶۴ کاراکتر باشه'
      : sameAsCurrent
        ? 'رمز جدید نباید با رمز فعلی یکی باشه'
        : ''
  const confirmErr =
    (pwConfirm !== '' || pwSubmitted) && pwNext !== pwConfirm ? 'تکرار رمز با رمز جدید یکی نیست' : ''

  async function submitPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setPwSubmitted(true)
    if (!pwValid || pwBusy) return
    setPwBusy(true)
    try {
      const res = await panelFetch('/api/panel/password', {
        method: 'POST',
        body: JSON.stringify({ current: pwCurrent, next: pwNext }),
      })
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!res.ok || !json.ok) {
        toast({ title: 'تغییر رمز نشد', description: json.error, variant: 'destructive' })
      } else {
        // the stored key IS the sha256 of the password — refresh it so the
        // owner stays logged in with the new password
        setStoredKey(await sha256Hex(pwNext))
        toast({
          title: 'رمز پنل عوض شد ✓',
          description: 'از این به بعد برای ورود از همین رمز جدید استفاده کن.',
        })
        setPwCurrent('')
        setPwNext('')
        setPwConfirm('')
        setPwSubmitted(false)
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setPwBusy(false)
    }
  }

  const themeReady = theme != null && onThemeChange != null

  return (
    <div className="space-y-4">
      {/* ---------------- appearance / readability ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Palette className="h-4 w-4 text-amber-400" /> ظاهر و خوانایی متن
          </CardTitle>
          {themeReady ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                onThemeChange(DEFAULT_THEME)
                toast({
                  title: 'به پیش‌فرض برگشت ✓',
                  description: 'رنگ متن‌ها و اندازه‌شون مثل اول شد.',
                })
              }}
              className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
            >
              <RotateCcw className="h-3.5 w-3.5" /> بازگردانی به پیش‌فرض
            </Button>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {themeReady ? (
            <>
              {/* ready-made presets */}
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <Contrast className="h-3.5 w-3.5 text-emerald-400" /> رنگ‌های آماده
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {PRESETS.map((p) => {
                    const active =
                      theme.main === p.main && theme.second === p.second && theme.dim === p.dim
                    return (
                      <Button
                        key={p.name}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onThemeChange({ main: p.main, second: p.second, dim: p.dim, zoom: theme.zoom })}
                        className={`h-8 justify-start gap-2 px-2.5 text-[11px] font-bold ${
                          active
                            ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-950/50'
                            : 'border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800'
                        }`}
                      >
                        <span className="flex shrink-0 overflow-hidden rounded" aria-hidden>
                          <span className="h-3.5 w-2" style={{ backgroundColor: p.main }} />
                          <span className="h-3.5 w-2" style={{ backgroundColor: p.second }} />
                          <span className="h-3.5 w-2" style={{ backgroundColor: p.dim }} />
                        </span>
                        {p.name}
                      </Button>
                    )
                  })}
                </div>
              </div>

              {/* exact color pickers */}
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <Pipette className="h-3.5 w-3.5 text-emerald-400" /> رنگ دقیق متن‌ها
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <ColorField
                    label="متن اصلی"
                    sample="متن اصلی مثل تیتر کارت‌ها"
                    value={theme.main}
                    onPick={(hex) => onThemeChange({ ...theme, main: hex })}
                  />
                  <ColorField
                    label="متن ثانویه"
                    sample="متن ثانویه مثل توضیح کارت‌ها"
                    value={theme.second}
                    onPick={(hex) => onThemeChange({ ...theme, second: hex })}
                  />
                  <ColorField
                    label="متن کم‌رنگ"
                    sample="متن کم‌رنگ مثل زمان‌ها و مسیرها"
                    value={theme.dim}
                    onPick={(hex) => onThemeChange({ ...theme, dim: hex })}
                  />
                </div>
              </div>

              {/* text size */}
              <div className="space-y-2">
                <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                  <Type className="h-3.5 w-3.5 text-emerald-400" /> اندازه متن پنل
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {ZOOMS.map((z) => {
                    const active = theme.zoom === z.value
                    return (
                      <Button
                        key={z.value}
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onThemeChange({ ...theme, zoom: z.value })}
                        className={`h-8 text-[11px] font-bold ${
                          active
                            ? 'border-emerald-800/60 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-950/50'
                            : 'border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800'
                        }`}
                      >
                        {z.label}
                      </Button>
                    )
                  })}
                </div>
              </div>

              {/* live preview on the panel's black background */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
                <p className="text-[10px] text-zinc-600">
                  پیش‌نمایش زنده — دقیقاً همون چیزی که همه‌جای پنل می‌بینی
                </p>
                <div className="mt-2.5 space-y-1.5">
                  <p className="text-sm font-bold" style={{ color: theme.main }}>
                    متن اصلی پنل
                  </p>
                  <p className="text-xs" style={{ color: theme.second }}>
                    متن ثانویه مثل توضیح کارت‌ها
                  </p>
                  <p className="text-[11px]" style={{ color: theme.dim }}>
                    متن کم‌رنگ مثل زمان‌ها و مسیرها
                  </p>
                </div>
              </div>

              <p className="text-[10px] leading-5 text-zinc-600">
                پیش‌فرضِ جدید متن‌های کم‌رنگ رو روشن‌تر کرده؛ اگه پس‌زمینه سیاهه، با رنگ‌های بالا
                متن رو سفید یا هر رنگی که دوست داری کن — همه‌جای پنل اعمال میشه و فقط روی همین
                مرورگر ذخیره می‌مونه.
              </p>
            </>
          ) : (
            <p className="text-xs text-zinc-500">تنظیمات ظاهر هنوز بارگذاری نشده؛ یک لحظه صبر کن…</p>
          )}
        </CardContent>
      </Card>

      {/* ---------------- password change ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <KeyRound className="h-4 w-4 text-emerald-400" /> تغییر رمز پنل
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={submitPassword} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pw-current" className="text-[11px] font-bold text-zinc-400">
                  رمز فعلی
                </Label>
                <div className="relative">
                  <Input
                    id="pw-current"
                    type={pwShowCurrent ? 'text' : 'password'}
                    dir="ltr"
                    autoComplete="current-password"
                    value={pwCurrent}
                    onChange={(e) => setPwCurrent(e.target.value)}
                    aria-invalid={currentErr ? true : undefined}
                    className="h-8 border-zinc-700 bg-zinc-950 pr-9 text-left text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/50"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setPwShowCurrent((v) => !v)}
                    aria-label="نمایش رمز"
                    className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                  >
                    {pwShowCurrent ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
                {currentErr ? <p className="text-[10px] text-red-400">{currentErr}</p> : null}
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="pw-next" className="text-[11px] font-bold text-zinc-400">
                    رمز جدید
                  </Label>
                  <span className="font-mono text-[10px] text-zinc-600" dir="ltr">
                    {pwNext.length}/64
                  </span>
                </div>
                <div className="relative">
                  <Input
                    id="pw-next"
                    type={pwShowNext ? 'text' : 'password'}
                    dir="ltr"
                    autoComplete="new-password"
                    value={pwNext}
                    onChange={(e) => setPwNext(e.target.value)}
                    aria-invalid={nextErr ? true : undefined}
                    className="h-8 border-zinc-700 bg-zinc-950 pr-9 text-left text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/50"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setPwShowNext((v) => !v)}
                    aria-label="نمایش رمز"
                    className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                  >
                    {pwShowNext ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                {nextErr ? <p className="text-[10px] text-red-400">{nextErr}</p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw-confirm" className="text-[11px] font-bold text-zinc-400">
                  تکرار رمز جدید
                </Label>
                <div className="relative">
                  <Input
                    id="pw-confirm"
                    type={pwShowConfirm ? 'text' : 'password'}
                    dir="ltr"
                    autoComplete="new-password"
                    value={pwConfirm}
                    onChange={(e) => setPwConfirm(e.target.value)}
                    aria-invalid={confirmErr ? true : undefined}
                    className="h-8 border-zinc-700 bg-zinc-950 pr-9 text-left text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/50"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => setPwShowConfirm((v) => !v)}
                    aria-label="نمایش رمز"
                    className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                  >
                    {pwShowConfirm ? (
                      <EyeOff className="h-3.5 w-3.5" />
                    ) : (
                      <Eye className="h-3.5 w-3.5" />
                    )}
                  </Button>
                </div>
                {confirmErr ? <p className="text-[10px] text-red-400">{confirmErr}</p> : null}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={!pwValid || pwBusy}
                className="h-8 bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500"
              >
                {pwBusy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <KeyRound className="h-3.5 w-3.5" />
                )}
                تغییر رمز
              </Button>
              <p className="text-[10px] leading-5 text-zinc-600 sm:max-w-md">
                بعد از تغییر لازم نیست خارج بشی؛ همین رمز جدید از این به بعد برای ورود استفاده
                میشه. حداقل ۸ کاراکتر.
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
