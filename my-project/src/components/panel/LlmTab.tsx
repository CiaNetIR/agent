'use client'

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import {
  Brain,
  ChevronDown,
  Cpu,
  Eraser,
  Gauge,
  Lightbulb,
  ListOrdered,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  ScrollText,
  SendHorizontal,
  Sparkles,
  Stamp,
} from 'lucide-react'
import { panelFetch, type LlmSettings } from '@/lib/panel'

type Settings = LlmSettings['settings']

const PERSONA_MAX = 16_000
const FOOTER_MAX = 300

const RETRY_LABELS = ['۱ بار', '۲ بار', '۳ بار', '۴ بار', '۵ بار']

/** Snapshot of the last saved state — dirty checks compare against this. */
interface Snapshot {
  thinking: boolean
  retries: number
  perChat: number
  global: number
  debounce: number
  footer: string
  persona: string
  command: string
}

interface PgMsg {
  role: 'user' | 'assistant'
  content: string
}

function toInt(v: string): number | null {
  const n = Number.parseInt(v.trim(), 10)
  return Number.isNaN(n) ? null : n
}

function fa(n: number): string {
  try {
    return n.toLocaleString('fa-IR')
  } catch {
    return String(n)
  }
}

/** Small dot pinned on a save button when unsaved changes exist. */
function DirtyDot() {
  return (
    <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-emerald-400 ring-2 ring-zinc-900" />
  )
}

