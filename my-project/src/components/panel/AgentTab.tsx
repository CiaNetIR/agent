'use client'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import {
  Activity,
  Bot,
  ChevronDown,
  Clock,
  Copy,
  Eye,
  FileText,
  Image as ImageIcon,
  ImagePlus,
  Info,
  Loader2,
  MessageSquare,
  MessagesSquare,
  Package,
  Play,
  Plus,
  Radar,
  Receipt,
  RefreshCw,
  Save,
  Send,
  ShoppingCart,
  ToggleLeft,
  Trash2,
  Zap,
} from 'lucide-react'
import { formatUptime, panelFetch, tehranTime, withMediaKey } from '@/lib/panel'
import AgentCapabilities, { type CapabilitiesData } from '@/components/panel/AgentCapabilities'

/* ------------------------------------------------------------------ */
/* types (verified against agent core :3004 + /api/panel/agent proxy) */
/* ------------------------------------------------------------------ */

interface OverviewData {
  ok: boolean
  agent: { version: string; uptimeSec: number; scrapingNow: boolean }
  scraper: {
    enabled: boolean
    script: string
    everyMin: number
    sendTxt: boolean
    lastRun: { status: string; summary: string; at: string } | null
    nextRunAt: string | null
  }
  runs: { id: string; job: string; status: string; summary: string; at: string }[]
  woo: { configured: boolean; site: string; autoSync: boolean; products: number; lastSync: string | null }
  report: {
    enabled: boolean
    time: string
    last: { forDate: string; at: string; sentTg: boolean } | null
  }
  images: {
    quota: number
    usedToday: number
    gallery: { id: string; prompt: string; path: string; at: string }[]
  }
  invoices: {
    today: number
    last: { id: string; number: string; customer: string; total: string; currency: string; status: string; at: string }[]
  }
  support: { enabled: boolean; sessions: number; lastAt: string | null }
  capabilities?: CapabilitiesData
}

interface AgentSettings {
  scraper_enabled: string
  scraper_script: string
  scraper_every_min: string
  scraper_send_txt: string
  telegram_chat: string
  woo_site: string
  woo_key: string
  woo_secret: string
  woo_auto_sync: string
  woo_webhook_secret: string
  report_enabled: string
  report_time: string
  image_enabled?: string
  invoice_auto?: string
  image_quota: string
  image_size: string
  support_enabled: string
  support_store: string
  support_persona: string
  support_welcome: string
  public_base_url: string
  support_site_key?: string
}

interface InvoiceRow {
  id: string
  number: string
  orderId: string | null
  customer: string
  total: string
  currency: string
  status: string
  sentTg: boolean
  at: string
}

interface ImageRow {
  id: string
  prompt: string
  path: string
  at: string
}

interface ReportRow {
  id: string
  forDate: string
  content: string
  sentTg: boolean
  createdAt: string
}

interface WooProductRow {
  sku: string
  wooId: number
  name: string
  price: string
  stock: number
  lastSyncAt: string
}

interface SessionRow {
  id: string
  msgs: number
  lastAt: string
  lastSnippet: string
}

interface ChatMsg {
  id: string
  role: string
  content: string
  at: string
}

/* ------------------------------------------------------------------ */
/* constants + helpers                                                 */
/* ------------------------------------------------------------------ */

const FALLBACK_SIZES = ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440']

const JOB_LABELS: Record<string, string> = {
  scraper: 'اسکرپر',
  woo_sync: 'همگام‌سازی ووکامرس',
  report: 'گزارش روزانه',
  image: 'تولید تصویر',
  invoice: 'فاکتور',
}

const CURRENCY_LABEL: Record<string, string> = {
  IRT: 'تومان',
  USD: 'دلار',
}

function fa(n: number): string {
  try {
    return n.toLocaleString('fa-IR')
  } catch {
    return String(n)
  }
}

function faNumStr(s: string): string {
  const n = Number(s)
  return Number.isFinite(n) ? fa(n) : s
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      timeZone: 'Asia/Tehran',
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function fmtDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat('fa-IR', {
      timeZone: 'Asia/Tehran',
      dateStyle: 'medium',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

/** POST helper: { op, data? } → { res, json } — json never throws ({} on bad body) */
async function postOp<T>(op: string, data?: Record<string, unknown>): Promise<{
  res: Response
  json: T & { ok?: boolean; error?: string }
}> {
  const res = await panelFetch('/api/panel/agent', {
    method: 'POST',
    body: JSON.stringify(data ? { op, data } : { op }),
  })
  const json = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string }
  return { res, json }
}

/* ------------------------------------------------------------------ */
/* small presentational helpers                                        */
/* ------------------------------------------------------------------ */

function EnabledBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Badge className="bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">فعال</Badge>
  ) : (
    <Badge className="bg-zinc-700/40 text-zinc-300 ring-1 ring-zinc-600/50">غیرفعال</Badge>
  )
}

function RunStatusBadge({ status }: { status: string }) {
  if (status === 'ok')
    return <Badge className="bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">موفق</Badge>
  if (status === 'error')
    return <Badge className="bg-red-500/15 text-red-300 ring-1 ring-red-500/40">خطا</Badge>
  if (status === 'running')
    return <Badge className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40">در حال اجرا</Badge>
  return <Badge className="bg-zinc-700/40 text-zinc-300 ring-1 ring-zinc-600/50">رد شد</Badge>
}

function InvoiceStatusBadge({ status }: { status: string }) {
  if (status === 'paid')
    return <Badge className="bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">پرداخت شده</Badge>
  if (status === 'pending')
    return <Badge className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40">در انتظار پرداخت</Badge>
  return <Badge className="bg-zinc-700/40 text-zinc-300 ring-1 ring-zinc-600/50">صادرشده</Badge>
}

function SentTgBadge({ sent }: { sent: boolean }) {
  return sent ? (
    <Badge className="bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">ارسال شد</Badge>
  ) : (
    <Badge className="bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700">ارسال نشد</Badge>
  )
}

/** shared "settings not loaded" fallback for settings sections */
function NoSettings({ onRetry }: { onRetry: () => void }) {
  return (
    <Card className="border-dashed border-zinc-800 bg-zinc-900/40">
      <CardContent className="flex flex-col items-center gap-2 p-6 text-center">
        <Bot className="h-7 w-7 text-zinc-600" />
        <p className="text-xs font-bold text-zinc-300">تنظیمات ایجنت دریافت نشد</p>
        <p className="max-w-sm text-[11px] leading-5 text-zinc-500">
          سرویس ایجنت جواب نداد — دکمهٔ زیر یا «رفرش» بالای تب رو بزن.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
        >
          <RefreshCw className="h-3.5 w-3.5" /> تلاش دوباره
        </Button>
      </CardContent>
    </Card>
  )
}

/** shared loading / error / empty placeholder for list sections */
function ListPlaceholder({
  loading,
  onRetry,
  emptyText,
}: {
  loading: boolean
  onRetry?: () => void
  emptyText?: string
}) {
  if (loading) {
    return (
      <div className="flex h-24 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
      </div>
    )
  }
  if (onRetry) {
    return (
      <div className="flex flex-col items-center gap-2 py-6 text-center">
        <p className="text-xs text-zinc-500">دریافت نشد</p>
        <Button
          variant="outline"
          size="sm"
          onClick={onRetry}
          className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
        >
          <RefreshCw className="h-3.5 w-3.5" /> تلاش دوباره
        </Button>
      </div>
    )
  }
  return <p className="py-6 text-center text-xs text-zinc-500">{emptyText}</p>
}

