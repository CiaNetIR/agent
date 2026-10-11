'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  Cloud,
  Cpu,
  Gauge,
  HardDrive,
  Loader2,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Server,
  Star,
  TestTube2,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { panelFetch, tehranTime } from '@/lib/panel'
import { useToast } from '@/hooks/use-toast'

/* ------------------------------- types ------------------------------- */

type ProviderKind = 'openai-compatible' | 'zai'
type ProviderStatus =
  | 'unknown'
  | 'connected'
  | 'error'
  | 'disabled'
  | 'needs-setup'

interface TestRecord {
  at: string
  ok: boolean
  latencyMs?: number
  model?: string
  error?: string
  errorKind?: string
}

interface ModelMeta {
  id: string
  name?: string
  source: 'auto' | 'manual'
  enabled: boolean
  addedAt: string
  lastTest?: TestRecord
}

interface Provider {
  id: string
  name: string
  kind: ProviderKind
  baseUrl?: string
  defaultModel?: string
  timeoutMs: number
  enabled: boolean
  models: ModelMeta[]
  lastTest?: TestRecord
  createdAt: string
  updatedAt: string
  keyMasked: string | null
  status: ProviderStatus
}

type CapabilityId = 'chat' | 'agent' | 'fast' | 'complex' | 'background' | 'telegram'

interface Defaults {
  selection: Partial<Record<CapabilityId, string>>
  fallbackOrder: string[]
  settings: {
    temperature?: number
    topP?: number
    maxTokens?: number
    retries: number
    streaming: boolean
  }
}

const CAPABILITIES: { id: CapabilityId; label: string; hint: string }[] = [
  { id: 'chat', label: 'گفتگوی عمومی', hint: 'چت پنل و آزمایش مدل' },
  { id: 'agent', label: 'ایجنت اصلی', hint: 'وظایف اصلی ایجنت سرور' },
  { id: 'fast', label: 'وظایف سریع', hint: 'پاسخ‌های سبک و کوتاه' },
  { id: 'complex', label: 'تحلیل و پیچیده', hint: 'برنامه‌ریزی و تحلیل سنگین' },
  { id: 'background', label: 'پس‌زمینه', hint: 'سرویس‌های خودکار' },
  { id: 'telegram', label: 'واتچر تلگرام', hint: 'رزرو — واتچر فعلاً کانفیگ خودش را دارد' },
]

const PRESETS: { id: string; label: string; baseUrl: string; keyHint: string; local?: boolean }[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyHint: 'کلید sk-… از platform.openai.com' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyHint: 'کلید sk-or-… از openrouter.ai' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', keyHint: 'کلید از platform.deepseek.com' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyHint: 'کلید از console.groq.com' },
  { id: 'zhipu', label: 'Z.ai / GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', keyHint: 'کلید از bigmodel.cn' },
  { id: 'ollama', label: 'Ollama (محلی)', baseUrl: 'http://127.0.0.1:11434/v1', keyHint: 'معمولاً بدون کلید', local: true },
  { id: 'lmstudio', label: 'LM Studio (محلی)', baseUrl: 'http://127.0.0.1:1234/v1', keyHint: 'معمولاً بدون کلید', local: true },
  { id: 'vllm', label: 'vLLM (سرور)', baseUrl: 'http://127.0.0.1:8000/v1', keyHint: 'معمولاً بدون کلید', local: true },
  { id: 'localai', label: 'LocalAI', baseUrl: 'http://127.0.0.1:8080/v1', keyHint: 'معمولاً بدون کلید', local: true },
  { id: 'custom', label: 'سفارشی (OpenAI-سازگار)', baseUrl: '', keyHint: 'هر سرویس سازگار با OpenAI' },
]