export default function LlmTab() {
  const { toast } = useToast()

  const [settings, setSettings] = useState<Settings | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [saveBusy, setSaveBusy] = useState<'model' | 'persona' | 'command' | null>(null)

  // editable model/mode fields
  const [thinking, setThinking] = useState(true)
  const [retries, setRetries] = useState('3')
  const [perChat, setPerChat] = useState('')
  const [globalHour, setGlobalHour] = useState('')
  const [debounceS, setDebounceS] = useState('')
  const [footer, setFooter] = useState('')

  // editable prompts
  const [persona, setPersona] = useState('')
  const [commandPrompt, setCommandPrompt] = useState('')
  const [base, setBase] = useState<Snapshot | null>(null)

  // playground
  const [pgMsgs, setPgMsgs] = useState<PgMsg[]>([])
  const [pgInput, setPgInput] = useState('')
  const [pgBusy, setPgBusy] = useState(false)
  const [pgMode, setPgMode] = useState<'draft' | 'default'>('draft')
  const [provider, setProvider] = useState<{ kind: 'zai' | 'openai' | 'none'; label: string; model: string; error?: string } | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)

  const applySettings = useCallback((s: Settings) => {
    setSettings(s)
    setThinking(s.thinking)
    setRetries(String(s.retries))
    setPerChat(String(s.rate_limits.per_chat_hour))
    setGlobalHour(String(s.rate_limits.global_hour))
    setDebounceS(String(s.rate_limits.debounce_s))
    setFooter(s.footer)
    setPersona(s.persona)
    setCommandPrompt(s.command_prompt)
    setBase({
      thinking: s.thinking,
      retries: s.retries,
      perChat: s.rate_limits.per_chat_hour,
      global: s.rate_limits.global_hour,
      debounce: s.rate_limits.debounce_s,
      footer: s.footer,
      persona: s.persona,
      command: s.command_prompt,
    })
  }, [])

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true)
      try {
        const res = await panelFetch('/api/panel/llm-settings')
        const json = (await res.json()) as LlmSettings & { error?: string }
        if (!res.ok || !json.ok || !json.settings) {
          if (!silent) setErr(json.error || 'خواندن تنظیمات ممکن نشد')
        } else {
          applySettings(json.settings)
          setErr('')
        }
      } catch {
        if (!silent) setErr('ارتباط برقرار نشد')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [applySettings]
  )

  useEffect(() => {
    void load()
    // active LLM provider badge (sandbox SDK / OpenAI-compatible / none)
    void (async () => {
      try {
        const res = await panelFetch('/api/panel/llm-chat')
        if (!res.ok) return
        const json = (await res.json()) as {
          ok: boolean
          provider?: { kind: 'zai' | 'openai' | 'none'; label: string; model: string; error?: string }
        }
        if (json.ok && json.provider) setProvider(json.provider)
      } catch {
        /* badge is optional */
      }
    })()
  }, [load])

  // keep the playground chat pinned to the bottom
  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [pgMsgs, pgBusy])

  /* ------------------------------ dirty flags ----------------------------- */

  const modelDirty =
    base !== null &&
    (thinking !== base.thinking ||
      toInt(retries) !== base.retries ||
      toInt(perChat) !== base.perChat ||
      toInt(globalHour) !== base.global ||
      toInt(debounceS) !== base.debounce ||
      footer.trim() !== base.footer)
  const personaDirty = base !== null && persona !== base.persona
  const commandDirty = base !== null && commandPrompt !== base.command
  const personaOver = persona.length > PERSONA_MAX
  const commandOver = commandPrompt.length > PERSONA_MAX

  /* ------------------------------- save: model ---------------------------- */

  async function saveModel() {
    if (!base) return
    const r = toInt(retries)
    const pc = toInt(perChat)
    const gh = toInt(globalHour)
    const db = toInt(debounceS)
    if (r === null || r < 1 || r > 5) {
      toast({
        title: 'مقدار نامعتبر',
        description: 'تلاش مجدد در خطا باید بین ۱ تا ۵ باشد.',
        variant: 'destructive',
      })
      return
    }
    if (pc === null || pc < 1 || pc > 200) {
      toast({
        title: 'مقدار نامعتبر',
        description: 'محدودیت هر چت باید بین ۱ تا ۲۰۰ در ساعت باشد.',
        variant: 'destructive',
      })
      return
    }
    if (gh === null || gh < 1 || gh > 1000) {
      toast({
        title: 'مقدار نامعتبر',
        description: 'محدودیت کلی باید بین ۱ تا ۱۰۰۰ در ساعت باشد.',
        variant: 'destructive',
      })
      return
    }
    if (db === null || db < 0 || db > 300) {
      toast({
        title: 'مقدار نامعتبر',
        description: 'تاخیر گروه‌بندی باید بین ۰ تا ۳۰۰ ثانیه باشد.',
        variant: 'destructive',
      })
      return
    }
    if (footer.length > FOOTER_MAX) {
      toast({
        title: 'مقدار نامعتبر',
        description: `فوتر بیشتر از ${fa(FOOTER_MAX)} حرف نمی‌تواند باشد.`,
        variant: 'destructive',
      })
      return
    }

    // only send what actually changed — avoids fake "customized" overrides
    const body: Record<string, unknown> = {}
    if (thinking !== base.thinking) body.thinking = thinking
    if (r !== base.retries) body.retries = r
    if (pc !== base.perChat || gh !== base.global || db !== base.debounce) {
      body.rate_limits = { per_chat_hour: pc, global_hour: gh, debounce_s: db }
    }
    if (footer.trim() !== base.footer) body.footer = footer
    if (Object.keys(body).length === 0) return

    setSaveBusy('model')
    try {
      const res = await panelFetch('/api/panel/llm-settings', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const json = (await res.json()) as { ok: boolean; error?: string; settings?: Settings }
      if (!res.ok || !json.ok) {
        toast({ title: 'ذخیره نشد', description: json.error, variant: 'destructive' })
      } else {
        if (json.settings) applySettings(json.settings)
        else void load(true)
        toast({
          title: 'ذخیره شد؛ واتچر ری‌استارت شد',
          description: 'تنظیمات از این لحظه روی دستیار اعمال است.',
        })
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setSaveBusy(null)
    }
  }

  /* --------------------------- save / reset prompts ------------------------ */

  async function postPrompt(key: 'persona' | 'command_prompt', value: string, okTitle: string) {
    setSaveBusy(key === 'persona' ? 'persona' : 'command')
    try {
      const res = await panelFetch('/api/panel/llm-settings', {
        method: 'POST',
        body: JSON.stringify({ [key]: value }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string; settings?: Settings }
      if (!res.ok || !json.ok) {
        toast({ title: 'ذخیره نشد', description: json.error, variant: 'destructive' })
      } else {
        if (json.settings) applySettings(json.settings)
        else void load(true)
        toast({
          title: okTitle,
          description: 'تنظیمات از این لحظه روی دستیار اعمال است.',
        })
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setSaveBusy(null)
    }
  }

  function savePromptField(kind: 'persona' | 'command') {
    const isPersona = kind === 'persona'
    const value = isPersona ? persona : commandPrompt
    const over = isPersona ? personaOver : commandOver
    const label = isPersona ? 'شخصیت' : 'مغز فرمان'
    if (!value.trim()) {
      toast({
        title: `متن ${label} خالی است`,
        description: 'برای برگشت به پیش‌فرض، دکمه «بازگردانی پیش‌فرض» را بزن.',
        variant: 'destructive',
      })
      return
    }
    if (over) {
      toast({
        title: `متن ${label} طولانی است`,
        description: `بیشتر از ${fa(PERSONA_MAX)} حرف نمی‌شود.`,
        variant: 'destructive',
      })
      return
    }
    void postPrompt(
      isPersona ? 'persona' : 'command_prompt',
      value,
      `${label} ذخیره شد؛ واتچر ری‌استارت شد`
    )
  }

  function resetPromptField(kind: 'persona' | 'command') {
    const isPersona = kind === 'persona'
    void postPrompt(
      isPersona ? 'persona' : 'command_prompt',
      '',
      isPersona ? 'شخصیت سفارشی حذف شد؛ پیش‌فرض برگشت' : 'مغز فرمان سفارشی حذف شد؛ پیش‌فرض برگشت'
    )
  }

  /* ------------------------------- playground ------------------------------ */

  async function sendPlayground() {
    const text = pgInput.trim()
    if (!text || pgBusy) return
    const system = pgMode === 'draft' ? persona : ''
    const history: PgMsg[] = [...pgMsgs, { role: 'user', content: text }]
    setPgMsgs(history)
    setPgInput('')
    setPgBusy(true)
    try {
      const res = await panelFetch('/api/panel/llm-chat', {
        method: 'POST',
        body: JSON.stringify({ messages: history, system, thinking }),
      })
      const json = (await res.json()) as { ok: boolean; error?: string; content?: string }
      if (!res.ok || !json.ok || typeof json.content !== 'string') {
        toast({ title: 'خطای مدل', description: json.error, variant: 'destructive' })
      } else {
        setPgMsgs((m) => [...m, { role: 'assistant', content: json.content as string }])
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setPgBusy(false)
    }
  }

  function onPgKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void sendPlayground()
    }
  }

  /* --------------------------------- render -------------------------------- */

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-72 w-full rounded-xl bg-zinc-800/60" />
        <Skeleton className="h-60 w-full rounded-xl bg-zinc-800/60" />
        <Skeleton className="h-96 w-full rounded-xl bg-zinc-800/60" />
        <Skeleton className="h-80 w-full rounded-xl bg-zinc-800/60" />
        <Skeleton className="h-32 w-full rounded-xl bg-zinc-800/60" />
      </div>
    )
  }

  if (err || !settings) {
    return (
      <Card className="border-amber-900/50 bg-amber-950/20">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="text-sm text-amber-300">{err}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load()}
            className="h-8 border-amber-800/60 bg-amber-950/40 text-amber-300 hover:bg-amber-950/60"
          >
            <RefreshCw className="h-3.5 w-3.5" /> تلاش دوباره
          </Button>
        </CardContent>
      </Card>
    )
  }

  const s = settings

  return (
    <div className="space-y-4">
      {/* ---------------- 1. model & mode (editable) ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Cpu className="h-4 w-4 text-amber-400" /> مدل و حالت
          </CardTitle>
          <Badge className="bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30">
            <Cpu className="h-3 w-3" /> {s.model} — تنها مدل سرویس
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-6 text-zinc-400">
            سرویس این محیط فقط همین یک مدل رو سرو می‌کنه؛ هر اسم مدلی بفرستی، همین رو تحویل
            می‌گیری. اهرم واقعی دستِ تو «حالت تفکر» است.
          </p>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="min-w-0 space-y-1">
              <Label htmlFor="llm-thinking" className="text-[13px] font-bold text-zinc-200">
                حالت تفکر (دقیق)
              </Label>
              <p className="text-[11px] leading-5 text-zinc-500">
                روشن = جواب‌های دقیق‌تر با زنجیره فکر (کندتر) / خاموش = جواب سریع
              </p>
            </div>
            <Switch
              id="llm-thinking"
              checked={thinking}
              onCheckedChange={setThinking}
              className="data-[state=checked]:bg-amber-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="llm-retries" className="text-[11px] text-zinc-400">
                تلاش مجدد در خطا
              </Label>
              <Select value={retries} onValueChange={setRetries}>
                <SelectTrigger
                  id="llm-retries"
                  className="h-9 w-full border-zinc-800 bg-zinc-950 text-xs text-zinc-200"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-200">
                  {RETRY_LABELS.map((lbl, i) => (
                    <SelectItem key={lbl} value={String(i + 1)} className="text-xs focus:bg-zinc-800">
                      {lbl}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-perchat" className="text-[11px] text-zinc-400">
                هر چت در ساعت
              </Label>
              <Input
                id="llm-perchat"
                type="number"
                dir="ltr"
                inputMode="numeric"
                min={1}
                max={200}
                value={perChat}
                onChange={(e) => setPerChat(e.target.value)}
                className="h-9 border-zinc-800 bg-zinc-950 text-center text-zinc-200"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-global" className="text-[11px] text-zinc-400">
                کل در ساعت
              </Label>
              <Input
                id="llm-global"
                type="number"
                dir="ltr"
                inputMode="numeric"
                min={1}
                max={1000}
                value={globalHour}
                onChange={(e) => setGlobalHour(e.target.value)}
                className="h-9 border-zinc-800 bg-zinc-950 text-center text-zinc-200"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-debounce" className="text-[11px] text-zinc-400">
                تاخیر گروه‌بندی (ثانیه)
              </Label>
              <Input
                id="llm-debounce"
                type="number"
                dir="ltr"
                inputMode="numeric"
                min={0}
                max={300}
                value={debounceS}
                onChange={(e) => setDebounceS(e.target.value)}
                className="h-9 border-zinc-800 bg-zinc-950 text-center text-zinc-200"
              />
            </div>
          </div>
          <p className="text-[11px] leading-5 text-zinc-500">
            محدوده‌ها: هر چت ۱ تا ۲۰۰ · کل ۱ تا ۱۰۰۰ · تاخیر ۰ تا ۳۰۰ ثانیه — عدد خارج از
            محدوده ذخیره نمی‌شه.
          </p>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="llm-footer" className="text-[11px] text-zinc-400">
                فوتر هر پیام بات
              </Label>
              <span className="text-[10px] text-zinc-600">
                {fa(footer.length)} از {fa(FOOTER_MAX)} حرف
              </span>
            </div>
            <Input
              id="llm-footer"
              dir="rtl"
              maxLength={FOOTER_MAX}
              value={footer}
              onChange={(e) => setFooter(e.target.value)}
              className="h-9 border-zinc-800 bg-zinc-950 text-[13px] text-zinc-200"
            />
            <p className="text-[11px] leading-5 text-zinc-500">
              آخرِ همه‌ی جواب‌های بات چسبیده می‌شه؛ خالی کردنش یعنی برگشت به فوتر پیش‌فرضِ کد.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
            <div className="space-y-1.5">
              <p className="text-[10px] text-zinc-500">قیمت‌های رسمی (بخشی از شخصیت)</p>
              <div className="flex flex-wrap gap-1.5">
                <Badge className="bg-zinc-900 text-zinc-300 ring-1 ring-zinc-800">
                  نامحدود (اندروید + ویندوز) ماهانه: {s.prices.android_monthly}
                </Badge>
                <Badge className="bg-zinc-900 text-zinc-300 ring-1 ring-zinc-800">
                  حجمی (آیفون و سایر دستگاه‌ها): {s.prices.per_gb}
                </Badge>
              </div>
            </div>
            <Button
              size="sm"
              onClick={() => void saveModel()}
              disabled={saveBusy !== null || !modelDirty}
              className="relative h-9 bg-amber-500 font-bold text-zinc-950 hover:bg-amber-400"
            >
              {saveBusy === 'model' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              ذخیره و اعمال
              {modelDirty && saveBusy !== 'model' && <DirtyDot />}
            </Button>
          </div>
          <p className="text-[11px] leading-5 text-zinc-500">
            ذخیره یعنی نوشتن در{' '}
            <code dir="ltr" className="font-mono text-zinc-500">
              watcher-config.json
            </code>{' '}
            و ری‌استارت واتچر — چند ثانیه دستیار آفلاین می‌شه و بعدش تنظیمات جدید اعماله.
          </p>
        </CardContent>
      </Card>

      {/* ---------------- 2. explainer (read-only) ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Lightbulb className="h-4 w-4 text-amber-400" /> توضیح سیستم هوش مصنوعی
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <p className="text-[11px] leading-6 text-zinc-500">
            پنج خط زیر کل سیستم رو توضیح می‌ده — قبل از دست بردن به تنظیمات، یه نگاه بنداز.
          </p>

          <div className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10 ring-1 ring-amber-500/30">
              <Brain className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-bold text-zinc-200">مغز دستیار چیه؟</p>
              <p className="text-[11px] leading-6 text-zinc-400">
                مدل زبانی{' '}
                <span dir="ltr" className="font-mono text-zinc-300">
                  glm-4-plus
                </span>{' '}
                روی سرویس z-ai. واتچر (
                <code dir="ltr" className="font-mono text-zinc-400">
                  ~/tg-tools/watcher/watcher.py
                </code>
                ) پیام مشتری رو با ۱۰ پیام آخر چت به مدل می‌فرسته، جواب رو برای مشتری
                می‌فرسته و فوتر رو آخرش می‌چسبونه.
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10 ring-1 ring-amber-500/30">
              <ListOrdered className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-bold text-zinc-200">دو مغز جدا</p>
              <p className="text-[11px] leading-6 text-zinc-400">
                مغزِ اصلی (همان «شخصیت دستیار» پایین) جواب مشتری‌ها رو می‌ده؛ مغز فرمان‌گاه
                حرف خودمانیِ مالک توی Saved Messages رو به عملیات JSON تبدیل می‌کنه: بلاک،
                پیام، وضعیت، قانون، بکاپ، برودکست و….
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10 ring-1 ring-amber-500/30">
              <Gauge className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-bold text-zinc-200">حالت تفکر یعنی چی؟</p>
              <p className="text-[11px] leading-6 text-zinc-400">
                قبل از جواب دادن، مدل یه زنجیره فکر می‌چینه — کیفیت بالاتر، ولی سرعت پایین‌تر
                و هزینه بیشتر. برای گپ روزمره با مشتری خاموشش کن.
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10 ring-1 ring-amber-500/30">
              <ScrollText className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-bold text-zinc-200">مدیریت از همین تب</p>
              <p className="text-[11px] leading-6 text-zinc-400">
                هر چیزی که اینجا ذخیره کنی تو{' '}
                <code dir="ltr" className="font-mono text-zinc-400">
                  watcher-config.json
                </code>{' '}
                می‌شینه، واتچر ری‌استارت میشه و از اون لحظه اعماله. بکاپِ هر تغییر هم خودکار
                میره Saved Messages.
              </p>
            </div>
          </div>

          <div className="flex gap-3 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10 ring-1 ring-amber-500/30">
              <Stamp className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-bold text-zinc-200">قوانین دائمی</p>
              <p className="text-[11px] leading-6 text-zinc-400">
                با «یادت باشه که …» توی Saved Messages اضافه می‌شن و با «قوانین رو فراموش کن»
                پاک — لیستشون پایین همین صفحه است.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------------- 3. persona (editable) ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <ScrollText className="h-4 w-4 text-emerald-400" /> شخصیت دستیار (SYSTEM_PROMPT)
          </CardTitle>
          {s.customized?.persona ? (
            <Badge className="bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30">
              شخصیت سفارشی
            </Badge>
          ) : (
            <Badge className="bg-zinc-800 text-zinc-400">پیش‌فرض</Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[11px] leading-6 text-zinc-500">
            این متن تعیین می‌کنه دستیار با مشتری‌ها با چه لحن و قواعدی جواب بده؛ قیمت‌های
            رسمی هم بخشیش هستن.
          </p>
          <Textarea
            dir="rtl"
            rows={14}
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            className="field-sizing-fixed rounded-lg border-zinc-800 bg-zinc-950/70 text-[13px] leading-7 text-zinc-300"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className={`text-[11px] ${personaOver ? 'font-bold text-red-400' : 'text-zinc-500'}`}>
              {fa(persona.length)} از {fa(PERSONA_MAX)} حرف
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => resetPromptField('persona')}
                disabled={saveBusy !== null || !(s.customized?.persona || personaDirty)}
                className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
              >
                <RotateCcw className="h-3.5 w-3.5" /> بازگردانی پیش‌فرض
              </Button>
              <Button
                size="sm"
                onClick={() => savePromptField('persona')}
                disabled={saveBusy !== null || !personaDirty || personaOver}
                className="relative h-8 bg-amber-500 font-bold text-zinc-950 hover:bg-amber-400"
              >
                {saveBusy === 'persona' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                ذخیره شخصیت
                {personaDirty && saveBusy !== 'persona' && <DirtyDot />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ---------------- 4. command brain (collapsible, editable) ---------------- */}
      <Collapsible dir="rtl">
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CollapsibleTrigger className="group w-full">
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                <ListOrdered className="h-4 w-4 text-amber-400" /> مغز فرمان‌های Saved Messages
              </CardTitle>
              <div className="flex items-center gap-2">
                {s.customized?.command_prompt ? (
                  <Badge className="bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30">
                    سفارشی
                  </Badge>
                ) : (
                  <Badge className="bg-zinc-800 text-zinc-400">پیش‌فرض</Badge>
                )}
                <ChevronDown className="h-4 w-4 text-zinc-500 transition-transform group-data-[state=open]:rotate-180" />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-3">
              <p className="text-[11px] leading-6 text-zinc-500">
                این متن فقط به فرمان‌های خودت توی Saved Messages نگاه می‌کنه و تبدیلشون می‌کنه
                به عملیات (بلاک، پیام، وضعیت، قانون، بکاپ، برودکست و…)؛ ربطی به جواب مشتری‌ها
                نداره.
              </p>
              <Textarea
                dir="rtl"
                rows={10}
                value={commandPrompt}
                onChange={(e) => setCommandPrompt(e.target.value)}
                className="field-sizing-fixed rounded-lg border-zinc-800 bg-zinc-950/70 text-[13px] leading-7 text-zinc-300"
              />
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p
                  className={`text-[11px] ${commandOver ? 'font-bold text-red-400' : 'text-zinc-500'}`}
                >
                  {fa(commandPrompt.length)} از {fa(PERSONA_MAX)} حرف
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => resetPromptField('command')}
                    disabled={saveBusy !== null || !(s.customized?.command_prompt || commandDirty)}
                    className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> بازگردانی پیش‌فرض
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => savePromptField('command')}
                    disabled={saveBusy !== null || !commandDirty || commandOver}
                    className="relative h-8 bg-amber-500 font-bold text-zinc-950 hover:bg-amber-400"
                  >
                    {saveBusy === 'command' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    ذخیره مغز فرمان
                    {commandDirty && saveBusy !== 'command' && <DirtyDot />}
                  </Button>
                </div>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* ---------------- 5. live playground ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-bold text-zinc-200">
            <Sparkles className="h-4 w-4 text-amber-400" /> تست زنده مدل
            {provider && (
              <Badge
                title={provider.error || provider.label}
                className={
                  provider.kind === 'zai'
                    ? 'bg-emerald-950/80 text-emerald-300 hover:bg-emerald-950/80'
                    : provider.kind === 'openai'
                      ? 'bg-amber-950/80 text-amber-300 hover:bg-amber-950/80'
                      : 'bg-red-950/80 text-red-300 hover:bg-red-950/80'
                }
              >
                <Cpu className="ml-1 h-3 w-3" /> {provider.label}
                {provider.model ? ` · ${provider.model}` : ''}
              </Badge>
            )}
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <Badge className="bg-zinc-800 text-zinc-400">فقط تست — هیچی به مشتری نمی‌ره</Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPgMsgs([])}
              disabled={pgMsgs.length === 0 && !pgBusy}
              className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
            >
              <Eraser className="h-3.5 w-3.5" /> پاک کردن گفتگو
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
              <p className="text-[11px] font-bold text-zinc-300">شخصیتِ این گفتگو</p>
              <div className="flex gap-1 rounded-md border border-zinc-800 bg-zinc-900 p-0.5">
                <button
                  type="button"
                  onClick={() => setPgMode('draft')}
                  disabled={pgBusy}
                  className={`flex-1 rounded px-2 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-50 ${
                    pgMode === 'draft'
                      ? 'bg-amber-500 text-zinc-950'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  با شخصیت فعلی بالا
                </button>
                <button
                  type="button"
                  onClick={() => setPgMode('default')}
                  disabled={pgBusy}
                  className={`flex-1 rounded px-2 py-1.5 text-[11px] font-bold transition-colors disabled:opacity-50 ${
                    pgMode === 'default'
                      ? 'bg-amber-500 text-zinc-950'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  شخصیت پیش‌فرض
                </button>
              </div>
              <p className="text-[10px] leading-5 text-zinc-500">
                {pgMode === 'draft'
                  ? 'سیستم‌پرامپت = متن فعلیِ کادر «شخصیت دستیار» — حتی اگه هنوز ذخیره‌ش نکردی.'
                  : 'بدون شخصیت سفارشی — دستیار عمومیِ پیش‌فرض سرویس.'}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
              <div className="min-w-0 space-y-1">
                <p className="text-[11px] font-bold text-zinc-300">حالت تفکر</p>
                <p className="text-[10px] leading-5 text-zinc-500">
                  همان کلید بخش «مدل و حالت» — تغییرش اونجا هم غیرذخیره می‌شه.
                </p>
              </div>
              <Switch
                checked={thinking}
                onCheckedChange={setThinking}
                aria-label="حالت تفکر"
                className="data-[state=checked]:bg-amber-500"
              />
            </div>
          </div>

          <Separator className="bg-zinc-800" />

          <div
            ref={chatRef}
            className="flex max-h-96 min-h-40 flex-col gap-2 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-3"
          >
            {pgMsgs.length === 0 && !pgBusy && (
              <p className="my-8 text-center text-xs text-zinc-600">
                یه چیزی ازش بپرس — همین‌جا جواب می‌گیری، بدون این که چیزی به مشتری بره.
              </p>
            )}
            {pgMsgs.map((m, i) => (
              <div
                key={i}
                dir="rtl"
                className={
                  m.role === 'user'
                    ? 'max-w-[85%] self-end whitespace-pre-wrap rounded-xl border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-[13px] leading-7 text-zinc-100'
                    : 'max-w-[85%] self-start whitespace-pre-wrap rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-[13px] leading-7 text-zinc-200'
                }
              >
                {m.content}
              </div>
            ))}
            {pgBusy && (
              <div
                dir="rtl"
                className="flex items-center gap-2 self-start rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-[13px] text-zinc-400"
              >
                <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-400" />
                {thinking ? 'دارم فکر می‌کنم…' : 'در حال پاسخ…'}
              </div>
            )}
          </div>

          <div className="flex items-end gap-2">
            <Textarea
              dir="rtl"
              rows={1}
              value={pgInput}
              onChange={(e) => setPgInput(e.target.value)}
              onKeyDown={onPgKeyDown}
              placeholder="بنویس و Enter بزن (Shift+Enter = خط جدید)"
              className="min-h-10 max-h-32 flex-1 resize-none rounded-lg border-zinc-800 bg-zinc-950 text-[13px] leading-7 text-zinc-200 placeholder:text-zinc-600"
            />
            <Button
              size="icon"
              onClick={() => void sendPlayground()}
              disabled={pgBusy || !pgInput.trim()}
              aria-label="ارسال پیام"
              className="h-10 w-10 shrink-0 bg-amber-500 text-zinc-950 hover:bg-amber-400"
            >
              {pgBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <SendHorizontal className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ---------------- 6. standing instructions (read-only) ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Stamp className="h-4 w-4 text-emerald-400" /> قوانین دائمی مالک ({fa(s.instructions.length)})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {s.instructions.length === 0 ? (
            <p className="text-xs text-zinc-500">هیچ قانون دائمی ثبت نشده.</p>
          ) : (
            <ol className="space-y-2">
              {s.instructions.map((ins, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-[13px] leading-7 text-zinc-300"
                >
                  <span className="ml-2 text-emerald-500">{fa(i + 1)}.</span>
                  {ins}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-[11px] leading-6 text-zinc-500">
            این قوانین با فرمان «یادت باشه که …» توی Saved Messages اضافه می‌شن و با
            «قوانین رو فراموش کن» پاک می‌شن. بعد از هر تغییری، بکاپ خودکار میره تو Saved
            Messages.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