function InfoNote({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-[11px] leading-6 text-zinc-400 [&_code]:font-mono [&_code]:text-zinc-200">
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* invoice create dialog                                               */
/* ------------------------------------------------------------------ */

interface InvoiceItemRow {
  rid: number
  name: string
  qty: string
  price: string
}

let itemSeq = 0
function newInvoiceItem(): InvoiceItemRow {
  itemSeq += 1
  return { rid: itemSeq, name: '', qty: '1', price: '' }
}

function InvoiceCreateDialog({
  onOpenChange,
  onDone,
}: {
  onOpenChange: (open: boolean) => void
  onDone: () => void
}) {
  const { toast } = useToast()
  const [customer, setCustomer] = useState('')
  const [items, setItems] = useState<InvoiceItemRow[]>(() => [newInvoiceItem()])
  const [currency, setCurrency] = useState<'IRT' | 'USD'>('IRT')
  const [sendTg, setSendTg] = useState(true)
  const [saving, setSaving] = useState(false)

  function patchItem(rid: number, patch: Partial<InvoiceItemRow>) {
    setItems((arr) => arr.map((it) => (it.rid === rid ? { ...it, ...patch } : it)))
  }

  async function submit() {
    const rows = items.filter((it) => it.name.trim())
    if (rows.length === 0) {
      toast({
        title: 'حداقل یک ردیف کالا لازم است',
        description: 'نام ردیف‌های خالی رو پر کن یا حذف‌شون کن.',
        variant: 'destructive',
      })
      return
    }
    for (let i = 0; i < items.length; i++) {
      const it = items[i]
      if (!it.name.trim()) continue
      const qty = Number.parseInt(it.qty, 10)
      if (!Number.isFinite(qty) || qty < 1) {
        toast({
          title: `تعداد ردیف ${fa(i + 1)} نامعتبره`,
          description: 'تعداد باید عددی حداقل ۱ باشه.',
          variant: 'destructive',
        })
        return
      }
      const price = Number(it.price)
      if (!Number.isFinite(price) || price < 0) {
        toast({
          title: `قیمت ردیف ${fa(i + 1)} نامعتبره`,
          description: 'قیمت باید عدد معتبر (میتونه صفر) باشه.',
          variant: 'destructive',
        })
        return
      }
    }

    setSaving(true)
    try {
      const { res, json } = await postOp<{ invoice?: { number: string; total: string } }>('invoice-create', {
        customer: customer.trim() || 'مشتری',
        items: rows.map((it) => ({
          name: it.name.trim(),
          qty: Number.parseInt(it.qty, 10) || 1,
          price: it.price.trim() || '0',
        })),
        currency,
        sendTg,
      })
      if (!res.ok || !json.ok) {
        toast({ title: 'فاکتور ساخته نشد', description: json.error, variant: 'destructive' })
      } else {
        toast({
          title: 'فاکتور ساخته شد ✓',
          description: `شماره ${json.invoice?.number ?? '—'} — مبلغ ${faNumStr(json.invoice?.total ?? '0')} ${CURRENCY_LABEL[currency] ?? currency}${sendTg ? ' — به تلگرام هم رفت.' : ''}`,
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
          <DialogTitle className="text-sm text-zinc-100">فاکتور دستی</DialogTitle>
          <DialogDescription className="text-[11px] leading-5">
            فاکتور HTML راست‌به‌چپ با شماره‌گذاری خودکار می‌سازه{sendTg ? ' و به تلگرام می‌فرسته' : ''}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="inv-customer" className="text-xs text-zinc-300">
              نام مشتری
            </Label>
            <Input
              id="inv-customer"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="مثلاً علی رضایی"
              maxLength={120}
              className="h-8 border-zinc-700 bg-zinc-950 text-xs text-zinc-100 placeholder:text-zinc-600"
            />
          </div>

          <div className="space-y-2">
            {items.map((it, i) => (
              <div key={it.rid} className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] font-bold text-zinc-300">ردیف {fa(i + 1)}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setItems((arr) => arr.filter((x) => x.rid !== it.rid))}
                    disabled={items.length === 1}
                    className="h-7 border-red-900/60 bg-red-950/30 text-[10px] text-red-300 hover:bg-red-950/50"
                  >
                    <Trash2 className="h-3 w-3" /> حذف
                  </Button>
                </div>
                <Label htmlFor={`inv-name-${it.rid}`} className="sr-only">
                  نام کالا / خدمات
                </Label>
                <Input
                  id={`inv-name-${it.rid}`}
                  value={it.name}
                  onChange={(e) => patchItem(it.rid, { name: e.target.value })}
                  placeholder="نام کالا / خدمات"
                  maxLength={120}
                  className="h-8 border-zinc-700 bg-zinc-950 text-xs text-zinc-100 placeholder:text-zinc-600"
                />
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`inv-qty-${it.rid}`} className="text-[10px] text-zinc-500">تعداد</Label>
                    <Input
                      id={`inv-qty-${it.rid}`}
                      type="number"
                      dir="ltr"
                      inputMode="numeric"
                      min={1}
                      value={it.qty}
                      onChange={(e) => patchItem(it.rid, { qty: e.target.value })}
                      className="h-8 border-zinc-700 bg-zinc-950 text-center text-xs text-zinc-100"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`inv-price-${it.rid}`} className="text-[10px] text-zinc-500">قیمت واحد</Label>
                    <Input
                      id={`inv-price-${it.rid}`}
                      type="number"
                      dir="ltr"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      value={it.price}
                      onChange={(e) => patchItem(it.rid, { price: e.target.value })}
                      placeholder="0"
                      className="h-8 border-zinc-700 bg-zinc-950 text-center text-xs text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>
                </div>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setItems((arr) => [...arr, newInvoiceItem()])}
              className="h-8 w-full border-dashed border-zinc-700 bg-zinc-950 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              <Plus className="h-3.5 w-3.5" /> ردیف جدید
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-300">واحد پول</Label>
            <Select value={currency} onValueChange={(v) => setCurrency(v === 'USD' ? 'USD' : 'IRT')}>
              <SelectTrigger className="h-8 w-full border-zinc-700 bg-zinc-950 text-xs text-zinc-100">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-200">
                <SelectItem value="IRT" className="text-xs focus:bg-zinc-800">
                  تومان (IRT)
                </SelectItem>
                <SelectItem value="USD" className="text-xs focus:bg-zinc-800">
                  دلار (USD)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
            <div className="min-w-0 space-y-1">
              <p className="text-xs font-bold text-zinc-200">ارسال به تلگرام</p>
              <p className="text-[10px] leading-5 text-zinc-500">
                فایل HTML فاکتور از طریق دستیار تلگرام به مقصد «ایجنت» می‌ره.
              </p>
            </div>
            <Switch
              checked={sendTg}
              onCheckedChange={setSendTg}
              className="data-[state=checked]:bg-emerald-600"
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
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
            ساخت فاکتور
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* support chat dialog                                                 */
/* ------------------------------------------------------------------ */

function SupportChatDialog({
  session,
  onOpenChange,
}: {
  session: SessionRow
  onOpenChange: (open: boolean) => void
}) {
  const { toast } = useToast()
  const [messages, setMessages] = useState<ChatMsg[] | null>(null)
  const [loading, setLoading] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await panelFetch(
        `/api/panel/agent?op=support-messages&sessionId=${encodeURIComponent(session.id)}`
      )
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        messages?: ChatMsg[]
        error?: string
      }
      if (!res.ok || !json.ok) {
        toast({ title: 'پیام‌ها دریافت نشد', description: json.error, variant: 'destructive' })
      } else {
        setMessages(json.messages ?? [])
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [session.id, toast])

  useEffect(() => {
    void load()
  }, [load])

  // newest message visible without scrolling — run after the thread renders
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, loading])

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[88vh] border-zinc-800 bg-zinc-950 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-sm text-zinc-100">گفتگوی پشتیبانی سایت</DialogTitle>
          <DialogDescription className="text-[11px]">
            آخرین فعالیت {fmtDateTime(session.lastAt)} — {fa(session.msgs)} پیام
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center gap-4 text-[10px] text-zinc-500">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-zinc-500" /> مشتری (خاکستری)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> دستیار (سبز)
          </span>
        </div>

        <div
          ref={scrollRef}
          dir="rtl"
          className="max-h-[55vh] space-y-2 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900/60 p-3"
        >
          {messages === null ? (
            loading ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-400" />
              </div>
            ) : (
              <ListPlaceholder loading={false} onRetry={() => void load()} />
            )
          ) : messages.length === 0 ? (
            <p className="py-6 text-center text-xs text-zinc-500">پیامی ثبت نشده</p>
          ) : (
            messages.map((m) => {
              const isUser = m.role === 'user'
              return (
                <div key={m.id} className="flex">
                  {/* user (مشتری) → چپ · assistant (دستیار) → راست */}
                  <div
                    className={
                      isUser
                        ? 'mr-auto max-w-[85%] rounded-2xl rounded-bl-sm bg-zinc-800 px-3 py-2 text-xs leading-6 text-zinc-200'
                        : 'ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-emerald-950/60 px-3 py-2 text-xs leading-6 text-emerald-100 ring-1 ring-emerald-800/50'
                    }
                  >
                    <p className="whitespace-pre-wrap break-words" dir="auto">
                      {m.content}
                    </p>
                    <p
                      className={`mt-1 text-left text-[9px] tabular-nums ${isUser ? 'text-zinc-500' : 'text-emerald-500/80'}`}
                      dir="ltr"
                    >
                      {tehranTime(m.at)}
                    </p>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* main tab                                                            */
/* ------------------------------------------------------------------ */

export default function AgentTab() {
  const { toast } = useToast()

  /* ---------- overview + settings ---------- */
  const [overview, setOverview] = useState<OverviewData | null>(null)
  const [ovLoading, setOvLoading] = useState(true)
  const [settings, setSettings] = useState<AgentSettings | null>(null)
  const [sizes, setSizes] = useState<string[]>(FALLBACK_SIZES)

  /* ---------- editable settings fields ---------- */
  const [scEnabled, setScEnabled] = useState(true)
  const [scScript, setScScript] = useState('')
  const [scEveryMin, setScEveryMin] = useState('30')
  const [scSendTxt, setScSendTxt] = useState(true)
  const [tgChat, setTgChat] = useState('me')

  const [wooSite, setWooSite] = useState('')
  const [wooKey, setWooKey] = useState('')
  const [wooSecret, setWooSecret] = useState('')
  const [origWooKey, setOrigWooKey] = useState('')
  const [origWooSecret, setOrigWooSecret] = useState('')
  const [wooAutoSync, setWooAutoSync] = useState(false)
  const [webhookSecret, setWebhookSecret] = useState('')
  const [wooTestRes, setWooTestRes] = useState<{ ok: boolean; detail: string } | null>(null)
  const [wooSyncRes, setWooSyncRes] = useState<{
    total: number
    created: number
    updated: number
    unchanged: number
    errors: string[]
  } | null>(null)

  const [repEnabled, setRepEnabled] = useState(true)
  const [repTime, setRepTime] = useState('08:30')
  const [reportResult, setReportResult] = useState<{ content: string; sentTg: boolean } | null>(null)

  const [imgQuota, setImgQuota] = useState('150')
  const [imgDefaultSize, setImgDefaultSize] = useState('1024x1024')

  const [supEnabled, setSupEnabled] = useState(true)
  const [supStore, setSupStore] = useState('')
  const [supWelcome, setSupWelcome] = useState('')
  const [supPersona, setSupPersona] = useState('')
  const [publicBaseUrl, setPublicBaseUrl] = useState('')
  const [siteKey, setSiteKey] = useState('')

  /* ---------- image generate form ---------- */
  const [imgPrompt, setImgPrompt] = useState('')
  const [imgCount, setImgCount] = useState('1')
  const [imgSize, setImgSize] = useState('1024x1024')
  const [imgSendTg, setImgSendTg] = useState(false)

  /* ---------- list data ---------- */
  const [invoices, setInvoices] = useState<InvoiceRow[] | null>(null)
  const [imagesData, setImagesData] = useState<{ images: ImageRow[]; usedToday: number; quota: number } | null>(null)
  const [reports, setReports] = useState<ReportRow[] | null>(null)
  const [wooProducts, setWooProducts] = useState<WooProductRow[] | null>(null)
  const [sessions, setSessions] = useState<SessionRow[] | null>(null)
  const [openReports, setOpenReports] = useState<Record<string, boolean>>({})

  /* ---------- busy map + dialogs ---------- */
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [createSeq, setCreateSeq] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const [invoiceHtml, setInvoiceHtml] = useState<{ url: string; number: string } | null>(null)
  const [chatSession, setChatSession] = useState<SessionRow | null>(null)

  const mountedRef = useRef(true)
  const inFlight = useRef(0)
  const htmlUrlRef = useRef<string | null>(null)

  /* ------------------------------ loaders ----------------------------- */

  const applySettings = useCallback((s: AgentSettings, sz: string[], onlyKeys?: string[]) => {
    setSettings(s)
    if (sz.length) setSizes(sz)
    // scoped apply: when onlyKeys is given (a save/reload of SPECIFIC keys),
    // leave every other form field untouched — otherwise a capability toggle
    // or a scraper-save would silently wipe the owner's unsaved edits in every
    // other sub-tab form (support persona, woo creds, report time, …)
    const wants = (k: string) => !onlyKeys || onlyKeys.includes(k)
    if (wants('scraper_enabled')) setScEnabled(s.scraper_enabled === '1')
    if (wants('scraper_script')) setScScript(s.scraper_script || '')
    if (wants('scraper_every_min')) setScEveryMin(s.scraper_every_min || '30')
    if (wants('scraper_send_txt')) setScSendTxt(s.scraper_send_txt === '1')
    if (wants('telegram_chat')) setTgChat(s.telegram_chat || 'me')
    if (wants('woo_site')) setWooSite(s.woo_site || '')
    if (wants('woo_key')) {
      setWooKey(s.woo_key || '')
      setOrigWooKey(s.woo_key || '')
    }
    if (wants('woo_secret')) {
      setWooSecret(s.woo_secret || '')
      setOrigWooSecret(s.woo_secret || '')
    }
    if (wants('woo_auto_sync')) setWooAutoSync(s.woo_auto_sync === '1')
    if (wants('woo_webhook_secret')) setWebhookSecret(s.woo_webhook_secret || '')
    if (wants('report_enabled')) setRepEnabled(s.report_enabled === '1')
    if (wants('report_time')) setRepTime(s.report_time || '08:30')
    if (wants('image_quota')) setImgQuota(s.image_quota || '150')
    if (wants('image_size')) {
      setImgDefaultSize(s.image_size || '1024x1024')
      setImgSize(s.image_size || '1024x1024')
    }
    if (wants('support_enabled')) setSupEnabled(s.support_enabled === '1')
    if (wants('support_store')) setSupStore(s.support_store || '')
    if (wants('support_welcome')) setSupWelcome(s.support_welcome || '')
    if (wants('support_persona')) setSupPersona(s.support_persona || '')
    if (wants('public_base_url')) setPublicBaseUrl(s.public_base_url || '')
    if (wants('support_site_key')) setSiteKey(s.support_site_key || '')
  }, [])

  const loadOverview = useCallback(
    async (silent = false) => {
      if (!silent) setOvLoading(true)
      try {
        const res = await panelFetch('/api/panel/agent?op=overview')
        const json = (await res.json()) as OverviewData & { error?: string }
        if (!res.ok || !json.ok) {
          if (!silent) toast({ title: 'خطا', description: json.error, variant: 'destructive' })
        } else if (mountedRef.current) {
          setOverview(json)
        }
      } catch {
        if (!silent) toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
      } finally {
        if (!silent) setOvLoading(false)
      }
    },
    [toast]
  )

  const loadSettings = useCallback(
    async (silent = false, onlyKeys?: string[]) => {
      try {
        const res = await panelFetch('/api/panel/agent?op=settings')
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean
          settings?: AgentSettings
          sizes?: string[]
          error?: string
        }
        if (!res.ok || !json.ok || !json.settings) {
          if (!silent) toast({ title: 'خواندن تنظیمات نشد', description: json.error, variant: 'destructive' })
        } else if (mountedRef.current) {
          applySettings(json.settings, json.sizes || [], onlyKeys)
        }
      } catch {
        if (!silent) toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
      }
    },
    [applySettings, toast]
  )

  useEffect(() => {
    mountedRef.current = true
    void loadOverview()
    void loadSettings()
    const t = setInterval(() => {
      if (inFlight.current === 0) void loadOverview(true)
    }, 30_000)
    return () => {
      mountedRef.current = false
      clearInterval(t)
      if (htmlUrlRef.current) {
        URL.revokeObjectURL(htmlUrlRef.current)
        htmlUrlRef.current = null
      }
    }
  }, [])

  /* ------------------------------ busy helper ------------------------- */

  function setBusyKey(key: string, on: boolean) {
    setBusy((b) => {
      const nb = { ...b }
      if (on) nb[key] = true
      else delete nb[key]
      return nb
    })
  }

  /** wrap an async action: busy flag + in-flight guard + network-error toast */
  async function run(key: string, fn: () => Promise<void>): Promise<void> {
    setBusyKey(key, true)
    inFlight.current += 1
    try {
      await fn()
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      inFlight.current -= 1
      setBusyKey(key, false)
    }
  }

  async function copyText(text: string, what: string) {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast({ title: `${what} کپی شد ✓` })
    } catch {
      toast({
        title: 'کپی نشد',
        description: 'مرورگر اجازه نداد — دستی انتخاب و کپی کن.',
        variant: 'destructive',
      })
    }
  }

  /* ------------------------------ list fetchers ----------------------- */

  async function fetchInvoices() {
    await run('invoices', async () => {
      const res = await panelFetch('/api/panel/agent?op=invoices&limit=30')
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        invoices?: InvoiceRow[]
        error?: string
      }
      if (!res.ok || !json.ok) {
        toast({ title: 'فاکتورها دریافت نشد', description: json.error, variant: 'destructive' })
      } else {
        setInvoices(json.invoices ?? [])
      }
    })
  }

  async function fetchImages() {
    await run('images', async () => {
      const res = await panelFetch('/api/panel/agent?op=images&limit=24')
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        images?: ImageRow[]
        usedToday?: number
        quota?: number
        error?: string
      }
      if (!res.ok || !json.ok) {
        toast({ title: 'تصاویر دریافت نشد', description: json.error, variant: 'destructive' })
      } else {
        setImagesData({
          images: json.images ?? [],
          usedToday: json.usedToday ?? 0,
          quota: json.quota ?? 0,
        })
      }
    })
  }

  async function fetchReports() {
    await run('reports', async () => {
      const res = await panelFetch('/api/panel/agent?op=reports&limit=10')
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        reports?: ReportRow[]
        error?: string
      }
      if (!res.ok || !json.ok) {
        toast({ title: 'گزارش‌ها دریافت نشد', description: json.error, variant: 'destructive' })
      } else {
        setReports(json.reports ?? [])
      }
    })
  }

  async function fetchWooProducts() {
    await run('products', async () => {
      const res = await panelFetch('/api/panel/agent?op=woo-products&limit=50')
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        products?: WooProductRow[]
        error?: string
      }
      if (!res.ok || !json.ok) {
        toast({ title: 'محصولات دریافت نشد', description: json.error, variant: 'destructive' })
      } else {
        setWooProducts(json.products ?? [])
      }
    })
  }

  async function fetchSessions() {
    await run('sessions', async () => {
      const res = await panelFetch('/api/panel/agent?op=support-sessions')
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        sessions?: SessionRow[]
        error?: string
      }
      if (!res.ok || !json.ok) {
        toast({ title: 'گفتگوها دریافت نشد', description: json.error, variant: 'destructive' })
      } else {
        setSessions(json.sessions ?? [])
      }
    })
  }

  function handleTabChange(v: string) {
    if (v === 'woo' && wooProducts === null) void fetchWooProducts()
    else if (v === 'report' && reports === null) void fetchReports()
    else if (v === 'invoices' && invoices === null) void fetchInvoices()
    else if (v === 'images' && imagesData === null) void fetchImages()
    else if (v === 'support' && sessions === null) void fetchSessions()
  }

  /* ------------------------------ actions ----------------------------- */

  async function saveSettingsKeys(
    payload: Record<string, string>,
    busyKey: string,
    okTitle: string,
    okDesc?: string
  ) {
    await run(busyKey, async () => {
      const { res, json } = await postOp('settings', payload)
      if (!res.ok || !json.ok) {
        toast({ title: 'ذخیره نشد', description: json.error, variant: 'destructive' })
      } else {
        toast({ title: okTitle, description: okDesc ?? 'از الان اعمال شد.' })
        // re-apply ONLY the saved keys — never touch unsaved edits elsewhere
        void loadSettings(true, Object.keys(payload))
      }
    })
  }

  async function saveScraperSettings() {
    const script = scScript.trim()
    if (!script.startsWith('/home/z/')) {
      toast({
        title: 'مسیر اسکریپت نامعتبر',
        description: 'باید با /home/z/ شروع بشه — مسیرهای بیرون از محیط رد می‌شن.',
        variant: 'destructive',
      })
      return
    }
    const every = Number.parseInt(scEveryMin, 10)
    if (!Number.isFinite(every) || every < 5 || every > 1440) {
      toast({
        title: 'بازهٔ اجرا نامعتبر',
        description: 'بازه باید بین ۵ تا ۱۴۴۰ دقیقه باشه.',
        variant: 'destructive',
      })
      return
    }
    await saveSettingsKeys(
      {
        scraper_enabled: scEnabled ? '1' : '0',
        scraper_script: script,
        scraper_every_min: String(every),
        scraper_send_txt: scSendTxt ? '1' : '0',
        telegram_chat: tgChat.trim() || 'me',
      },
      'save-scraper',
      'تنظیمات اسکرپر ذخیره شد ✓'
    )
  }

  async function runScraperNow() {
    await run('run-scraper', async () => {
      const { res, json } = await postOp<{ summary?: string }>('scraper-run')
      if (!res.ok || !json.ok) {
        toast({ title: 'اجرا نشد', description: json.summary || json.error, variant: 'destructive' })
      } else {
        toast({ title: 'اسکرپر اجرا شد ✓', description: json.summary })
      }
    })
    void loadOverview(true)
  }

  /** woo payload — masked «…» key/secret coming back unchanged = keep the old value */
  function wooPayload(): Record<string, string> {
    const payload: Record<string, string> = {
      woo_site: wooSite.trim(),
      woo_auto_sync: wooAutoSync ? '1' : '0',
    }
    if (wooKey !== origWooKey) payload.woo_key = wooKey.trim()
    if (wooSecret !== origWooSecret) payload.woo_secret = wooSecret.trim()
    return payload
  }

  async function saveWooSettings() {
    await saveSettingsKeys(
      wooPayload(),
      'save-woo',
      'تنظیمات ووکامرس ذخیره شد ✓',
      'کلید و رمز فقط وقتی ذخیره می‌شن که عوض‌شون کرده باشی.'
    )
  }

  async function testWoo() {
    await run('woo-test', async () => {
      // save the form first so the test hits exactly these creds
      const payload = wooPayload()
      const sres = await panelFetch('/api/panel/agent', {
        method: 'POST',
        body: JSON.stringify({ op: 'settings', data: payload }),
      })
      const sjson = (await sres.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!sres.ok || !sjson.ok) {
        toast({ title: 'ذخیره تنظیمات نشد', description: sjson.error, variant: 'destructive' })
        return
      }
      void loadSettings(true, Object.keys(payload))
      const { res, json } = await postOp<{ detail?: string }>('woo-test')
      const ok = res.ok && !!json.ok
      setWooTestRes({ ok, detail: json.detail || json.error || 'پاسخ نامعتبر از سرویس' })
      toast({
        title: ok ? 'اتصال موفق ✓' : 'اتصال برقرار نشد',
        description: json.detail || json.error,
        variant: ok ? undefined : 'destructive',
      })
    })
  }

  async function syncWoo() {
    await run('woo-sync', async () => {
      const { res, json } = await postOp<{
        total?: number
        created?: number
        updated?: number
        unchanged?: number
        errors?: string[]
      }>('woo-sync')
      if (!res.ok || !json.ok) {
        setWooSyncRes(null)
        toast({ title: 'همگام‌سازی نشد', description: json.error, variant: 'destructive' })
      } else {
        setWooSyncRes({
          total: json.total ?? 0,
          created: json.created ?? 0,
          updated: json.updated ?? 0,
          unchanged: json.unchanged ?? 0,
          errors: json.errors ?? [],
        })
        toast({
          title: 'همگام‌سازی انجام شد ✓',
          description: `${fa(json.created ?? 0)} ساخته‌شده · ${fa(json.updated ?? 0)} به‌روز‌شده · ${fa(json.unchanged ?? 0)} بدون تغییر`,
        })
      }
    })
    void fetchWooProducts()
    void loadOverview(true)
  }

  async function saveReportSettings() {
    if (!/^\d{1,2}:\d{2}$/.test(repTime)) {
      toast({
        title: 'ساعت گزارش نامعتبر',
        description: 'یک ساعت معتبر (مثل 08:30) انتخاب کن.',
        variant: 'destructive',
      })
      return
    }
    await saveSettingsKeys(
      { report_enabled: repEnabled ? '1' : '0', report_time: repTime },
      'save-report',
      'تنظیمات گزارش ذخیره شد ✓'
    )
  }

  async function runReportNow() {
    await run('report-now', async () => {
      const { res, json } = await postOp<{ report?: { content: string; sentTg: boolean } }>('report-now')
      if (!res.ok || !json.ok || !json.report) {
        toast({ title: 'ساخت گزارش نشد', description: json.error, variant: 'destructive' })
      } else {
        setReportResult(json.report)
        toast({
          title: 'گزارش ساخته شد ✓',
          description: json.report.sentTg ? 'به تلگرام هم ارسال شد.' : 'ارسال تلگرام انجام نشد — صف ارسال رو چک کن.',
        })
      }
    })
    void fetchReports()
    void loadOverview(true)
  }

  async function saveImageSettings() {
    const q = Number.parseInt(imgQuota, 10)
    if (!Number.isFinite(q) || q < 1 || q > 1000) {
      toast({
        title: 'سهمیه نامعتبر',
        description: 'سهمیهٔ روزانه باید بین ۱ تا ۱۰۰۰ تصویر باشه.',
        variant: 'destructive',
      })
      return
    }
    await saveSettingsKeys(
      { image_quota: String(q), image_size: imgDefaultSize },
      'save-image',
      'تنظیمات تصویر ذخیره شد ✓'
    )
  }

  async function generateImage() {
    if (!imgPrompt.trim()) {
      toast({ title: 'توضیح تصویر لازم است', variant: 'destructive' })
      return
    }
    await run('generate', async () => {
      const { res, json } = await postOp<{ images?: { id: string }[]; errors?: string[] }>(
        'image-generate',
        { prompt: imgPrompt.trim(), count: Number(imgCount) || 1, size: imgSize, sendTg: imgSendTg }
      )
      if (res.ok && json.ok) {
        toast({
          title: `${fa((json.images ?? []).length)} تصویر ساخته شد ✓`,
          description: json.errors?.length
            ? `${fa(json.errors.length)} مورد خطا داشت — می‌تونی دوباره امتحان کنی.`
            : undefined,
        })
      } else {
        toast({
          title: 'تولید تصویر نشد',
          description: json.error || json.errors?.[0],
          variant: 'destructive',
        })
      }
    })
    void fetchImages()
    void loadOverview(true)
  }

  async function sendImage(id: string) {
    await run(`send-${id}`, async () => {
      const { res, json } = await postOp('image-send', { id })
      if (!res.ok || !json.ok) {
        toast({ title: 'ارسال نشد', description: json.error, variant: 'destructive' })
      } else {
        toast({
          title: 'به صف ارسال تلگرام اضافه شد ✓',
          description: 'دستیار تلگرام تا چند ثانیهٔ دیگه می‌فرستتش.',
        })
      }
    })
  }

  async function saveSupportSettings() {
    await saveSettingsKeys(
      {
        support_enabled: supEnabled ? '1' : '0',
        support_store: supStore.trim(),
        support_persona: supPersona,
        support_welcome: supWelcome.trim(),
        public_base_url: publicBaseUrl.trim(),
      },
      'save-support',
      'تنظیمات پشتیبانی ذخیره شد ✓'
    )
  }

  /* ------------------------------ invoice html view ------------------- */

  async function viewInvoice(id: string, number: string) {
    await run(`view-${id}`, async () => {
      const res = await panelFetch(`/api/panel/agent?op=invoice-html&id=${encodeURIComponent(id)}`)
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string }
        toast({ title: 'گشودن فاکتور نشد', description: json.error, variant: 'destructive' })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      // revoke the PREVIOUS open invoice's URL before replacing (leak fix)
      if (htmlUrlRef.current) URL.revokeObjectURL(htmlUrlRef.current)
      htmlUrlRef.current = url
      setInvoiceHtml({ url, number })
    })
  }

  function closeInvoiceHtml() {
    if (htmlUrlRef.current) URL.revokeObjectURL(htmlUrlRef.current)
    htmlUrlRef.current = null
    setInvoiceHtml(null)
  }

  /* ------------------------------ derived ----------------------------- */

  const savedBaseUrl = (settings?.public_base_url || '').replace(/\/+$/, '')
  const hookUrl =
    savedBaseUrl && webhookSecret
      ? `${savedBaseUrl}/api/agent-pub/woo-order?secret=${webhookSecret}`
      : ''
  const widgetCode =
    savedBaseUrl && siteKey
      ? `<script src="${savedBaseUrl}/api/agent-pub/widget.js?key=${siteKey}" defer></script>`
      : ''

  const usedToday = imagesData?.usedToday ?? overview?.images.usedToday ?? 0
  const imgQuotaNum = imagesData?.quota ?? overview?.images.quota ?? 0
  const imgQuotaPct = imgQuotaNum > 0 ? Math.min(100, (usedToday / imgQuotaNum) * 100) : 0

  const ov = overview

  /* ------------------------------ render ------------------------------ */

  return (
    <div className="space-y-4">
      {/* ---------------- header ---------------- */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Bot className="h-4 w-4 text-emerald-400" /> ایجنت — هستهٔ سرویس
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {ov?.agent.scrapingNow ? (
              <Badge className="bg-amber-500/15 text-amber-300 ring-1 ring-amber-500/40">
                <Loader2 className="h-3 w-3 animate-spin" /> اسکرپ در حال اجرا
              </Badge>
            ) : null}
            <Badge className="bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700">
              نسخه <span dir="ltr">v{ov?.agent.version ?? '—'}</span>
            </Badge>
            <Badge className="bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700">
              آپتایم {formatUptime(ov?.agent.uptimeSec ?? null)}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void loadOverview()
                void loadSettings()
              }}
              className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${ovLoading ? 'animate-spin' : ''}`} /> رفرش
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-xs leading-6 text-zinc-400">
            مرکز کنترل ایجنت: اسکرپر زمان‌بندی‌شده، همگام‌سازی ووکامرس، گزارش روزانهٔ حسابداری، فاکتور
            لحظه‌ای، تولید تصویر و پشتیبانی سایت — همه از همین‌جا.
          </p>
          <p className="text-[10px] leading-5 text-zinc-600">
            آمار تب «وضعیت» هر ۳۰ ثانیه خودکار رفرش می‌شه؛ بقیهٔ تب‌ها دکمهٔ رفرش خودشون رو دارن.
          </p>
        </CardContent>
      </Card>

      {/* ---------------- inner tabs ---------------- */}
      <Tabs defaultValue="caps" dir="rtl" onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid h-auto w-full grid-cols-4 gap-1 rounded-xl border border-zinc-800 bg-zinc-900/70 p-1 sm:grid-cols-8">
          <TabsTrigger
            value="caps"
            className="gap-1 rounded-lg px-1 py-2 text-[11px] font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
          >
            <ToggleLeft className="h-3.5 w-3.5" /> قابلیت‌ها
          </TabsTrigger>
          <TabsTrigger
            value="overview"
            className="gap-1 rounded-lg px-1 py-2 text-[11px] font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
          >
            <Activity className="h-3.5 w-3.5" /> وضعیت
          </TabsTrigger>
          <TabsTrigger
            value="scraper"
            className="gap-1 rounded-lg px-1 py-2 text-[11px] font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
          >
            <Radar className="h-3.5 w-3.5" /> اسکرپر
          </TabsTrigger>
          <TabsTrigger
            value="woo"
            className="gap-1 rounded-lg px-1 py-2 text-[11px] font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
          >
            <ShoppingCart className="h-3.5 w-3.5" /> ووکامرس
          </TabsTrigger>
          <TabsTrigger
            value="report"
            className="gap-1 rounded-lg px-1 py-2 text-[11px] font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
          >
            <FileText className="h-3.5 w-3.5" /> گزارش روزانه
          </TabsTrigger>
          <TabsTrigger
            value="invoices"
            className="gap-1 rounded-lg px-1 py-2 text-[11px] font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
          >
            <Receipt className="h-3.5 w-3.5" /> فاکتورها
          </TabsTrigger>
          <TabsTrigger
            value="images"
            className="gap-1 rounded-lg px-1 py-2 text-[11px] font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
          >
            <ImagePlus className="h-3.5 w-3.5" /> تصاویر
          </TabsTrigger>
          <TabsTrigger
            value="support"
            className="gap-1 rounded-lg px-1 py-2 text-[11px] font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white"
          >
            <MessagesSquare className="h-3.5 w-3.5" /> پشتیبانی سایت
          </TabsTrigger>
        </TabsList>

        {/* ================ 0. قابلیت‌ها ================ */}
        <TabsContent value="caps" className="mt-4 space-y-4">
          <AgentCapabilities
            overview={overview}
            loading={ovLoading}
            onRefresh={() => void loadOverview()}
            onChanged={(keys) => {
              void loadOverview(true)
              // only the toggled capability key is refreshed — unsaved edits
              // in other forms stay intact
              if (keys && keys.length) void loadSettings(true, keys)
            }}
          />
        </TabsContent>

        {/* ================ 1. وضعیت ================ */}
        <TabsContent value="overview" className="mt-4 space-y-4">
          {ov === null ? (
            ovLoading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
              </div>
            ) : (
              <Card className="border-dashed border-zinc-800 bg-zinc-900/40">
                <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
                  <Bot className="h-8 w-8 text-zinc-600" />
                  <p className="text-sm font-bold text-zinc-300">وضعیت ایجنت دریافت نشد</p>
                  <p className="max-w-sm text-xs leading-6 text-zinc-500">
                    سرویس ایجنت (:3004) جواب نداد یا رمز پنل رد شد — دوباره تلاش کن.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void loadOverview()}
                    className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                  >
                    <RefreshCw className="h-3.5 w-3.5" /> تلاش دوباره
                  </Button>
                </CardContent>
              </Card>
            )
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {/* ---- scraper ---- */}
                <Card className="border-zinc-800 bg-zinc-900/70">
                  <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                      <Radar className="h-4 w-4 text-emerald-400" /> اسکرپر
                    </CardTitle>
                    <EnabledBadge enabled={ov.scraper.enabled} />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                        <p className="text-[10px] text-zinc-500">بازهٔ اجرا</p>
                        <p className="mt-0.5 text-xs font-bold text-zinc-200">
                          هر {fa(ov.scraper.everyMin)} دقیقه
                        </p>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                        <p className="text-[10px] text-zinc-500">اجرای بعدی</p>
                        <p className="mt-0.5 text-xs font-bold text-zinc-200">
                          {ov.scraper.nextRunAt ? fmtDateTime(ov.scraper.nextRunAt) : '—'}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                      <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                        <Clock className="h-3 w-3" /> آخرین اجرا
                      </p>
                      {ov.scraper.lastRun ? (
                        <div className="mt-1.5 space-y-1">
                          <p className="flex flex-wrap items-center gap-1.5">
                            <RunStatusBadge status={ov.scraper.lastRun.status} />
                            <span className="text-[10px] text-zinc-500">
                              {fmtDateTime(ov.scraper.lastRun.at)}
                            </span>
                          </p>
                          <p className="truncate text-[11px] text-zinc-400" dir="auto" title={ov.scraper.lastRun.summary}>
                            {ov.scraper.lastRun.summary || '—'}
                          </p>
                        </div>
                      ) : (
                        <p className="mt-1 text-[11px] text-zinc-500">هنوز اجرا نشده</p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void runScraperNow()}
                      disabled={busy['run-scraper'] || ov.agent.scrapingNow}
                      className="h-8 w-full border-emerald-800/60 bg-emerald-950/30 text-xs text-emerald-300 hover:bg-emerald-950/50"
                    >
                      {busy['run-scraper'] || ov.agent.scrapingNow ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      {ov.agent.scrapingNow ? 'در حال اجرا…' : 'اجرا الان'}
                    </Button>
                  </CardContent>
                </Card>

                {/* ---- woo ---- */}
                <Card className="border-zinc-800 bg-zinc-900/70">
                  <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                      <ShoppingCart className="h-4 w-4 text-amber-400" /> ووکامرس
                    </CardTitle>
                    {ov.woo.configured ? (
                      <Badge className="bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">
                        متصل
                      </Badge>
                    ) : (
                      <Badge className="bg-zinc-700/40 text-zinc-300 ring-1 ring-zinc-600/50">
                        تنظیم‌نشده
                      </Badge>
                    )}
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                      <p className="text-[10px] text-zinc-500">سایت</p>
                      <p className="mt-0.5 truncate font-mono text-xs font-bold text-zinc-200" dir="ltr" title={ov.woo.site}>
                        {ov.woo.site || '—'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                        <p className="text-[10px] text-zinc-500">محصولات همگام</p>
                        <p className="mt-0.5 text-xs font-bold text-zinc-200">{fa(ov.woo.products)}</p>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                        <p className="text-[10px] text-zinc-500">آخرین همگام‌سازی</p>
                        <p className="mt-0.5 text-xs font-bold text-zinc-200">
                          {ov.woo.lastSync ? fmtDateTime(ov.woo.lastSync) : '—'}
                        </p>
                      </div>
                    </div>
                    <p className="text-[10px] leading-5 text-zinc-600">
                      {ov.woo.autoSync
                        ? 'همگام‌سازی خودکار بعد از هر اجرای اسکرپر روشنه.'
                        : 'همگام‌سازی خودکار خاموشه — از تب ووکامرس دستی هم می‌تونی بزنی.'}
                    </p>
                  </CardContent>
                </Card>

                {/* ---- report ---- */}
                <Card className="border-zinc-800 bg-zinc-900/70">
                  <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                      <FileText className="h-4 w-4 text-emerald-400" /> گزارش روزانه
                    </CardTitle>
                    <EnabledBadge enabled={ov.report.enabled} />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                      <p className="text-[10px] text-zinc-500">ساعت ساخت (به وقت تهران)</p>
                      <p className="mt-0.5 font-mono text-xs font-bold text-zinc-200" dir="ltr">
                        {ov.report.time || '—'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                      <p className="text-[10px] text-zinc-500">آخرین گزارش</p>
                      {ov.report.last ? (
                        <div className="mt-1 space-y-1.5">
                          <p className="text-xs font-bold text-zinc-200">
                            {fmtDate(`${ov.report.last.forDate}T00:00:00+03:30`)}
                            <span className="ms-1.5 text-[10px] font-normal text-zinc-500">
                              ({fmtDateTime(ov.report.last.at)})
                            </span>
                          </p>
                          <SentTgBadge sent={ov.report.last.sentTg} />
                        </div>
                      ) : (
                        <p className="mt-1 text-[11px] text-zinc-500">هنوز گزارشی ساخته نشده</p>
                      )}
                    </div>
                  </CardContent>
                </Card>

                {/* ---- images ---- */}
                <Card className="border-zinc-800 bg-zinc-900/70">
                  <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                      <ImagePlus className="h-4 w-4 text-emerald-400" /> تصاویر
                    </CardTitle>
                    <Badge className="bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700" dir="ltr">
                      {fa(ov.images.usedToday)} / {fa(ov.images.quota)}
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <p className="flex items-center justify-between text-[11px] text-zinc-400">
                      <span>مصرف امروز</span>
                      <span dir="ltr" className="font-mono text-zinc-300">
                        {fa(ov.images.usedToday)} / {fa(ov.images.quota)}
                      </span>
                    </p>
                    <Progress
                      value={
                        ov.images.quota > 0
                          ? Math.min(100, (ov.images.usedToday / ov.images.quota) * 100)
                          : 0
                      }
                      className="h-2 bg-zinc-800 [&>div]:bg-emerald-500"
                    />
                    <p className="text-[10px] leading-5 text-zinc-600">
                      سهمیهٔ تولید تصویر به ازای هر روز (به وقت تهران) حساب می‌شه.
                    </p>
                  </CardContent>
                </Card>

                {/* ---- invoices ---- */}
                <Card className="border-zinc-800 bg-zinc-900/70">
                  <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                      <Receipt className="h-4 w-4 text-amber-400" /> فاکتورها
                    </CardTitle>
                    <Badge className="bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700">
                      امروز {fa(ov.invoices.today)}
                    </Badge>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {ov.invoices.last.length === 0 ? (
                      <p className="py-2 text-[11px] text-zinc-500">هنوز فاکتوری صادر نشده</p>
                    ) : (
                      ov.invoices.last.slice(0, 3).map((inv) => (
                        <div
                          key={inv.id}
                          className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-zinc-800 bg-zinc-950 p-2 text-[11px]"
                        >
                          <span className="font-mono text-zinc-200" dir="ltr">
                            {inv.number}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-zinc-500" dir="auto">
                            {inv.customer || '—'}
                          </span>
                          <span className="shrink-0 tabular-nums text-zinc-300">
                            {faNumStr(inv.total)} {CURRENCY_LABEL[inv.currency] ?? inv.currency}
                          </span>
                        </div>
                      ))
                    )}
                    <p className="text-[10px] leading-5 text-zinc-600">
                      سه فاکتور آخر — لیست کامل با پیش‌نمایش توی تب «فاکتورها» است.
                    </p>
                  </CardContent>
                </Card>

                {/* ---- support ---- */}
                <Card className="border-zinc-800 bg-zinc-900/70">
                  <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                    <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                      <MessagesSquare className="h-4 w-4 text-emerald-400" /> پشتیبانی سایت
                    </CardTitle>
                    <EnabledBadge enabled={ov.support.enabled} />
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                        <p className="text-[10px] text-zinc-500">گفتگوها</p>
                        <p className="mt-0.5 text-xs font-bold text-zinc-200">{fa(ov.support.sessions)}</p>
                      </div>
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                        <p className="text-[10px] text-zinc-500">آخرین فعالیت</p>
                        <p className="mt-0.5 text-xs font-bold text-zinc-200">
                          {ov.support.lastAt ? fmtDateTime(ov.support.lastAt) : '—'}
                        </p>
                      </div>
                    </div>
                    <p className="text-[10px] leading-5 text-zinc-600">
                      ویجت چت سایت — گفتگوهای واقعی توی تب «پشتیبانی سایت».
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* ---- runs ---- */}
              <Card className="border-zinc-800 bg-zinc-900/70">
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                    <Zap className="h-4 w-4 text-amber-400" /> آخرین اجراها
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div
                    dir="rtl"
                    className="max-h-72 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-2"
                  >
                    {ov.runs.length === 0 ? (
                      <p className="py-3 text-center text-[11px] text-zinc-600">هنوز اجرایی ثبت نشده</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {ov.runs.map((r) => (
                          <li
                            key={r.id}
                            className="flex flex-wrap items-baseline gap-1.5 text-[11px] text-zinc-400"
                          >
                            <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">
                              {fmtDateTime(r.at)}
                            </span>
                            <span className="shrink-0 font-bold text-zinc-300">
                              {JOB_LABELS[r.job] || r.job}
                            </span>
                            <RunStatusBadge status={r.status} />
                            {r.summary ? (
                              <span className="min-w-0 flex-1 truncate text-zinc-500" dir="auto" title={r.summary}>
                                — {r.summary}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <p className="text-[10px] leading-5 text-zinc-600">
                    ۱۰ اجرای آخرِ همهٔ کارهای ایجنت (اسکرپر، همگام‌سازی، گزارش، تصویر، فاکتور).
                  </p>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ================ 2. اسکرپر ================ */}
        <TabsContent value="scraper" className="mt-4 space-y-4">
          {settings === null ? (
            <NoSettings onRetry={() => void loadSettings()} />
          ) : (
            <>
              <Card className="border-zinc-800 bg-zinc-900/70">
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                    <Radar className="h-4 w-4 text-emerald-400" /> تنظیمات اسکرپر
                  </CardTitle>
                  <EnabledBadge enabled={scEnabled} />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor="sc-enabled" className="text-xs font-bold text-zinc-200">
                        اجرای خودکار اسکرپر
                      </Label>
                      <p className="text-[10px] leading-5 text-zinc-500">
                        خاموش باشه زمان‌بندی می‌ایسته — «اجرا الان» هنوز کار می‌کنه.
                      </p>
                    </div>
                    <Switch
                      id="sc-enabled"
                      checked={scEnabled}
                      onCheckedChange={setScEnabled}
                      className="data-[state=checked]:bg-emerald-600"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="sc-script" className="text-xs text-zinc-300">
                        مسیر اسکریپت پایتون
                      </Label>
                      <Input
                        id="sc-script"
                        dir="ltr"
                        value={scScript}
                        onChange={(e) => setScScript(e.target.value)}
                        placeholder="/home/z/agent/scraper/scraper.py"
                        className="h-8 border-zinc-700 bg-zinc-950 font-mono text-xs text-zinc-100 placeholder:text-zinc-600"
                      />
                      <p className="text-[10px] leading-5 text-zinc-600">
                        باید با <span className="font-mono text-zinc-400" dir="ltr">/home/z/</span> شروع بشه.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="sc-every" className="text-xs text-zinc-300">
                        بازهٔ اجرا (دقیقه)
                      </Label>
                      <Input
                        id="sc-every"
                        type="number"
                        dir="ltr"
                        inputMode="numeric"
                        min={5}
                        max={1440}
                        value={scEveryMin}
                        onChange={(e) => setScEveryMin(e.target.value)}
                        className="h-8 border-zinc-700 bg-zinc-950 text-center text-xs text-zinc-100"
                      />
                      <p className="text-[10px] leading-5 text-zinc-600">
                        بین ۵ تا ۱۴۴۰ دقیقه (پیش‌فرض ۳۰).
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor="sc-txt" className="text-xs font-bold text-zinc-200">
                        ارسال خروجی متنی به تلگرام
                      </Label>
                      <p className="text-[10px] leading-5 text-zinc-500">
                        روشن باشه، بعد از هر اجرا فایل <span className="font-mono text-zinc-400" dir="ltr">out/output.txt</span> به تلگرام می‌ره.
                      </p>
                    </div>
                    <Switch
                      id="sc-txt"
                      checked={scSendTxt}
                      onCheckedChange={setScSendTxt}
                      className="data-[state=checked]:bg-emerald-600"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="sc-chat" className="text-xs text-zinc-300">
                      مقصد تلگرام
                    </Label>
                    <Input
                      id="sc-chat"
                      dir="ltr"
                      value={tgChat}
                      onChange={(e) => setTgChat(e.target.value)}
                      placeholder="me"
                      maxLength={64}
                      className="h-8 border-zinc-700 bg-zinc-950 font-mono text-xs text-zinc-100 placeholder:text-zinc-600"
                    />
                    <p className="text-[10px] leading-5 text-zinc-600">
                      «me» یعنی Saved Messages خودت؛ یا chat_id عددی هر مقصد دیگه.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => void saveScraperSettings()}
                      disabled={busy['save-scraper']}
                      className="h-8 bg-emerald-600 text-xs font-bold text-zinc-950 hover:bg-emerald-500"
                    >
                      {busy['save-scraper'] ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      ذخیره تنظیمات
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => void runScraperNow()}
                      disabled={busy['run-scraper'] || !!ov?.agent.scrapingNow}
                      className="h-8 border-emerald-800/60 bg-emerald-950/30 text-xs text-emerald-300 hover:bg-emerald-950/50"
                    >
                      {busy['run-scraper'] || ov?.agent.scrapingNow ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Play className="h-3.5 w-3.5" />
                      )}
                      اجرا الان
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-zinc-800 bg-zinc-900/70">
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                    <Info className="h-4 w-4 text-amber-400" /> قرارداد اسکرپر
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <InfoNote>
                    <p>
                      اسکریپت پایتون طبق بازهٔ بالا (پیش‌فرض هر ۳۰ دقیقه) اجرا می‌شه و باید سه خروجی
                      بسازه:
                    </p>
                    <ul className="space-y-1">
                      <li>
                        — <code dir="ltr">out/output.txt</code> → ارسال به تلگرام (اگه سوییچ بالا روشن
                        باشه)
                      </li>
                      <li>
                        — <code dir="ltr">out/output.csv</code> → همگام‌سازی ووکامرس (ستون‌ها:{' '}
                        <code dir="ltr">sku,name,price,stock</code>)
                      </li>
                      <li>
                        — <code dir="ltr">out/output.json</code> → ذخیره در دیتابیس
                      </li>
                    </ul>
                    <p>
                      مسیر فعلی: <code dir="ltr">{scScript || '/home/z/agent/scraper/scraper.py'}</code>{' '}
                      — نمونهٔ واقعیِ قیمت ارزهاست؛ فایل خودت رو از تب «فایل‌ها» جایگزین کن.
                    </p>
                  </InfoNote>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ================ 3. ووکامرس ================ */}
        <TabsContent value="woo" className="mt-4 space-y-4">
          {settings === null ? (
            <NoSettings onRetry={() => void loadSettings()} />
          ) : (
            <Card className="border-zinc-800 bg-zinc-900/70">
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                  <ShoppingCart className="h-4 w-4 text-amber-400" /> تنظیمات ووکامرس
                </CardTitle>
                {ov?.woo.configured ? (
                  <Badge className="bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">
                    متصل
                  </Badge>
                ) : (
                  <Badge className="bg-zinc-700/40 text-zinc-300 ring-1 ring-zinc-600/50">تنظیم‌نشده</Badge>
                )}
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="woo-site" className="text-xs text-zinc-300">
                      آدرس سایت ووکامرس
                    </Label>
                    <Input
                      id="woo-site"
                      dir="ltr"
                      value={wooSite}
                      onChange={(e) => setWooSite(e.target.value)}
                      placeholder="https://shop.example.com"
                      className="h-8 border-zinc-700 bg-zinc-950 font-mono text-xs text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor="woo-auto" className="text-xs font-bold text-zinc-200">
                        همگام‌سازی خودکار
                      </Label>
                      <p className="text-[10px] leading-5 text-zinc-500">
                        بعد از هر اجرای موفق اسکرپر، CSV با سایت همگام بشه.
                      </p>
                    </div>
                    <Switch
                      id="woo-auto"
                      checked={wooAutoSync}
                      onCheckedChange={setWooAutoSync}
                      className="data-[state=checked]:bg-emerald-600"
                    />
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="woo-key" className="text-xs text-zinc-300">
                      کلید مصرف‌کننده (Consumer Key)
                    </Label>
                    <Input
                      id="woo-key"
                      type="password"
                      dir="ltr"
                      value={wooKey}
                      onChange={(e) => setWooKey(e.target.value)}
                      placeholder="ck_…"
                      className="h-8 border-zinc-700 bg-zinc-950 font-mono text-xs text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="woo-secret" className="text-xs text-zinc-300">
                      رمز مصرف‌کننده (Consumer Secret)
                    </Label>
                    <Input
                      id="woo-secret"
                      type="password"
                      dir="ltr"
                      value={wooSecret}
                      onChange={(e) => setWooSecret(e.target.value)}
                      placeholder="cs_…"
                      className="h-8 border-zinc-700 bg-zinc-950 font-mono text-xs text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>
                </div>
                <p className="text-[10px] leading-5 text-zinc-600">
                  اگه توی این دو فیلد «…» دیدی یعنی قبلاً ذخیره شده و دست نخورده — خالی بذاری یعنی
                  پاک‌شدن.
                </p>

                <div className="space-y-1.5">
                  <Label htmlFor="woo-hook" className="text-xs text-zinc-300">
                    راز وبهوک (خودکار ساخته شده)
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id="woo-hook"
                      readOnly
                      dir="ltr"
                      value={webhookSecret || '—'}
                      className="h-8 flex-1 border-zinc-700 bg-zinc-950 font-mono text-xs text-zinc-300"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copyText(webhookSecret, 'راز وبهوک')}
                      disabled={!webhookSecret}
                      className="h-8 border-zinc-700 bg-zinc-950 text-xs text-zinc-300 hover:bg-zinc-800"
                    >
                      <Copy className="h-3.5 w-3.5" /> کپی
                    </Button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void saveWooSettings()}
                    disabled={busy['save-woo']}
                    className="h-8 bg-emerald-600 text-xs font-bold text-zinc-950 hover:bg-emerald-500"
                  >
                    {busy['save-woo'] ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    ذخیره تنظیمات
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void testWoo()}
                    disabled={busy['woo-test']}
                    title="تست، همین مقادیر فرم را ذخیره می‌کند"
                    className="h-8 border-amber-800/60 bg-amber-950/30 text-xs text-amber-300 hover:bg-amber-950/50"
                  >
                    {busy['woo-test'] ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )}
                    تست اتصال
                  </Button>
                </div>

                {wooTestRes ? (
                  <p
                    className={`rounded-lg border p-2.5 text-[11px] leading-5 ${
                      wooTestRes.ok
                        ? 'border-emerald-900/60 bg-emerald-950/30 text-emerald-300'
                        : 'border-red-900/60 bg-red-950/30 text-red-300'
                    }`}
                    dir="auto"
                  >
                    {wooTestRes.detail}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          )}

          {/* ---- webhook info ---- */}
          <Card className="border-zinc-800 bg-zinc-900/70">
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                <Zap className="h-4 w-4 text-amber-400" /> وبهوک سفارش لحظه‌ای
              </CardTitle>
            </CardHeader>
            <CardContent>
              <InfoNote>
                <p>
                  این آدرس رو در ووکامرس ← تنظیمات ← پیشرفته ← Webhooks با رویداد «Order created» ثبت
                  کن تا هر سفارش، فاکتورش خودکار ساخته بشه و به تلگرام بره:
                </p>
                {hookUrl ? (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                    <code
                      dir="ltr"
                      className="min-w-0 flex-1 break-all font-mono text-[10px] leading-5 text-amber-300/90"
                    >
                      {hookUrl}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copyText(hookUrl, 'آدرس وبهوک')}
                      className="h-7 border-zinc-700 bg-zinc-950 text-[10px] text-zinc-300 hover:bg-zinc-800"
                    >
                      <Copy className="h-3 w-3" /> کپی
                    </Button>
                  </div>
                ) : (
                  <p className="text-amber-300/80">
                    برای ساخته‌شدن آدرس، اول «آدرس عمومی پنل» رو در تب «پشتیبانی سایت» ذخیره کن.
                  </p>
                )}
              </InfoNote>
            </CardContent>
          </Card>

          {/* ---- sync ---- */}
          <Card className="border-zinc-800 bg-zinc-900/70">
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                <RefreshCw className="h-4 w-4 text-emerald-400" /> همگام‌سازی محصولات
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs leading-6 text-zinc-400">
                آخرین خروجی CSV اسکرپر رو می‌خونه و محصول‌های سایت رو بر اساس SKU می‌سازه یا قیمت و
                موجودی‌شون رو به‌روز می‌کنه.
              </p>
              <Button
                variant="outline"
                onClick={() => void syncWoo()}
                disabled={busy['woo-sync']}
                className="h-8 border-emerald-800/60 bg-emerald-950/30 text-xs text-emerald-300 hover:bg-emerald-950/50"
              >
                {busy['woo-sync'] ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                همگام‌سازی الان
              </Button>
              {wooSyncRes ? (
                <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                    <span className="font-bold text-emerald-400">{fa(wooSyncRes.created)} ساخته‌شده</span>
                    <span className="text-zinc-600">·</span>
                    <span className="font-bold text-amber-300">{fa(wooSyncRes.updated)} به‌روز‌شده</span>
                    <span className="text-zinc-600">·</span>
                    <span className="font-bold text-zinc-400">{fa(wooSyncRes.unchanged)} بدون تغییر</span>
                    <span className="text-zinc-600">·</span>
                    <span className="text-zinc-500">از {fa(wooSyncRes.total)} ردیف CSV</span>
                  </div>
                  {wooSyncRes.errors.length > 0 ? (
                    <ul className="max-h-24 space-y-1 overflow-y-auto text-[10px] leading-5 text-red-300">
                      {wooSyncRes.errors.map((e, i) => (
                        <li key={i} dir="auto">
                          — {e}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {/* ---- products ---- */}
          <Card className="border-zinc-800 bg-zinc-900/70">
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                <Package className="h-4 w-4 text-emerald-400" /> محصولات همگام‌شده
              </CardTitle>
              <div className="flex items-center gap-2">
                {wooProducts ? (
                  <Badge className="bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700">
                    {fa(wooProducts.length)}
                  </Badge>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchWooProducts()}
                  className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${busy['products'] ? 'animate-spin' : ''}`} /> رفرش
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {wooProducts === null ? (
                <ListPlaceholder loading={!!busy['products']} onRetry={() => void fetchWooProducts()} />
              ) : wooProducts.length === 0 ? (
                <ListPlaceholder
                  loading={false}
                  emptyText="هنوز محصولی همگام نشده — اول اسکرپر رو اجرا کن، بعد «همگام‌سازی الان»."
                />
              ) : (
                <div className="max-h-96 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/60" dir="rtl">
                  <table className="w-full min-w-[520px] text-[11px]">
                    <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                      <tr>
                        <th className="px-2.5 py-2 text-right font-medium">کد (SKU)</th>
                        <th className="px-2.5 py-2 text-right font-medium">نام</th>
                        <th className="px-2.5 py-2 text-right font-medium">قیمت</th>
                        <th className="px-2.5 py-2 text-right font-medium">موجودی</th>
                        <th className="px-2.5 py-2 text-right font-medium">آخرین همگام‌سازی</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/70">
                      {wooProducts.map((p) => (
                        <tr key={p.sku} className="text-zinc-300">
                          <td className="px-2.5 py-2 font-mono text-zinc-200" dir="ltr">
                            {p.sku}
                          </td>
                          <td className="max-w-[200px] truncate px-2.5 py-2" dir="auto" title={p.name}>
                            {p.name || '—'}
                          </td>
                          <td className="px-2.5 py-2 tabular-nums">{faNumStr(p.price)}</td>
                          <td className="px-2.5 py-2 tabular-nums">{fa(p.stock)}</td>
                          <td className="px-2.5 py-2 text-zinc-500">{fmtDateTime(p.lastSyncAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================ 4. گزارش روزانه ================ */}
        <TabsContent value="report" className="mt-4 space-y-4">
          {settings === null ? (
            <NoSettings onRetry={() => void loadSettings()} />
          ) : (
            <Card className="border-zinc-800 bg-zinc-900/70">
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                  <FileText className="h-4 w-4 text-emerald-400" /> گزارش روزانهٔ حسابداری
                </CardTitle>
                <EnabledBadge enabled={repEnabled} />
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                  <div className="min-w-0 space-y-1">
                    <Label htmlFor="rep-enabled" className="text-xs font-bold text-zinc-200">
                      گزارش روزانهٔ خودکار
                    </Label>
                    <p className="text-[10px] leading-5 text-zinc-500">
                      هر روز به وقت تهران، وقتی ساعت رسیده باشه، از فاکتورها و فروش گزارش می‌سازه و به
                      تلگرام می‌فرسته.
                    </p>
                  </div>
                  <Switch
                    id="rep-enabled"
                    checked={repEnabled}
                    onCheckedChange={setRepEnabled}
                    className="data-[state=checked]:bg-emerald-600"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="rep-time" className="text-xs text-zinc-300">
                      ساعت ساخت (به وقت تهران)
                    </Label>
                    <Input
                      id="rep-time"
                      type="time"
                      dir="ltr"
                      value={repTime}
                      onChange={(e) => setRepTime(e.target.value)}
                      className="h-8 border-zinc-700 bg-zinc-950 text-center text-xs text-zinc-100"
                    />
                  </div>
                  <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                    <p className="text-[10px] text-zinc-500">آخرین گزارش</p>
                    {ov?.report.last ? (
                      <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs font-bold text-zinc-200">
                        {fmtDate(`${ov.report.last.forDate}T00:00:00+03:30`)}
                        <SentTgBadge sent={ov.report.last.sentTg} />
                      </p>
                    ) : (
                      <p className="mt-0.5 text-xs font-bold text-zinc-500">—</p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => void saveReportSettings()}
                    disabled={busy['save-report']}
                    className="h-8 bg-emerald-600 text-xs font-bold text-zinc-950 hover:bg-emerald-500"
                  >
                    {busy['save-report'] ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    ذخیره
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void runReportNow()}
                    disabled={busy['report-now']}
                    className="h-8 border-amber-800/60 bg-amber-950/30 text-xs text-amber-300 hover:bg-amber-950/50"
                  >
                    {busy['report-now'] ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    ساخت و ارسال الان
                  </Button>
                </div>
                <p className="text-[10px] leading-5 text-zinc-600">
                  «ساخت الان» با مدلِ تفکری می‌سازه — ممکنه یه‌کم طول بکشه، صبز باشه.
                </p>
              </CardContent>
            </Card>
          )}

          {reportResult ? (
            <Card className="border-emerald-900/60 bg-emerald-950/20">
              <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                  <FileText className="h-4 w-4 text-emerald-400" /> گزارش ساخته‌شده
                </CardTitle>
                <SentTgBadge sent={reportResult.sentTg} />
              </CardHeader>
              <CardContent>
                <p
                  dir="rtl"
                  className="max-h-72 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-xs leading-7 text-zinc-300"
                >
                  {reportResult.content}
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-zinc-800 bg-zinc-900/70">
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                <Clock className="h-4 w-4 text-amber-400" /> تاریخچهٔ گزارش‌ها
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void fetchReports()}
                className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${busy['reports'] ? 'animate-spin' : ''}`} /> رفرش
              </Button>
            </CardHeader>
            <CardContent>
              {reports === null ? (
                <ListPlaceholder loading={!!busy['reports']} onRetry={() => void fetchReports()} />
              ) : reports.length === 0 ? (
                <ListPlaceholder loading={false} emptyText="هنوز گزارشی ساخته نشده — با «ساخت و ارسال الان» یکی بساز." />
              ) : (
                <div className="max-h-96 space-y-2 overflow-y-auto pr-1" dir="rtl">
                  {reports.map((r) => (
                    <Collapsible
                      key={r.id}
                      open={!!openReports[r.id]}
                      onOpenChange={(o) => setOpenReports((m) => ({ ...m, [r.id]: o }))}
                    >
                      <div className="rounded-lg border border-zinc-800 bg-zinc-950">
                        <CollapsibleTrigger className="flex w-full items-center gap-2 p-2.5 text-right">
                          <span className="text-xs font-bold text-zinc-200">
                            گزارش {fmtDate(`${r.forDate}T00:00:00+03:30`)}
                          </span>
                          <SentTgBadge sent={r.sentTg} />
                          <span className="flex-1" />
                          <span className="shrink-0 text-[10px] text-zinc-600">{fmtDateTime(r.createdAt)}</span>
                          <ChevronDown
                            className={`h-3.5 w-3.5 shrink-0 text-zinc-500 transition-transform ${
                              openReports[r.id] ? 'rotate-180' : ''
                            }`}
                          />
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <p className="max-h-64 overflow-y-auto whitespace-pre-wrap border-t border-zinc-800 p-2.5 text-[11px] leading-6 text-zinc-400">
                            {r.content}
                          </p>
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================ 5. فاکتورها ================ */}
        <TabsContent value="invoices" className="mt-4 space-y-4">
          <Card className="border-zinc-800 bg-zinc-900/70">
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                <Receipt className="h-4 w-4 text-amber-400" /> فاکتورها
              </CardTitle>
              <div className="flex items-center gap-2">
                {ov ? (
                  <Badge className="bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700">
                    امروز {fa(ov.invoices.today)}
                  </Badge>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchInvoices()}
                  className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${busy['invoices'] ? 'animate-spin' : ''}`} /> رفرش
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setCreateSeq((s) => s + 1)
                    setCreateOpen(true)
                  }}
                  className="h-8 bg-emerald-600 text-xs font-bold text-zinc-950 hover:bg-emerald-500"
                >
                  <Plus className="h-3.5 w-3.5" /> فاکتور دستی
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {invoices === null ? (
                <ListPlaceholder loading={!!busy['invoices']} onRetry={() => void fetchInvoices()} />
              ) : invoices.length === 0 ? (
                <ListPlaceholder
                  loading={false}
                  emptyText="هنوز فاکتوری صادر نشده — با «فاکتور دستی» یکی بساز یا وبهوک ووکامرس رو وصل کن."
                />
              ) : (
                <div className="max-h-[26rem] overflow-auto rounded-lg border border-zinc-800 bg-zinc-950/60" dir="rtl">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-zinc-900 text-zinc-500">
                      <tr>
                        <th className="px-2.5 py-2 text-right font-medium">شماره</th>
                        <th className="px-2.5 py-2 text-right font-medium">مشتری</th>
                        <th className="px-2.5 py-2 text-right font-medium">مبلغ</th>
                        <th className="px-2.5 py-2 text-right font-medium">وضعیت</th>
                        <th className="px-2.5 py-2 text-right font-medium">سفارش</th>
                        <th className="px-2.5 py-2 text-center font-medium">تلگرام</th>
                        <th className="px-2.5 py-2 text-left font-medium">مشاهده</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/70">
                      {invoices.map((inv) => (
                        <tr key={inv.id} className="text-zinc-300">
                          <td className="px-2.5 py-2">
                            <p className="font-mono text-zinc-200" dir="ltr">
                              {inv.number}
                            </p>
                            <p className="text-[10px] text-zinc-600">{fmtDateTime(inv.at)}</p>
                          </td>
                          <td className="max-w-[140px] truncate px-2.5 py-2" dir="auto" title={inv.customer}>
                            {inv.customer || '—'}
                          </td>
                          <td className="whitespace-nowrap px-2.5 py-2 tabular-nums">
                            {faNumStr(inv.total)} {CURRENCY_LABEL[inv.currency] ?? inv.currency}
                          </td>
                          <td className="px-2.5 py-2">
                            <InvoiceStatusBadge status={inv.status} />
                          </td>
                          <td className="px-2.5 py-2">
                            {inv.orderId ? (
                              <span className="font-mono text-[10px] text-amber-300/90" dir="ltr">
                                #{inv.orderId}
                              </span>
                            ) : (
                              <span className="text-zinc-600">—</span>
                            )}
                          </td>
                          <td className="px-2.5 py-2 text-center">
                            <Send
                              className={`mx-auto h-3.5 w-3.5 ${
                                inv.sentTg ? 'text-emerald-400' : 'text-zinc-600'
                              }`}
                              aria-label={inv.sentTg ? 'به تلگرام ارسال شده' : 'به تلگرام نرفته'}
                            />
                          </td>
                          <td className="px-2.5 py-2 text-left">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => void viewInvoice(inv.id, inv.number)}
                              disabled={busy[`view-${inv.id}`]}
                              className="h-7 border-zinc-700 bg-zinc-950 text-[10px] text-zinc-300 hover:bg-zinc-800"
                            >
                              {busy[`view-${inv.id}`] ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Eye className="h-3 w-3" />
                              )}
                              مشاهده
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================ 6. تصاویر ================ */}
        <TabsContent value="images" className="mt-4 space-y-4">
          {settings === null ? (
            <NoSettings onRetry={() => void loadSettings()} />
          ) : (
            <>
              <Card className="border-zinc-800 bg-zinc-900/70">
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                    <ImagePlus className="h-4 w-4 text-emerald-400" /> تولید تصویر
                  </CardTitle>
                  <Badge className="bg-zinc-800 text-zinc-300 ring-1 ring-zinc-700" dir="ltr">
                    {fa(usedToday)} / {fa(imgQuotaNum)}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="img-prompt" className="text-xs text-zinc-300">
                      توضیح تصویر (پرامپت)
                    </Label>
                    <Textarea
                      id="img-prompt"
                      dir="rtl"
                      rows={3}
                      value={imgPrompt}
                      onChange={(e) => setImgPrompt(e.target.value)}
                      placeholder="مثلاً: گربهٔ فضانورد با کلاه شیشه‌ای، سبک نقاشی دیجیتال"
                      maxLength={900}
                      className="min-h-16 border-zinc-700 bg-zinc-950 text-xs leading-6 text-zinc-100 placeholder:text-zinc-600"
                    />
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-zinc-300">تعداد</Label>
                      <Select value={imgCount} onValueChange={setImgCount}>
                        <SelectTrigger className="h-8 w-full border-zinc-700 bg-zinc-950 text-xs text-zinc-100">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-200">
                          {['1', '2', '3', '4'].map((c) => (
                            <SelectItem key={c} value={c} className="text-xs focus:bg-zinc-800">
                              {fa(Number(c))} تصویر
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-zinc-300">اندازه</Label>
                      <Select value={imgSize} onValueChange={setImgSize}>
                        <SelectTrigger className="h-8 w-full border-zinc-700 bg-zinc-950 text-xs text-zinc-100">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-200">
                          {sizes.map((s) => (
                            <SelectItem key={s} value={s} className="text-xs focus:bg-zinc-800">
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-zinc-200">ارسال به تلگرام</p>
                        <p className="mt-0.5 text-[10px] leading-4 text-zinc-500">بعد از ساخت</p>
                      </div>
                      <Switch
                        checked={imgSendTg}
                        onCheckedChange={setImgSendTg}
                        className="data-[state=checked]:bg-emerald-600"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      onClick={() => void generateImage()}
                      disabled={busy['generate']}
                      className="h-8 bg-emerald-600 text-xs font-bold text-zinc-950 hover:bg-emerald-500"
                    >
                      {busy['generate'] ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <ImagePlus className="h-3.5 w-3.5" />
                      )}
                      {busy['generate'] ? 'در حال ساخت…' : 'تولید تصویر'}
                    </Button>
                    <p className="text-[10px] leading-5 text-zinc-600">
                      ممکنه تا ۲ دقیقه طول بکشه — تا اون موقع دکمه قفله، صبز باشه.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <p className="flex items-center justify-between text-[11px] text-zinc-400">
                      <span>مصرف امروز</span>
                      <span dir="ltr" className="font-mono text-zinc-300">
                        {fa(usedToday)} / {fa(imgQuotaNum)}
                      </span>
                    </p>
                    <Progress
                      value={imgQuotaPct}
                      className={`h-2 bg-zinc-800 ${imgQuotaPct >= 80 ? '[&>div]:bg-amber-400' : '[&>div]:bg-emerald-500'}`}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card className="border-zinc-800 bg-zinc-900/70">
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                    <Info className="h-4 w-4 text-amber-400" /> سهمیه و اندازهٔ پیش‌فرض
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="img-quota" className="text-xs text-zinc-300">
                        سهمیهٔ روزانه (تصویر)
                      </Label>
                      <Input
                        id="img-quota"
                        type="number"
                        dir="ltr"
                        inputMode="numeric"
                        min={1}
                        max={1000}
                        value={imgQuota}
                        onChange={(e) => setImgQuota(e.target.value)}
                        className="h-8 border-zinc-700 bg-zinc-950 text-center text-xs text-zinc-100"
                      />
                      <p className="text-[10px] leading-5 text-zinc-600">بین ۱ تا ۱۰۰۰ (پیش‌فرض ۱۵۰).</p>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-zinc-300">اندازهٔ پیش‌فرض</Label>
                      <Select value={imgDefaultSize} onValueChange={setImgDefaultSize}>
                        <SelectTrigger className="h-8 w-full border-zinc-700 bg-zinc-950 text-xs text-zinc-100">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="border-zinc-800 bg-zinc-950 text-zinc-200">
                          {sizes.map((s) => (
                            <SelectItem key={s} value={s} className="text-xs focus:bg-zinc-800">
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] leading-5 text-zinc-600">
                        برای ساخت‌های خودکار (مثل دستور image توی تلگرام).
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={() => void saveImageSettings()}
                    disabled={busy['save-image']}
                    className="h-8 bg-emerald-600 text-xs font-bold text-zinc-950 hover:bg-emerald-500"
                  >
                    {busy['save-image'] ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    ذخیره
                  </Button>
                </CardContent>
              </Card>
            </>
          )}

          <Card className="border-zinc-800 bg-zinc-900/70">
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                <ImageIcon className="h-4 w-4 text-emerald-400" /> گالری تصاویر
              </CardTitle>
              <div className="flex items-center gap-2">
                {imagesData ? (
                  <Badge className="bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700">
                    {fa(imagesData.images.length)}
                  </Badge>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchImages()}
                  className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${busy['images'] ? 'animate-spin' : ''}`} /> رفرش
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {imagesData === null ? (
                <ListPlaceholder loading={!!busy['images']} onRetry={() => void fetchImages()} />
              ) : imagesData.images.length === 0 ? (
                <ListPlaceholder loading={false} emptyText="هنوز تصویری ساخته نشده — اولین رو با فرم بالا بساز." />
              ) : (
                <div className="max-h-[28rem] overflow-y-auto pr-1">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {imagesData.images.map((im) => (
                      <div key={im.id} className="overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950">
                        <div className="relative h-40 w-full bg-zinc-900">
                          <ImageIcon className="absolute inset-0 m-auto h-8 w-8 text-zinc-700" />
                          <img
                            src={withMediaKey(im.path)}
                            alt={im.prompt}
                            loading="lazy"
                            decoding="async"
                            className="relative h-40 w-full object-cover"
                            onError={(e) => {
                              e.currentTarget.classList.add('hidden')
                            }}
                          />
                        </div>
                        <div className="space-y-1.5 p-2">
                          <p className="line-clamp-2 text-[11px] leading-5 text-zinc-300" dir="auto">
                            {im.prompt}
                          </p>
                          <p className="text-[10px] text-zinc-600">{fmtDateTime(im.at)}</p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void sendImage(im.id)}
                            disabled={busy[`send-${im.id}`]}
                            className="h-7 w-full border-emerald-800/60 bg-emerald-950/30 text-[10px] text-emerald-300 hover:bg-emerald-950/50"
                          >
                            {busy[`send-${im.id}`] ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Send className="h-3 w-3" />
                            )}
                            ارسال به تلگرام
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ================ 7. پشتیبانی سایت ================ */}
        <TabsContent value="support" className="mt-4 space-y-4">
          {settings === null ? (
            <NoSettings onRetry={() => void loadSettings()} />
          ) : (
            <>
              <Card className="border-zinc-800 bg-zinc-900/70">
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                    <MessagesSquare className="h-4 w-4 text-emerald-400" /> تنظیمات پشتیبانی سایت
                  </CardTitle>
                  <EnabledBadge enabled={supEnabled} />
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-950 p-3">
                    <div className="min-w-0 space-y-1">
                      <Label htmlFor="sup-enabled" className="text-xs font-bold text-zinc-200">
                        ویجت پشتیبانی فعال
                      </Label>
                      <p className="text-[10px] leading-5 text-zinc-500">
                        روشن باشه، ویجت چت روی سایتت به مشتری‌ها جواب می‌ده.
                      </p>
                    </div>
                    <Switch
                      id="sup-enabled"
                      checked={supEnabled}
                      onCheckedChange={setSupEnabled}
                      className="data-[state=checked]:bg-emerald-600"
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="sup-store" className="text-xs text-zinc-300">
                        نام فروشگاه
                      </Label>
                      <Input
                        id="sup-store"
                        dir="rtl"
                        value={supStore}
                        onChange={(e) => setSupStore(e.target.value)}
                        placeholder="مثلاً فروشگاه من"
                        maxLength={80}
                        className="h-8 border-zinc-700 bg-zinc-950 text-xs text-zinc-100 placeholder:text-zinc-600"
                      />
                      <p className="text-[10px] leading-5 text-zinc-600">
                        توی جواب‌های دستیار و فاکتورها هم استفاده می‌شه.
                      </p>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="sup-welcome" className="text-xs text-zinc-300">
                        پیام خوش‌آمد ویجت
                      </Label>
                      <Input
                        id="sup-welcome"
                        dir="rtl"
                        value={supWelcome}
                        onChange={(e) => setSupWelcome(e.target.value)}
                        placeholder="سلام! چطور می‌تونم کمکتون کنم؟"
                        maxLength={200}
                        className="h-8 border-zinc-700 bg-zinc-950 text-xs text-zinc-100 placeholder:text-zinc-600"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="sup-base" className="text-xs text-zinc-300">
                      آدرس عمومی پنل
                    </Label>
                    <Input
                      id="sup-base"
                      dir="ltr"
                      value={publicBaseUrl}
                      onChange={(e) => setPublicBaseUrl(e.target.value)}
                      placeholder="https://xxx.example.com"
                      className="h-8 border-zinc-700 bg-zinc-950 font-mono text-xs text-zinc-100 placeholder:text-zinc-600"
                    />
                    <p className="text-[10px] leading-5 text-zinc-600">
                      آدرس عمومی همین پنل مثل https://xxx.example.com — برای ساخت کد جاگذاری و وبهوک
                      لازمه.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="sup-persona" className="text-xs text-zinc-300">
                      شخصیت دستیار پشتیبانی (SYSTEM PROMPT)
                    </Label>
                    <Textarea
                      id="sup-persona"
                      dir="rtl"
                      rows={7}
                      value={supPersona}
                      onChange={(e) => setSupPersona(e.target.value)}
                      placeholder="تو پشتیبانی آنلاین فروشگاه هستی…"
                      className="min-h-32 border-zinc-700 bg-zinc-950 text-xs leading-6 text-zinc-100 placeholder:text-zinc-600"
                    />
                    <p className="text-[10px] leading-5 text-zinc-600">
                      لیست قیمت و موجودی به‌صورت خودکار به انتهای این متن چسبیده می‌شه — دستیار از
                      همون می‌خونه و اگه چیزی نبود صادقانه می‌گه بررسی می‌کنه.
                    </p>
                  </div>

                  <Button
                    onClick={() => void saveSupportSettings()}
                    disabled={busy['save-support']}
                    className="h-8 bg-emerald-600 text-xs font-bold text-zinc-950 hover:bg-emerald-500"
                  >
                    {busy['save-support'] ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    ذخیره
                  </Button>
                </CardContent>
              </Card>

              <Card className="border-zinc-800 bg-zinc-900/70">
                <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
                  <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                    <Copy className="h-4 w-4 text-amber-400" /> کد جاگذاری در سایت
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-zinc-300">کلید سایت (Site Key)</Label>
                    <div className="flex items-center gap-2">
                      <Input
                        readOnly
                        dir="ltr"
                        value={siteKey || '—'}
                        className="h-8 flex-1 border-zinc-700 bg-zinc-950 font-mono text-xs text-zinc-300"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void copyText(siteKey, 'کلید سایت')}
                        disabled={!siteKey}
                        className="h-8 border-zinc-700 bg-zinc-950 text-xs text-zinc-300 hover:bg-zinc-800"
                      >
                        <Copy className="h-3.5 w-3.5" /> کپی
                      </Button>
                    </div>
                    <p className="text-[10px] leading-5 text-zinc-600">
                      خودکار ساخته شده — توی کد جاگذاری ازش استفاده می‌شه، دستی دست نزن.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="sup-embed" className="text-xs text-zinc-300">
                      کد جاگذاری
                    </Label>
                    <Textarea
                      id="sup-embed"
                      readOnly
                      dir="ltr"
                      rows={3}
                      value={widgetCode}
                      placeholder={
                        savedBaseUrl
                          ? 'کلید سایت هنوز ساخته نشده — دوباره رفرش کن.'
                          : 'اول «آدرس عمومی پنل» رو ذخیره کن تا این کد ساخته بشه.'
                      }
                      className="min-h-20 border-zinc-700 bg-zinc-950 font-mono text-[10px] leading-5 text-zinc-300 placeholder:text-zinc-600"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void copyText(widgetCode, 'کد جاگذاری')}
                        disabled={!widgetCode}
                        className="h-8 border-emerald-800/60 bg-emerald-950/30 text-xs text-emerald-300 hover:bg-emerald-950/50"
                      >
                        <Copy className="h-3.5 w-3.5" /> کپی کد
                      </Button>
                      <p className="text-[10px] leading-5 text-zinc-600">
                        این تگ رو در بخش head قالب سایتت بذار تا ویجت چت گوشهٔ سایتت بالا بیاد.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          <Card className="border-zinc-800 bg-zinc-900/70">
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
                <MessageSquare className="h-4 w-4 text-emerald-400" /> گفتگوهای سایت
              </CardTitle>
              <div className="flex items-center gap-2">
                {sessions ? (
                  <Badge className="bg-zinc-800 text-zinc-400 ring-1 ring-zinc-700">
                    {fa(sessions.length)}
                  </Badge>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void fetchSessions()}
                  className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${busy['sessions'] ? 'animate-spin' : ''}`} /> رفرش
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {sessions === null ? (
                <ListPlaceholder loading={!!busy['sessions']} onRetry={() => void fetchSessions()} />
              ) : sessions.length === 0 ? (
                <ListPlaceholder
                  loading={false}
                  emptyText="هنوز گفتگویی از سایت ثبت نشده — کد جاگذاری رو توی سایتت بذار."
                />
              ) : (
                <div className="max-h-96 space-y-2 overflow-y-auto pr-1" dir="rtl">
                  {sessions.map((s) => (
                    <div key={s.id} className="rounded-lg border border-zinc-800 bg-zinc-950 p-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="min-w-0 flex-1 truncate text-xs text-zinc-300" dir="auto">
                          {s.lastSnippet || '—'}
                        </p>
                        <div className="flex shrink-0 items-center gap-2">
                          <Badge className="bg-zinc-800 text-zinc-300">{fa(s.msgs)} پیام</Badge>
                          <span className="text-[10px] text-zinc-600">{fmtDateTime(s.lastAt)}</span>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[10px] text-zinc-600" dir="ltr">
                          {s.id}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setChatSession(s)}
                          className="h-7 border-emerald-800/60 bg-emerald-950/30 text-[10px] text-emerald-300 hover:bg-emerald-950/50"
                        >
                          <MessageSquare className="h-3 w-3" /> گفتگو
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ---------------- فاکتور دستی dialog ---------------- */}
      {createOpen ? (
        <InvoiceCreateDialog
          key={createSeq}
          onOpenChange={(o) => {
            if (!o) setCreateOpen(false)
          }}
          onDone={() => {
            setCreateOpen(false)
            void fetchInvoices()
            void loadOverview(true)
          }}
        />
      ) : null}

      {/* ---------------- invoice html preview ---------------- */}
      <Dialog open={invoiceHtml !== null} onOpenChange={(o) => !o && closeInvoiceHtml()}>
        <DialogContent dir="rtl" className="max-h-[90vh] border-zinc-800 bg-zinc-950 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="text-sm text-zinc-100">فاکتور {invoiceHtml?.number}</DialogTitle>
            <DialogDescription className="text-[11px]">
              پیش‌نمایش HTML فاکتور — همون چیزی که به تلگرام می‌ره.
            </DialogDescription>
          </DialogHeader>
          <iframe
            src={invoiceHtml?.url || undefined}
            title={`فاکتور ${invoiceHtml?.number ?? ''}`}
            className="h-[70vh] w-full rounded-lg border border-zinc-800 bg-white"
          />
        </DialogContent>
      </Dialog>

      {/* ---------------- support chat dialog ---------------- */}
      {chatSession ? (
        <SupportChatDialog
          session={chatSession}
          onOpenChange={(o) => {
            if (!o) setChatSession(null)
          }}
        />
      ) : null}
    </div>
  )
}