const STATUS_META: Record<ProviderStatus, { label: string; cls: string; dot: string }> = {
  connected: { label: 'متصل', cls: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30', dot: 'bg-emerald-400' },
  error: { label: 'خطا', cls: 'bg-red-500/10 text-red-300 ring-red-500/30', dot: 'bg-red-400' },
  unknown: { label: 'آزمایش‌نشده', cls: 'bg-zinc-800 text-zinc-300 ring-zinc-700', dot: 'bg-zinc-500' },
  disabled: { label: 'غیرفعال', cls: 'bg-zinc-800/60 text-zinc-400 ring-zinc-800', dot: 'bg-zinc-600' },
  'needs-setup': { label: 'نیازمند تنظیم', cls: 'bg-amber-500/10 text-amber-300 ring-amber-500/30', dot: 'bg-amber-400' },
}

const ERROR_KIND_LABELS: Record<string, string> = {
  auth: 'کلید نامعتبر',
  endpoint: 'آدرس اشتباه',
  model: 'مدل ناموجود',
  permission: 'محدودیت دسترسی',
  timeout: 'Timeout',
  unreachable: 'سرویس در دسترس نیست',
  'bad-response': 'پاسخ نامعتبر',
  compat: 'ناسازگار با OpenAI',
  unknown: 'خطای ناشناخته',
}

/* ------------------------------- helpers ------------------------------- */

function kindLabel(kind: ProviderKind): string {
  return kind === 'zai' ? 'Z.ai داخلی' : 'OpenAI-سازگار'
}

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<{ res: Response; json: T }> {
  const res = await panelFetch(path, init)
  const json = (await res.json().catch(() => ({}))) as T
  return { res, json }
}

/* ============================== main ============================== */

export default function LlmManager() {
  const { toast } = useToast()
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [defaults, setDefaults] = useState<Defaults | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [wizardOpen, setWizardOpen] = useState(false)
  const [editing, setEditing] = useState<Provider | null>(null)
  const [testing, setTesting] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setLoadErr('')
    try {
      const [{ res: r1, json: j1 }, { res: r2, json: j2 }] = await Promise.all([
        jsonFetch<{ ok: boolean; providers?: Provider[] }>('/api/panel/llm/providers'),
        jsonFetch<{ ok: boolean; defaults?: Defaults }>('/api/panel/llm/defaults'),
      ])
      if (r1.ok && j1.ok) setProviders(j1.providers || [])
      else setLoadErr('خواندن فهرست اتصال‌ها ممکن نشد')
      if (r2.ok && j2.ok && j2.defaults) setDefaults(j2.defaults)
    } catch {
      setLoadErr('ارتباط با سرور برقرار نشد')
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const testProviderNow = useCallback(
    async (p: Provider, modelId?: string) => {
      setTesting(`${p.id}:${modelId || 'default'}`)
      try {
        const { res, json } = await jsonFetch<{ ok: boolean; error?: string; kind?: string }>(
          `/api/panel/llm/providers/${p.id}/test`,
          { method: 'POST', body: JSON.stringify({ modelId }) }
        )
        if (res.ok && json.ok) {
          toast({ title: '✅ اتصال موفق', description: `${p.name} پاسخ داد` })
        } else {
          toast({
            title: '❌ تست ناموفق',
            description: `${p.name}: ${json.error || 'خطا'}`,
            variant: 'destructive',
          })
        }
        await refresh()
      } catch {
        toast({ title: '❌ تست ناموفق', description: 'ارتباط با سرور برقرار نشد', variant: 'destructive' })
      } finally {
        setTesting(null)
      }
    },
    [refresh, toast]
  )

  const deleteProviderNow = useCallback(
    async (p: Provider) => {
      if (!window.confirm(`اتصال «${p.name}» و همه مدل‌هایش حذف شود؟ این عمل قابل بازگشت نیست.`)) return
      setBusy(true)
      try {
        const { res, json } = await jsonFetch<{ ok: boolean; error?: string }>(
          `/api/panel/llm/providers/${p.id}`,
          { method: 'DELETE' }
        )
        if (res.ok && json.ok) {
          toast({ title: 'حذف شد', description: p.name })
          await refresh()
        } else {
          toast({ title: 'حذف ناموفق', description: json.error || '', variant: 'destructive' })
        }
      } finally {
        setBusy(false)
      }
    },
    [refresh, toast]
  )

  const filtered = useMemo(() => {
    if (!providers) return null
    const q = search.trim().toLowerCase()
    if (!q) return providers
    return providers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.baseUrl || '').toLowerCase().includes(q) ||
        p.models.some((m) => m.id.toLowerCase().includes(q))
    )
  }, [providers, search])

  /* ---------- render ---------- */

  if (!providers || !defaults) {
    if (loadErr) {
      return (
        <Card className="border-red-900/50 bg-red-950/20">
          <CardContent className="flex items-center justify-between gap-3 p-4 text-sm text-red-300">
            <span>{loadErr}</span>
            <Button size="sm" variant="outline" onClick={() => void refresh()}>
              <RefreshCw className="h-3.5 w-3.5" /> تلاش مجدد
            </Button>
          </CardContent>
        </Card>
      )
    }
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full rounded-xl bg-zinc-800/60" />
        <Skeleton className="h-32 w-full rounded-xl bg-zinc-800/60" />
        <Skeleton className="h-48 w-full rounded-xl bg-zinc-800/60" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <h3 className="text-sm font-extrabold text-zinc-100">اتصال‌ها و مدل‌های هوش مصنوعی</h3>
            <p className="text-[11px] text-zinc-500">
              {providers.length === 0
                ? 'هنوز اتصالی ثبت نشده — با دکمه «اتصال جدید» شروع کن'
                : `${providers.length} اتصال — ${providers.reduce((a, p) => a + p.models.length, 0)} مدل`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {providers.length > 0 && (
            <div className="relative">
              <Search className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-500" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="جست‌وجو…"
                className="h-9 w-40 rounded-lg border-zinc-800 bg-zinc-900/70 pr-8 text-xs text-zinc-200 placeholder:text-zinc-600"
              />
            </div>
          )}
          <Button size="sm" variant="outline" onClick={() => void refresh()} className="h-9 border-zinc-800 bg-zinc-900/70 text-zinc-300">
            <RefreshCw className="h-3.5 w-3.5" /> به‌روزرسانی
          </Button>
          <Button size="sm" onClick={() => setWizardOpen(true)} className="h-9 bg-emerald-600 text-white hover:bg-emerald-500">
            <Plus className="h-4 w-4" /> اتصال جدید
          </Button>
        </div>
      </div>

      {filtered && filtered.length === 0 && providers.length > 0 && (
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="p-8 text-center text-sm text-zinc-500">
            نتیجه‌ای برای «{search}» پیدا نشد.
          </CardContent>
        </Card>
      )}

      {/* provider cards */}
      <div className="space-y-3">
        {filtered?.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            expanded={expanded === p.id}
            onToggle={() => setExpanded(expanded === p.id ? null : p.id)}
            onTest={(mid) => void testProviderNow(p, mid)}
            onEdit={() => setEditing(p)}
            onDelete={() => void deleteProviderNow(p)}
            testing={testing === `${p.id}:default`}
            testingModel={testing}
            onChanged={refresh}
            busy={busy}
          />
        ))}
      </div>

      {/* defaults & fallback */}
      <DefaultsPanel
        providers={providers}
        defaults={defaults}
        onChanged={async (d) => {
          setDefaults(d)
        }}
      />

      {/* local models note */}
      <Card className="border-zinc-800 bg-zinc-900/50">
        <CardContent className="space-y-2 p-4 text-[12px] leading-6 text-zinc-400">
          <p className="flex items-center gap-1.5 font-bold text-zinc-300">
            <HardDrive className="h-3.5 w-3.5 text-amber-400" /> نکته مدل‌های محلی
          </p>
          <p>
            آدرس‌های <code dir="ltr" className="rounded bg-zinc-800 px-1">127.0.0.1</code> از دید{' '}
            <b>سرورِ پنل</b> به همان سرور اشاره می‌کنند، نه کامپیوتر شما. اگر Ollama یا LM Studio روی
            رایانه شخصی‌تان اجراست، پنل روی VPS نمی‌تواند مستقیم به آن وصل شود — برای این حالت مدل را
            روی سرور نصب کنید یا از یک تونل امن (مثل WireGuard یا Tailscale) استفاده کنید و آدرس تونل را
            وارد کنید.
          </p>
          <p>
            «مدل محلی در دسترس نیست» به معنی «مدل خراب است» نیست — فقط یعنی سرویس از سرور پنل قابل
            دسترسی نیست.
          </p>
        </CardContent>
      </Card>

      {/* wizard */}
      <AddProviderWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onSaved={async (id) => {
          await refresh()
          setExpanded(id)
          toast({ title: '✅ اتصال ذخیره شد', description: 'حالا می‌توانید مدل‌ها را مدیریت کنید' })
        }}
      />

      {/* edit dialog */}
      {editing && (
        <EditProviderDialog
          provider={editing}
          onOpenChange={(o) => !o && setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await refresh()
          }}
        />
      )}
    </div>
  )
}

/* ============================== provider card ============================== */

function ProviderCard(props: {
  provider: Provider
  expanded: boolean
  onToggle: () => void
  onTest: (modelId?: string) => void
  onEdit: () => void
  onDelete: () => void
  testing: boolean
  testingModel: string | null
  onChanged: () => Promise<void>
  busy: boolean
}) {
  const { provider: p } = props
  const { toast } = useToast()
  const st = STATUS_META[p.status] || STATUS_META.unknown
  const [manualId, setManualId] = useState('')
  const [discoverLoading, setDiscoverLoading] = useState(false)

  const toggleEnabled = async () => {
    const { res, json } = await jsonFetch<{ ok: boolean; error?: string }>(
      `/api/panel/llm/providers/${p.id}`,
      { method: 'PATCH', body: JSON.stringify({ enabled: !p.enabled }) }
    )
    if (res.ok && json.ok) {
      toast({ title: p.enabled ? 'غیرفعال شد' : 'فعال شد', description: p.name })
      await props.onChanged()
    } else {
      toast({ title: 'خطا', description: json.error || '', variant: 'destructive' })
    }
  }

  const discoverModels = async () => {
    setDiscoverLoading(true)
    try {
      const { res, json } = await jsonFetch<{
        ok: boolean
        models?: { id: string; name?: string }[]
        error?: string
      }>(`/api/panel/llm/providers/${p.id}/models`)
      if (res.ok && json.ok && json.models) {
        if (json.models.length === 0) {
          toast({ title: 'فهرست خالی بود', description: 'مدل را دستی اضافه کنید' })
        }
        // register each discovered model (dedup server-side)
        let added = 0
        for (const m of json.models.slice(0, 100)) {
          const r = await jsonFetch<{ ok: boolean }>(`/api/panel/llm/providers/${p.id}/models`, {
            method: 'POST',
            body: JSON.stringify({ modelId: m.id, name: m.name }),
          })
          if (r.res.ok && r.json.ok) added++
        }
        toast({
          title: `شناسایی انجام شد (${added} مدل جدید)`,
          description: added === 0 ? 'همه مدل‌ها از قبل ثبت بودند' : undefined,
        })
        await props.onChanged()
      } else {
        toast({
          title: '❌ شناسایی خودکار ناموفق',
          description: `${json.error || 'خطا'} — می‌توانید مدل را دستی اضافه کنید`,
          variant: 'destructive',
        })
      }
    } finally {
      setDiscoverLoading(false)
    }
  }

  const addManual = async () => {
    const id = manualId.trim()
    if (!id) return
    const { res, json } = await jsonFetch<{ ok: boolean; error?: string }>(
      `/api/panel/llm/providers/${p.id}/models`,
      { method: 'POST', body: JSON.stringify({ modelId: id }) }
    )
    if (res.ok && json.ok) {
      setManualId('')
      await props.onChanged()
    } else {
      toast({ title: 'خطا در افزودن', description: json.error || '', variant: 'destructive' })
    }
  }

  const removeModel = async (mid: string) => {
    if (!window.confirm(`مدل «${mid}» حذف شود؟`)) return
    await jsonFetch('/api/panel/llm/models', {
      method: 'DELETE',
      body: JSON.stringify({ providerId: p.id, modelId: mid }),
    })
    await props.onChanged()
  }

  const toggleModel = async (mid: string, enabled: boolean) => {
    await jsonFetch('/api/panel/llm/models', {
      method: 'PATCH',
      body: JSON.stringify({ providerId: p.id, modelId: mid, enabled }),
    })
    await props.onChanged()
  }

  const setDefault = async (mid: string) => {
    await jsonFetch(`/api/panel/llm/providers/${p.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ defaultModel: mid }),
    })
    await props.onChanged()
  }

  return (
    <Card className="border-zinc-800 bg-zinc-900/70">
      <CardHeader className="cursor-pointer pb-3" onClick={props.onToggle}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ${p.kind === 'zai' ? 'bg-amber-500/10 ring-amber-500/30' : 'bg-emerald-500/10 ring-emerald-500/30'}`}>
              {p.kind === 'zai' ? <Zap className="h-4.5 w-4.5 text-amber-400" /> : <Cloud className="h-4.5 w-4.5 text-emerald-400" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-bold text-zinc-100">{p.name}</span>
                <Badge variant="outline" className={`h-5 gap-1 px-1.5 text-[10px] ${st.cls}`}>
                  <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} /> {st.label}
                </Badge>
                <Badge variant="outline" className="h-5 bg-zinc-800/60 px-1.5 text-[10px] text-zinc-400">
                  {kindLabel(p.kind)}
                </Badge>
                {!p.enabled && (
                  <Badge variant="outline" className="h-5 bg-zinc-800/40 px-1.5 text-[10px] text-zinc-500">
                    غیرفعال
                  </Badge>
                )}
              </div>
              <p className="mt-0.5 truncate text-[11px] text-zinc-500" dir="ltr">
                {p.baseUrl || 'SDK داخلی سندباکس'}
                {p.keyMasked ? ` — ${p.keyMasked}` : p.kind === 'openai-compatible' ? ' — بدون کلید' : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
            <span className="hidden text-[10.5px] text-zinc-500 sm:inline">
              {p.models.length} مدل{p.defaultModel ? ` — پیش‌فرض: ${p.defaultModel}` : ''}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={props.testing || !p.enabled}
              onClick={() => props.onTest()}
              className="h-7 border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-300"
            >
              {props.testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube2 className="h-3 w-3" />}
              تست
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={props.onEdit}
              className="h-7 border-zinc-700 bg-zinc-900 px-2 text-[11px] text-zinc-300"
            >
              <Pencil className="h-3 w-3" />
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={props.onDelete}
              disabled={props.busy}
              className="h-7 border-zinc-800 bg-zinc-900 px-2 text-[11px] text-red-300 hover:bg-red-950/40"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
            <Switch checked={p.enabled} onCheckedChange={() => void toggleEnabled()} aria-label="فعال/غیرفعال" />
            <ChevronDown
              className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform ${props.expanded ? 'rotate-180' : ''}`}
            />
          </div>
        </div>
        {p.lastTest && (
          <p className="mt-1.5 text-[10.5px] text-zinc-500">
            آخرین تست: {tehranTime(p.lastTest.at)} —{' '}
            {p.lastTest.ok ? (
              <span className="text-emerald-400">
                موفق ({p.lastTest.latencyMs ?? '؟'}ms{p.lastTest.model ? ` — ${p.lastTest.model}` : ''})
              </span>
            ) : (
              <span className="text-red-400">{p.lastTest.error}</span>
            )}
          </p>
        )}
      </CardHeader>

      {props.expanded && (
        <CardContent className="border-t border-zinc-800/70 pt-4">
          {/* discover + manual add */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {p.kind === 'openai-compatible' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void discoverModels()}
                disabled={discoverLoading}
                className="h-8 border-zinc-700 bg-zinc-900 text-[11px] text-zinc-300"
              >
                {discoverLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                دریافت فهرست مدل‌ها
              </Button>
            )}
            <div className="flex items-center gap-1.5">
              <Input
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void addManual()}
                placeholder="شناسه مدل (مثلاً gpt-4o-mini)"
                dir="ltr"
                className="h-8 w-56 rounded-lg border-zinc-800 bg-zinc-950/70 text-xs text-zinc-200 placeholder:text-zinc-600"
              />
              <Button size="sm" variant="outline" onClick={() => void addManual()} className="h-8 border-zinc-700 bg-zinc-900 text-[11px] text-zinc-300">
                <Plus className="h-3.5 w-3.5" /> افزودن دستی
              </Button>
            </div>
          </div>

          {p.models.length === 0 ? (
            <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">
              هنوز مدلی برای این اتصال ثبت نشده — فهرست را دریافت کنید یا شناسه مدل را دستی وارد کنید.
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-zinc-800">
              <table className="w-full text-right text-xs">
                <thead className="bg-zinc-950/60 text-[10.5px] text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 font-bold">مدل</th>
                    <th className="px-2 py-2 font-bold">منبع</th>
                    <th className="px-2 py-2 font-bold">وضعیت</th>
                    <th className="px-2 py-2 font-bold">آخرین تست</th>
                    <th className="px-2 py-2 font-bold">عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {p.models.map((m) => {
                    const mTesting = props.testingModel === `${p.id}:${m.id}`
                    return (
                      <tr key={m.id} className="border-t border-zinc-800/70 hover:bg-zinc-950/40">
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] text-zinc-200" dir="ltr">{m.id}</span>
                            {p.defaultModel === m.id && (
                              <Badge className="h-4 gap-0.5 bg-amber-500/10 px-1 text-[9px] text-amber-300 ring-1 ring-amber-500/30">
                                <Star className="h-2.5 w-2.5" /> پیش‌فرض
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-zinc-500">{m.source === 'auto' ? 'خودکار' : 'دستی'}</td>
                        <td className="px-2 py-2">
                          {m.enabled ? (
                            <span className="text-emerald-400">فعال</span>
                          ) : (
                            <span className="text-zinc-500">غیرفعال</span>
                          )}
                        </td>
                        <td className="px-2 py-2 text-[10.5px] text-zinc-500">
                          {m.lastTest
                            ? m.lastTest.ok
                              ? `${tehranTime(m.lastTest.at)} (${m.lastTest.latencyMs ?? '؟'}ms)`
                              : `${tehranTime(m.lastTest.at)} — ${m.lastTest.error?.slice(0, 40)}`
                            : '—'}
                        </td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm" variant="ghost"
                              disabled={mTesting || !p.enabled}
                              onClick={() => props.onTest(m.id)}
                              className="h-6 w-6 p-0 text-zinc-400 hover:text-emerald-300"
                              aria-label={`تست ${m.id}`}
                            >
                              {mTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <TestTube2 className="h-3 w-3" />}
                            </Button>
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => void setDefault(m.id)}
                              className="h-6 w-6 p-0 text-zinc-400 hover:text-amber-300"
                              aria-label={`پیش‌فرض کردن ${m.id}`}
                              title="پیش‌فرض این اتصال"
                            >
                              <Star className="h-3 w-3" />
                            </Button>
                            <Switch
                              checked={m.enabled}
                              onCheckedChange={(v) => void toggleModel(m.id, v)}
                              className="scale-75"
                              aria-label={`فعال/غیرفعال ${m.id}`}
                            />
                            <Button
                              size="sm" variant="ghost"
                              onClick={() => void removeModel(m.id)}
                              className="h-6 w-6 p-0 text-zinc-500 hover:text-red-300"
                              aria-label={`حذف ${m.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

/* ============================== defaults panel ============================== */

function DefaultsPanel(props: { providers: Provider[]; defaults: Defaults; onChanged: (d: Defaults) => Promise<void> | void }) {
  const { toast } = useToast()
  const [d, setD] = useState<Defaults>(props.defaults)
  const [saving, setSaving] = useState(false)
  useEffect(() => setD(props.defaults), [props.defaults])

  const enabledProviders = props.providers.filter((p) => p.enabled)

  const save = async (next: Defaults) => {
    setSaving(true)
    try {
      const { res, json } = await jsonFetch<{ ok: boolean; defaults?: Defaults; error?: string }>(
        '/api/panel/llm/defaults',
        { method: 'PUT', body: JSON.stringify(next) }
      )
      if (res.ok && json.ok && json.defaults) {
        setD(json.defaults)
        await props.onChanged(json.defaults)
        toast({ title: '✅ ذخیره شد', description: 'تنظیمات مدل‌ها اعمال شد و پس از Reload هم می‌ماند' })
      } else {
        toast({ title: 'ذخیره ناموفق', description: json.error || '', variant: 'destructive' })
      }
    } finally {
      setSaving(false)
    }
  }

  const optionValue = (pid: string, mid?: string) => (mid ? `${pid}/${mid}` : pid)
  const parseValue = (v: string) => {
    const [pid, ...rest] = v.split('/')
    return { pid, mid: rest.join('/') || undefined }
  }

  const setCapability = (cap: CapabilityId, value: string) => {
    const next = { ...d, selection: { ...d.selection, [cap]: value || undefined } }
    setD(next)
    void save(next)
  }

  const toggleFallback = (pid: string) => {
    const cur = d.fallbackOrder.includes(pid)
    const next = {
      ...d,
      fallbackOrder: cur ? d.fallbackOrder.filter((x) => x !== pid) : [...d.fallbackOrder, pid],
    }
    setD(next)
    void save(next)
  }

  const moveFallback = (pid: string, dir: -1 | 1) => {
    const arr = [...d.fallbackOrder]
    const i = arr.indexOf(pid)
    const j = i + dir
    if (i < 0 || j < 0 || j >= arr.length) return
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
    const next = { ...d, fallbackOrder: arr }
    setD(next)
    void save(next)
  }

  return (
    <Card className="border-zinc-800 bg-zinc-900/70">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
          <Gauge className="h-4 w-4 text-emerald-400" /> مدل هر قابلیت + جایگزین (Fallback)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {enabledProviders.length === 0 ? (
          <p className="rounded-lg border border-dashed border-zinc-800 p-4 text-center text-xs text-zinc-500">
            ابتدا حداقل یک اتصال فعال بسازید تا بتوانید برای هر قابلیت مدل انتخاب کنید.
          </p>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {CAPABILITIES.map((cap) => (
                <div key={cap.id} className="space-y-1.5">
                  <Label className="text-[11.5px] font-bold text-zinc-300">
                    {cap.label}
                    <span className="ms-1.5 font-normal text-zinc-600">— {cap.hint}</span>
                  </Label>
                  <Select
                    value={d.selection[cap.id] || ''}
                    onValueChange={(v) => setCapability(cap.id, v)}
                    dir="rtl"
                  >
                    <SelectTrigger className="h-9 rounded-lg border-zinc-800 bg-zinc-950/70 text-xs text-zinc-200">
                      <SelectValue placeholder="مدل پیش‌فرض این قابلیت" />
                    </SelectTrigger>
                    <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-200">
                      <SelectItem value=" " className="text-xs text-zinc-500">— تنظیم‌نشده —</SelectItem>
                      {enabledProviders.map((p) => (
                        <div key={p.id}>
                          <SelectItem value={optionValue(p.id)} className="text-xs">
                            ★ {p.name} — مدل پیش‌فرض اتصال{p.defaultModel ? ` (${p.defaultModel})` : ''}
                          </SelectItem>
                          {p.models
                            .filter((m) => m.enabled)
                            .map((m) => (
                              <SelectItem key={m.id} value={optionValue(p.id, m.id)} className="text-xs" dir="ltr">
                                {`${p.name} / ${m.id}`}
                              </SelectItem>
                            ))}
                        </div>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {/* fallback order */}
            <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3">
              <p className="text-[11.5px] font-bold text-zinc-300">
                ترتیب جایگزینی هنگام خطای مدل اصلی
              </p>
              <p className="text-[10.5px] leading-5 text-zinc-500">
                اگر مدلِ انتخاب‌شده‌ی یک قابلیت پاسخ نداد، به‌ترتیب از این اتصال‌ها تلاش می‌شود. متن گفتگو به
                اتصال بعدی منتقل می‌شود؛ کلیدها فقط سمت سرور می‌مانند.
              </p>
              {enabledProviders.map((p) => {
                const idx = d.fallbackOrder.indexOf(p.id)
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-zinc-800/70 bg-zinc-900/60 px-2.5 py-1.5"
                  >
                    <label className="flex items-center gap-2 text-xs text-zinc-300">
                      <input
                        type="checkbox"
                        checked={idx >= 0}
                        onChange={() => toggleFallback(p.id)}
                        className="h-3.5 w-3.5 accent-emerald-500"
                        aria-label={`جایگزین: ${p.name}`}
                      />
                      {p.name}
                      {idx >= 0 && <span className="text-[10px] text-zinc-500">(اولویت {idx + 1})</span>}
                    </label>
                    {idx >= 0 && (
                      <div className="flex items-center gap-0.5">
                        <Button
                          size="sm" variant="ghost" disabled={idx === 0}
                          onClick={() => moveFallback(p.id, -1)}
                          className="h-6 w-6 p-0 text-zinc-400"
                          aria-label="بالاتر"
                        >
                          <ArrowUp className="h-3 w-3" />
                        </Button>
                        <Button
                          size="sm" variant="ghost" disabled={idx === d.fallbackOrder.length - 1}
                          onClick={() => moveFallback(p.id, 1)}
                          className="h-6 w-6 p-0 text-zinc-400"
                          aria-label="پایین‌تر"
                        >
                          <ArrowDown className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* generation settings */}
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 sm:grid-cols-3 lg:grid-cols-5">
              <div className="space-y-1">
                <Label className="text-[10.5px] text-zinc-400">Temperature</Label>
                <Input
                  type="number" step="0.1" min="0" max="2" dir="ltr"
                  value={d.settings.temperature ?? ''}
                  placeholder="پیش‌فرض سرویس"
                  onChange={(e) => setD({ ...d, settings: { ...d.settings, temperature: e.target.value === '' ? undefined : Number(e.target.value) } })}
                  className="h-8 rounded-lg border-zinc-800 bg-zinc-950/70 text-xs text-zinc-200"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10.5px] text-zinc-400">Top P</Label>
                <Input
                  type="number" step="0.05" min="0" max="1" dir="ltr"
                  value={d.settings.topP ?? ''}
                  placeholder="پیش‌فرض سرویس"
                  onChange={(e) => setD({ ...d, settings: { ...d.settings, topP: e.target.value === '' ? undefined : Number(e.target.value) } })}
                  className="h-8 rounded-lg border-zinc-800 bg-zinc-950/70 text-xs text-zinc-200"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10.5px] text-zinc-400">حداکثر توکن خروجی</Label>
                <Input
                  type="number" min="1" max="200000" dir="ltr"
                  value={d.settings.maxTokens ?? ''}
                  placeholder="پیش‌فرض سرویس"
                  onChange={(e) => setD({ ...d, settings: { ...d.settings, maxTokens: e.target.value === '' ? undefined : Number(e.target.value) } })}
                  className="h-8 rounded-lg border-zinc-800 bg-zinc-950/70 text-xs text-zinc-200"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-[10.5px] text-zinc-400">تلاش مجدد</Label>
                <Select
                  value={String(d.settings.retries)}
                  onValueChange={(v) => setD({ ...d, settings: { ...d.settings, retries: Number(v) } })}
                >
                  <SelectTrigger className="h-8 rounded-lg border-zinc-800 bg-zinc-950/70 text-xs text-zinc-200">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="border-zinc-800 bg-zinc-900 text-zinc-200">
                    {[0, 1, 2].map((n) => (
                      <SelectItem key={n} value={String(n)} className="text-xs">{n} بار</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end justify-between gap-2">
                <div className="space-y-1">
                  <Label className="text-[10.5px] text-zinc-400">Streaming</Label>
                  <Switch
                    checked={d.settings.streaming}
                    onCheckedChange={(v) => setD({ ...d, settings: { ...d.settings, streaming: v } })}
                    aria-label="Streaming"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" onClick={() => void save(d)} disabled={saving} className="h-8 bg-emerald-600 text-xs text-white hover:bg-emerald-500">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                ذخیره تنظیمات
              </Button>
              <Button
                size="sm" variant="outline"
                onClick={() => {
                  const next: Defaults = { selection: {}, fallbackOrder: [], settings: { retries: 1, streaming: true } }
                  setD(next)
                  void save(next)
                }}
                className="h-8 border-zinc-700 bg-zinc-900 text-xs text-zinc-400"
              >
                <RotateCcw className="h-3.5 w-3.5" /> بازگردانی پیش‌فرض
              </Button>
              {saving && <span className="text-[10.5px] text-zinc-500">در حال ذخیره…</span>}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

/* ============================== add wizard ============================== */

function AddProviderWizard(props: { open: boolean; onOpenChange: (o: boolean) => void; onSaved: (id: string) => Promise<void> | void }) {
  const { toast } = useToast()
  const [step, setStep] = useState(1)
  const [preset, setPreset] = useState('openai')
  const [kind, setKind] = useState<ProviderKind>('openai-compatible')
  const [name, setName] = useState('')
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1')
  const [apiKey, setApiKey] = useState('')
  const [defaultModel, setDefaultModel] = useState('')
  const [timeoutSec, setTimeoutSec] = useState(60)
  const [remoteModels, setRemoteModels] = useState<{ id: string; name?: string }[] | null>(null)
  const [discoverLoading, setDiscoverLoading] = useState(false)
  const [testResult, setTestResult] = useState<TestRecord | null>(null)
  const [testErr, setTestErr] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!props.open) {
      // reset wizard state on close
      setStep(1); setPreset('openai'); setKind('openai-compatible'); setName('')
      setBaseUrl('https://api.openai.com/v1'); setApiKey(''); setDefaultModel('')
      setTimeoutSec(60); setRemoteModels(null); setTestResult(null); setTestErr(''); setTesting(false)
    }
  }, [props.open])

  const activePreset = PRESETS.find((x) => x.id === preset) || PRESETS[PRESETS.length - 1]

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)
    setPreset(id)
    if (!p) return
    setBaseUrl(p.baseUrl)
    if (!name) setName(p.label)
    setKind('openai-compatible')
  }

  const draft = useMemo(
    () => ({ kind, name: name || 'پیش‌نویس', baseUrl, apiKey: apiKey || undefined, defaultModel: defaultModel || undefined, timeoutMs: timeoutSec * 1000 }),
    [kind, name, baseUrl, apiKey, defaultModel, timeoutSec]
  )

  const draftCheck = async (action: 'models' | 'test', modelId?: string) => {
    const { res, json } = await jsonFetch<{
      ok: boolean
      models?: { id: string; name?: string }[]
      record?: TestRecord
      error?: string
      kind?: string
    }>('/api/panel/llm/providers/draft-check', {
      method: 'POST',
      body: JSON.stringify({ action, draft, modelId }),
    })
    return { res, json }
  }

  const discover = async () => {
    setDiscoverLoading(true)
    try {
      const { res, json } = await draftCheck('models')
      if (res.ok && json.ok && json.models) {
        setRemoteModels(json.models)
        if (json.models.length === 0) toast({ title: 'فهرست خالی بود', description: 'شناسه مدل را دستی وارد کنید' })
      } else {
        toast({
          title: '❌ شناسایی خودکار ناموفق',
          description: `${json.error || 'خطا'} — افزودن دستی مدل همچنان ممکن است`,
          variant: 'destructive',
        })
        setRemoteModels([])
      }
    } finally {
      setDiscoverLoading(false)
    }
  }

  const runTest = async () => {
    setTesting(true); setTestErr(''); setTestResult(null)
    try {
      const { res, json } = await draftCheck('test', defaultModel || undefined)
      if (res.ok && json.ok && json.record) {
        setTestResult(json.record)
      } else {
        setTestErr(json.error || 'خطای ناشناخته')
      }
    } catch {
      setTestErr('ارتباط با سرور برقرار نشد')
    } finally {
      setTesting(false)
    }
  }

  const canNext1 = kind === 'zai' || (baseUrl.trim().startsWith('http') && name.trim().length > 0)

  const save = async () => {
    setSaving(true)
    try {
      const { res, json } = await jsonFetch<{ ok: boolean; provider?: { id: string }; error?: string }>(
        '/api/panel/llm/providers',
        {
          method: 'POST',
          body: JSON.stringify({
            kind,
            name: name.trim(),
            baseUrl: kind === 'zai' ? undefined : baseUrl.trim(),
            apiKey: apiKey.trim() || undefined,
            defaultModel: defaultModel.trim() || undefined,
            timeoutMs: timeoutSec * 1000,
            enabled: true,
          }),
        }
      )
      if (res.ok && json.ok && json.provider) {
        props.onOpenChange(false)
        await props.onSaved(json.provider.id)
      } else {
        toast({ title: 'ذخیره ناموفق', description: json.error || '', variant: 'destructive' })
      }
    } finally {
      setSaving(false)
    }
  }

  const steps = ['نوع اتصال', 'تنظیمات', 'مدل‌ها', 'تست و ذخیره']

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent dir="rtl" className="max-h-[90vh] max-w-lg overflow-y-auto border-zinc-800 bg-zinc-950 text-zinc-100 sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-extrabold">
            <Plug className="h-4 w-4 text-emerald-400" /> افزودن اتصال جدید
          </DialogTitle>
          <DialogDescription className="text-[11px] text-zinc-500">
            مرحله {step} از ۴ — {steps[step - 1]}
          </DialogDescription>
        </DialogHeader>

        {/* step indicator */}
        <div className="flex items-center gap-1" aria-hidden>
          {steps.map((s, i) => (
            <div key={s} className="flex-1">
              <div className={`h-1 rounded-full ${i < step ? 'bg-emerald-500' : 'bg-zinc-800'}`} />
            </div>
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => { setKind('openai-compatible') }}
              className={`w-full rounded-xl border p-3 text-right transition-colors ${kind === 'openai-compatible' ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'}`}
            >
              <p className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                <Cloud className="h-4 w-4 text-emerald-400" /> سرویس ابری یا API (OpenAI-سازگار)
              </p>
              <p className="mt-1 text-[11px] leading-5 text-zinc-500">
                OpenAI، OpenRouter، DeepSeek، Groq، Z.ai و هر سرویس سازگار با OpenAI
              </p>
            </button>
            <button
              type="button"
              onClick={() => { setKind('zai'); setName('Z.ai داخلی'); setDefaultModel('glm-4-plus') }}
              className={`w-full rounded-xl border p-3 text-right transition-colors ${kind === 'zai' ? 'border-emerald-500/50 bg-emerald-500/5' : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'}`}
            >
              <p className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
                <Zap className="h-4 w-4 text-amber-400" /> مدل داخلی سندباکس (Z.ai)
              </p>
              <p className="mt-1 text-[11px] leading-5 text-zinc-500">
                GLM-4-Plus از طریق SDK داخلی — بدون کلید و آدرس، فقط داخل همین سرور
              </p>
            </button>

            {kind === 'openai-compatible' && (
              <div className="space-y-1.5 pt-1">
                <Label className="text-[11.5px] text-zinc-300">سرویس پیشنهادی</Label>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => applyPreset(p.id)}
                      className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                        preset === p.id
                          ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-300'
                          : 'border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-[11.5px] text-zinc-300">نام دلخواه اتصال *</Label>
              <Input
                value={name} onChange={(e) => setName(e.target.value)}
                placeholder="مثلاً: OpenAI اصلی"
                className="h-9 rounded-lg border-zinc-800 bg-zinc-950/70 text-xs text-zinc-200"
              />
            </div>
            {kind === 'openai-compatible' && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-[11.5px] text-zinc-300">Base URL *</Label>
                  <Input
                    value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)}
                    dir="ltr" placeholder="https://…/v1"
                    className="h-9 rounded-lg border-zinc-800 bg-zinc-950/70 font-mono text-xs text-zinc-200"
                  />
                  <p className="text-[10.5px] text-zinc-500">{activePreset.keyHint}</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11.5px] text-zinc-300">API Key</Label>
                  <Input
                    type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                    dir="ltr" placeholder="sk-…"
                    className="h-9 rounded-lg border-zinc-800 bg-zinc-950/70 font-mono text-xs text-zinc-200"
                  />
                  <p className="text-[10.5px] text-zinc-500">
                    فقط سمت سرور ذخیره می‌شود (خارج از مسیر بکاپ گیت‌هاب) و در رابط کاربری هرگز کامل نمایش داده نمی‌شود.
                  </p>
                </div>
              </>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11.5px] text-zinc-300">مدل پیش‌فرض</Label>
                <Input
                  value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}
                  dir="ltr" placeholder="مثلاً gpt-4o-mini"
                  className="h-9 rounded-lg border-zinc-800 bg-zinc-950/70 font-mono text-xs text-zinc-200"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11.5px] text-zinc-300">Timeout (ثانیه)</Label>
                <Input
                  type="number" min="5" max="180" value={timeoutSec}
                  onChange={(e) => setTimeoutSec(Math.max(5, Math.min(180, Number(e.target.value) || 60)))}
                  dir="ltr"
                  className="h-9 rounded-lg border-zinc-800 bg-zinc-950/70 text-xs text-zinc-200"
                />
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <p className="text-[11.5px] leading-6 text-zinc-400">
              اگر سرویس شما فهرست مدل‌ها را پشتیبانی کند، دکمه زیر آن‌ها را می‌آورد. اگر نشد — مشکلی نیست؛
              شناسه مدل را دستی وارد کنید.
            </p>
            {kind === 'openai-compatible' && (
              <Button
                size="sm" variant="outline" onClick={() => void discover()} disabled={discoverLoading}
                className="h-8 border-zinc-700 bg-zinc-900 text-[11px] text-zinc-300"
              >
                {discoverLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                دریافت فهرست مدل‌ها (تست واقعی)
              </Button>
            )}
            {remoteModels && remoteModels.length > 0 && (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 p-1.5">
                {remoteModels.slice(0, 200).map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setDefaultModel(m.id)}
                    className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-right text-[11px] transition-colors ${
                      defaultModel === m.id ? 'bg-emerald-500/15 text-emerald-300' : 'text-zinc-400 hover:bg-zinc-900'
                    }`}
                  >
                    <span className="font-mono" dir="ltr">{m.id}</span>
                    {defaultModel === m.id && <CheckCircle2 className="h-3.5 w-3.5" />}
                  </button>
                ))}
              </div>
            )}
            <div className="space-y-1.5">
              <Label className="text-[11.5px] text-zinc-300">شناسه مدل (دستی)</Label>
              <Input
                value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)}
                dir="ltr" placeholder="model-id"
                className="h-9 rounded-lg border-zinc-800 bg-zinc-950/70 font-mono text-xs text-zinc-200"
              />
            </div>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-3 text-[11.5px] leading-6 text-zinc-300">
              <p><b className="text-zinc-200">نام:</b> {name || '—'}</p>
              <p><b className="text-zinc-200">نوع:</b> {kindLabel(kind)}</p>
              {kind === 'openai-compatible' && (
                <>
                  <p className="truncate" dir="ltr"><b className="text-zinc-200">Base URL:</b> {baseUrl}</p>
                  <p><b className="text-zinc-200">کلید:</b> {apiKey ? '✓ وارد شده' : '— بدون کلید'}</p>
                </>
              )}
              <p><b className="text-zinc-200">مدل:</b> <span dir="ltr">{defaultModel || '—'}</span></p>
            </div>

            {kind === 'openai-compatible' && (
              <>
                <Button
                  size="sm" onClick={() => void runTest()} disabled={testing}
                  className="h-9 bg-emerald-600 text-xs text-white hover:bg-emerald-500"
                >
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <TestTube2 className="h-4 w-4" />}
                  تست واقعی اتصال
                </Button>
                {testResult && testResult.ok && (
                  <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/30 p-3 text-xs text-emerald-300">
                    ✅ اتصال موفق — {testResult.latencyMs ?? '؟'} میلی‌ثانیه
                    {testResult.model ? ` — مدل: ${testResult.model}` : ''}
                  </div>
                )}
                {testErr && (
                  <div className="space-y-1 rounded-lg border border-red-800/50 bg-red-950/30 p-3 text-xs text-red-300">
                    <p className="flex items-center gap-1.5 font-bold">
                      <AlertTriangle className="h-3.5 w-3.5" /> ❌ {testErr}
                    </p>
                    <p className="text-[10.5px] text-red-400/70">
                      می‌توانید تنظیمات را در مرحله ۲ اصلاح کنید یا بدون تست ذخیره کنید و بعداً دوباره تلاش کنید.
                    </p>
                  </div>
                )}
              </>
            )}
            <p className="text-[10.5px] leading-5 text-zinc-500">
              اتصال آزمایشی هنوز ذخیره نشده — با «ذخیره» ثبت می‌شود و بعداً از فهرست قابل ویرایش و تست است.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step > 1 && (
            <Button size="sm" variant="outline" onClick={() => setStep(step - 1)} className="border-zinc-700 bg-zinc-900 text-xs text-zinc-300">
              قبلی
            </Button>
          )}
          {step < 4 ? (
            <Button
              size="sm"
              disabled={step === 1 ? false : !canNext1}
              onClick={() => setStep(step + 1)}
              className="bg-emerald-600 text-xs text-white hover:bg-emerald-500"
            >
              بعدی
            </Button>
          ) : (
            <Button size="sm" onClick={() => void save()} disabled={saving || (kind === 'openai-compatible' && !canNext1)} className="bg-emerald-600 text-xs text-white hover:bg-emerald-500">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              ذخیره اتصال
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ============================== edit dialog ============================== */

function EditProviderDialog(props: { provider: Provider; onOpenChange: (o: boolean) => void; onSaved: () => Promise<void> | void }) {
  const { toast } = useToast()
  const { provider: p } = props
  const [name, setName] = useState(p.name)
  const [baseUrl, setBaseUrl] = useState(p.baseUrl || '')
  const [defaultModel, setDefaultModel] = useState(p.defaultModel || '')
  const [timeoutSec, setTimeoutSec] = useState(Math.round(p.timeoutMs / 1000))
  const [apiKey, setApiKey] = useState('')
  const [clearKey, setClearKey] = useState(false)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        defaultModel: defaultModel.trim() || undefined,
        timeoutMs: timeoutSec * 1000,
      }
      if (p.kind === 'openai-compatible') {
        body.baseUrl = baseUrl.trim()
        if (clearKey) body.apiKey = null
        else if (apiKey.trim()) body.apiKey = apiKey.trim()
      }
      const { res, json } = await jsonFetch<{ ok: boolean; error?: string }>(
        `/api/panel/llm/providers/${p.id}`,
        { method: 'PATCH', body: JSON.stringify(body) }
      )
      if (res.ok && json.ok) {
        toast({ title: '✅ ذخیره شد', description: 'تغییرات اعمال شد' })
        props.onOpenChange(false)
        await props.onSaved()
      } else {
        toast({ title: 'ذخیره ناموفق', description: json.error || '', variant: 'destructive' })
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={props.onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md border-zinc-800 bg-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm font-extrabold">
            <Pencil className="h-4 w-4 text-emerald-400" /> ویرایش «{p.name}»
          </DialogTitle>
          <DialogDescription className="text-[11px] text-zinc-500">
            نوع: {kindLabel(p.kind)} — کلید فعلی: {p.keyMasked || '—'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[11.5px] text-zinc-300">نام</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 rounded-lg border-zinc-800 bg-zinc-950/70 text-xs text-zinc-200" />
          </div>
          {p.kind === 'openai-compatible' && (
            <>
              <div className="space-y-1.5">
                <Label className="text-[11.5px] text-zinc-300">Base URL</Label>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} dir="ltr" className="h-9 rounded-lg border-zinc-800 bg-zinc-950/70 font-mono text-xs text-zinc-200" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11.5px] text-zinc-300">کلید جدید (اختیاری)</Label>
                <Input
                  type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                  placeholder="خالی = بدون تغییر" dir="ltr"
                  className="h-9 rounded-lg border-zinc-800 bg-zinc-950/70 font-mono text-xs text-zinc-200"
                />
                <label className="flex items-center gap-2 pt-1 text-[11px] text-red-300">
                  <input type="checkbox" checked={clearKey} onChange={(e) => { setClearKey(e.target.checked); if (e.target.checked) setApiKey('') }} className="h-3.5 w-3.5 accent-red-500" />
                  حذف کلید ذخیره‌شده
                </label>
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[11.5px] text-zinc-300">مدل پیش‌فرض</Label>
              <Input value={defaultModel} onChange={(e) => setDefaultModel(e.target.value)} dir="ltr" className="h-9 rounded-lg border-zinc-800 bg-zinc-950/70 font-mono text-xs text-zinc-200" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11.5px] text-zinc-300">Timeout (ثانیه)</Label>
              <Input
                type="number" min="5" max="180" value={timeoutSec}
                onChange={(e) => setTimeoutSec(Math.max(5, Math.min(180, Number(e.target.value) || 60)))}
                dir="ltr" className="h-9 rounded-lg border-zinc-800 bg-zinc-950/70 text-xs text-zinc-200"
              />
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button size="sm" variant="outline" onClick={() => props.onOpenChange(false)} className="border-zinc-700 bg-zinc-900 text-xs text-zinc-300">
            <X className="h-3.5 w-3.5" /> انصراف
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={saving} className="bg-emerald-600 text-xs text-white hover:bg-emerald-500">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            ذخیره
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
