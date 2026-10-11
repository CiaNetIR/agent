'use client'

import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { AlertCircle, Brain, Check, Cpu, Loader2, Pencil, Plus, RefreshCw, Save, SendHorizontal, Sparkles, Star, Trash2, Wifi, X, Zap } from 'lucide-react'
import { panelFetch, type LlmSettings } from '@/lib/panel'

type Settings = LlmSettings['settings']
interface Provider {
  id: string; name: string; kind: string; baseUrl: string; apiKey: string; hasKey: boolean
  model: string; enabled: boolean; isDefault: boolean; lastTestAt: string | null
  lastTestOk: boolean | null; lastTestMs: number | null; lastTestErr: string
  temperature: number; maxTokens: number; timeoutMs: number
}

const PROVIDER_KINDS = [
  { value: 'openai', label: 'OpenAI' }, { value: 'ollama', label: 'Ollama (محلی)' },
  { value: 'lmstudio', label: 'LM Studio' }, { value: 'vllm', label: 'vLLM' },
  { value: 'custom', label: 'سفارشی' }, { value: 'zai', label: 'Z.ai (سندباکس)' },
]
const KIND_COLORS: Record<string, string> = {
  zai: 'ci-provider-zai', openai: 'ci-provider-openai', ollama: 'ci-provider-ollama',
  lmstudio: 'ci-provider-local', vllm: 'ci-provider-local', custom: 'ci-provider-custom',
}

export default function LlmTab() {
  const { toast } = useToast()
  const [providers, setProviders] = useState<Provider[]>([])
  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null)
  const [chatInput, setChatInput] = useState(''); const [chatResult, setChatResult] = useState(''); const [chatBusy, setChatBusy] = useState(false)
  const [formName, setFormName] = useState(''); const [formKind, setFormKind] = useState('openai')
  const [formBaseUrl, setFormBaseUrl] = useState(''); const [formApiKey, setFormApiKey] = useState('')
  const [formModel, setFormModel] = useState(''); const [formIsDefault, setFormIsDefault] = useState(false)
  const [formTemp, setFormTemp] = useState(0.7); const [formMaxTok, setFormMaxTok] = useState(4096); const [formTimeout, setFormTimeout] = useState(90000)
  const [formSaving, setFormSaving] = useState(false); const [formTesting, setFormTesting] = useState(false)
  const [formTestResult, setFormTestResult] = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null)
  const [discovering, setDiscovering] = useState(false); const [discoveredModels, setDiscoveredModels] = useState<string[]>([])
  const [providerInfo, setProviderInfo] = useState<{ kind: string; label: string; model: string } | null>(null)

  const loadProviders = useCallback(async () => {
    try { const res = await panelFetch('/api/panel/llm-providers'); const data = await res.json(); if (data.ok) setProviders(data.providers || []) } catch { } finally { setLoading(false) }
  }, [])
  const loadSettings = useCallback(async () => {
    try { const res = await panelFetch('/api/panel/llm-settings'); const data = await res.json(); if (data.ok && data.settings) setSettings(data.settings) } catch { }
  }, [])
  const loadProviderInfo = useCallback(async () => {
    try { const res = await panelFetch('/api/panel/llm-chat'); const data = await res.json(); if (data.ok && data.provider) setProviderInfo(data.provider) } catch { }
  }, [])

  useEffect(() => { loadProviders(); loadSettings(); loadProviderInfo() }, [loadProviders, loadSettings, loadProviderInfo])

  const openAddForm = () => {
    setEditingProvider(null); setFormName(''); setFormKind('openai'); setFormBaseUrl(''); setFormApiKey('')
    setFormModel(''); setFormIsDefault(false); setFormTemp(0.7); setFormMaxTok(4096); setFormTimeout(90000)
    setFormTestResult(null); setDiscoveredModels([]); setShowAddForm(true)
  }
  const openEditForm = (p: Provider) => {
    setEditingProvider(p); setFormName(p.name); setFormKind(p.kind); setFormBaseUrl(p.baseUrl); setFormApiKey('')
    setFormModel(p.model); setFormIsDefault(p.isDefault); setFormTemp(p.temperature); setFormMaxTok(p.maxTokens); setFormTimeout(p.timeoutMs)
    setFormTestResult(null); setDiscoveredModels([]); setShowAddForm(true)
  }

  const handleDiscover = async () => {
    if (!formBaseUrl) { toast({ title: 'ابتدا Base URL را وارد کن', variant: 'destructive' }); return }
    setDiscovering(true)
    try {
      const res = await panelFetch('/api/panel/llm-providers', { method: 'POST', body: JSON.stringify({ action: 'discover', baseUrl: formBaseUrl, apiKey: formApiKey, kind: formKind }) })
      const data = await res.json()
      if (data.ok && data.models?.length) { setDiscoveredModels(data.models); toast({ title: `${data.models.length} مدل پیدا شد` }) }
      else toast({ title: 'مدلی پیدا نشد', description: data.error, variant: 'destructive' })
    } catch { toast({ title: 'شناسایی ناموفق', variant: 'destructive' }) } finally { setDiscovering(false) }
  }

  const handleTest = async () => {
    if (!formBaseUrl) { toast({ title: 'ابتدا Base URL را وارد کن', variant: 'destructive' }); return }
    setFormTesting(true); setFormTestResult(null)
    try {
      const res = await panelFetch('/api/panel/llm-providers', { method: 'POST', body: JSON.stringify({ action: 'test', baseUrl: formBaseUrl, apiKey: formApiKey, model: formModel, kind: formKind, timeoutMs: formTimeout }) })
      const data = await res.json()
      if (data.ok && data.result) setFormTestResult({ ok: data.result.ok, latencyMs: data.result.latencyMs, error: data.result.error })
      else setFormTestResult({ ok: false, error: data.error || 'تست ناموفق' })
    } catch { setFormTestResult({ ok: false, error: 'اتصال برقرار نشد' }) } finally { setFormTesting(false) }
  }

  const handleSave = async () => {
    if (!formName.trim()) { toast({ title: 'نام الزامی است', variant: 'destructive' }); return }
    setFormSaving(true)
    try {
      const res = await panelFetch('/api/panel/llm-providers', { method: 'POST', body: JSON.stringify({
        id: editingProvider?.id, name: formName, kind: formKind, baseUrl: formBaseUrl, apiKey: formApiKey || undefined,
        model: formModel, isDefault: formIsDefault, temperature: formTemp, maxTokens: formMaxTok, timeoutMs: formTimeout,
      }) })
      const data = await res.json()
      if (data.ok) { toast({ title: '✓ ذخیره شد' }); setShowAddForm(false); loadProviders(); loadProviderInfo() }
      else toast({ title: 'ذخیره ناموفق', description: data.error, variant: 'destructive' })
    } catch { toast({ title: 'ذخیره ناموفق', variant: 'destructive' }) } finally { setFormSaving(false) }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`حذف «${name}»؟`)) return
    try { const res = await panelFetch(`/api/panel/llm-providers?id=${id}`, { method: 'DELETE' }); const data = await res.json(); if (data.ok) { toast({ title: '✓ حذف شد' }); loadProviders() } } catch { toast({ title: 'حذف ناموفق', variant: 'destructive' }) }
  }

  const handleChat = async () => {
    if (!chatInput.trim() || chatBusy) return
    setChatBusy(true); setChatResult('')
    try {
      const res = await panelFetch('/api/panel/llm-chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: chatInput }], thinking: false }) })
      const data = await res.json()
      if (data.ok && data.content) setChatResult(data.content)
      else setChatResult('خطا: ' + (data.error || 'پاسخ دریافت نشد'))
    } catch { setChatResult('اتصال برقرار نشد') } finally { setChatBusy(false) }
  }

  if (loading) return <div className="space-y-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-32 w-full rounded-xl" />)}</div>

  return (
    <div className="space-y-5">
      {providerInfo && (
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-500/10"><Brain className="h-5 w-5 text-emerald-400" /></div>
              <div><p className="text-sm font-bold text-zinc-100">{providerInfo.label}</p><p className="text-xs text-zinc-500">مدل: <span className="text-emerald-400">{providerInfo.model || 'نامشخص'}</span></p></div>
            </div>
            <Badge className="ci-badge-ok">فعال</Badge>
          </CardContent>
        </Card>
      )}

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-200"><Cpu className="h-4 w-4 text-emerald-400" /> Providerهای هوش مصنوعی</h2>
          <Button size="sm" onClick={openAddForm} className="h-8 bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500"><Plus className="h-3.5 w-3.5" /> افزودن</Button>
        </div>
        {providers.length === 0 ? (
          <Card className="border-dashed border-zinc-800 bg-zinc-900/50">
            <CardContent className="flex flex-col items-center justify-center gap-2 p-8 text-center">
              <AlertCircle className="h-8 w-8 text-zinc-600" />
              <p className="text-sm text-zinc-500">هنوز Providerی اضافه نشده</p>
              <p className="text-xs text-zinc-600">سیستم فعلاً از مدل داخلی Z.ai استفاده می‌کنه. برای اتصال به OpenAI، Ollama یا سرویس‌های دیگر، «افزودن» رو بزن.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {providers.map((p) => (
              <Card key={p.id} className="border-zinc-800 bg-zinc-900/70">
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-800">
                        {p.kind === 'zai' ? <Sparkles className="h-4 w-4 text-violet-400" /> : p.kind === 'ollama' ? <Cpu className="h-4 w-4 text-blue-400" /> : <Brain className="h-4 w-4 text-emerald-400" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-zinc-100">{p.name}</p>
                          <Badge className={KIND_COLORS[p.kind] || 'ci-provider-custom'}>{PROVIDER_KINDS.find((k) => k.value === p.kind)?.label || p.kind}</Badge>
                          {p.isDefault && <Badge className="ci-badge-ok"><Star className="h-3 w-3" /> پیش‌فرض</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-zinc-500">{p.model || 'مدل تنظیم نشده'}{p.baseUrl && ` • ${p.baseUrl.slice(0, 40)}`}</p>
                        {p.lastTestAt && <p className={`mt-0.5 text-[10px] ${p.lastTestOk ? 'text-emerald-500' : 'text-red-400'}`}>{p.lastTestOk ? `✓ متصل (${p.lastTestMs}ms)` : `✗ ${p.lastTestErr.slice(0, 60) || 'ناموفق'}`}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="ghost" onClick={() => openEditForm(p)} className="h-8 px-2 text-zinc-400 hover:text-blue-400"><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDelete(p.id, p.name)} className="h-8 px-2 text-zinc-400 hover:text-red-400"><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      {showAddForm && (
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardHeader className="pb-3"><div className="flex items-center justify-between"><CardTitle className="flex items-center gap-2 text-sm font-bold"><Plus className="h-4 w-4 text-emerald-400" /> {editingProvider ? 'ویرایش Provider' : 'افزودن Provider جدید'}</CardTitle><Button size="sm" variant="ghost" onClick={() => setShowAddForm(false)} className="h-7 w-7 p-0 text-zinc-400"><X className="h-4 w-4" /></Button></div></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5"><Label className="text-xs text-zinc-400">نام نمایشی</Label><Input value={formName} onChange={(e) => setFormName(e.target.value)} placeholder="مثلاً: OpenAI اصلی" className="border-zinc-700 bg-zinc-950 text-sm text-zinc-100" /></div>
            <div className="space-y-1.5"><Label className="text-xs text-zinc-400">نوع Provider</Label><Select value={formKind} onValueChange={setFormKind}><SelectTrigger className="border-zinc-700 bg-zinc-950 text-sm"><SelectValue /></SelectTrigger><SelectContent>{PROVIDER_KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}</SelectContent></Select></div>
            {formKind !== 'zai' && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-zinc-400">Base URL</Label>
                  <Input value={formBaseUrl} onChange={(e) => setFormBaseUrl(e.target.value)} placeholder={formKind === 'ollama' ? 'http://localhost:11434' : 'https://api.openai.com/v1'} dir="ltr" className="border-zinc-700 bg-zinc-950 text-sm text-zinc-100" />
                  {(formKind === 'ollama' || formKind === 'lmstudio') && <p className="text-[10px] text-amber-500/80">⚠️ آدرس ۱۲۷.۰.۰.۱ از دید سرور پنل به همان سرور اشاره می‌کنه، نه رایانه شما.</p>}
                </div>
                {formKind !== 'ollama' && <div className="space-y-1.5"><Label className="text-xs text-zinc-400">API Key {editingProvider && !formApiKey && '(بدون تغییر)'}</Label><Input type="password" value={formApiKey} onChange={(e) => setFormApiKey(e.target.value)} placeholder={editingProvider ? '••••••••' : 'sk-...'} dir="ltr" className="border-zinc-700 bg-zinc-950 text-sm text-zinc-100" /></div>}
              </>
            )}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-zinc-400">مدل</Label>
                {formKind !== 'zai' && <Button size="sm" variant="ghost" onClick={handleDiscover} disabled={discovering || !formBaseUrl} className="h-6 px-2 text-[10px] text-emerald-400 hover:text-emerald-300">{discovering ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />} شناسایی مدل‌ها</Button>}
              </div>
              {discoveredModels.length > 0 ? (
                <Select value={formModel} onValueChange={setFormModel}><SelectTrigger className="border-zinc-700 bg-zinc-950 text-sm"><SelectValue placeholder="انتخاب مدل" /></SelectTrigger><SelectContent>{discoveredModels.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select>
              ) : (
                <Input value={formModel} onChange={(e) => setFormModel(e.target.value)} placeholder="مثلاً: gpt-4o یا llama3" dir="ltr" className="border-zinc-700 bg-zinc-950 text-sm text-zinc-100" />
              )}
            </div>
            {formTestResult && <div className={`rounded-lg border p-3 text-xs ${formTestResult.ok ? 'border-emerald-700/50 bg-emerald-500/10 text-emerald-300' : 'border-red-700/50 bg-red-500/10 text-red-300'}`}>{formTestResult.ok ? `✓ اتصال موفق — ${formTestResult.latencyMs}ms` : `✗ ${formTestResult.error}`}</div>}
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1"><Label className="text-[10px] text-zinc-500">Temperature</Label><Input type="number" step="0.1" min="0" max="2" value={formTemp} onChange={(e) => setFormTemp(parseFloat(e.target.value) || 0.7)} className="border-zinc-700 bg-zinc-950 text-sm" dir="ltr" /></div>
              <div className="space-y-1"><Label className="text-[10px] text-zinc-500">Max Tokens</Label><Input type="number" value={formMaxTok} onChange={(e) => setFormMaxTok(parseInt(e.target.value) || 4096)} className="border-zinc-700 bg-zinc-950 text-sm" dir="ltr" /></div>
              <div className="space-y-1"><Label className="text-[10px] text-zinc-500">Timeout (ms)</Label><Input type="number" value={formTimeout} onChange={(e) => setFormTimeout(parseInt(e.target.value) || 90000)} className="border-zinc-700 bg-zinc-950 text-sm" dir="ltr" /></div>
            </div>
            <div className="flex items-center gap-2"><Switch checked={formIsDefault} onCheckedChange={setFormIsDefault} /><Label className="text-xs text-zinc-400">استفاده به‌عنوان مدل پیش‌فرض</Label></div>
            <div className="flex items-center gap-2 pt-2">
              {formKind !== 'zai' && <Button variant="outline" size="sm" onClick={handleTest} disabled={formTesting || !formBaseUrl} className="border-zinc-700 text-xs text-zinc-300 hover:text-emerald-400">{formTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5" />} تست اتصال</Button>}
              <Button size="sm" onClick={handleSave} disabled={formSaving || !formName.trim()} className="ml-auto bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500">{formSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} ذخیره</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm font-bold"><SendHorizontal className="h-4 w-4 text-emerald-400" /> تست زنده مدل</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleChat()} placeholder="پیام آزمایشی بنویس..." className="border-zinc-700 bg-zinc-950 text-sm text-zinc-100" dir="rtl" />
            <Button size="sm" onClick={handleChat} disabled={chatBusy || !chatInput.trim()} className="bg-emerald-600 text-white hover:bg-emerald-500">{chatBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}</Button>
          </div>
          {chatResult && <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-sm text-zinc-200">{chatResult}</div>}
        </CardContent>
      </Card>

      {settings && <WatcherSettings settings={settings} onReload={loadSettings} />}
    </div>
  )
}

function WatcherSettings({ settings, onReload }: { settings: Settings; onReload: () => void }) {
  const { toast } = useToast()
  const [persona, setPersona] = useState(settings.persona || '')
  const [footer, setFooter] = useState(settings.footer || '')
  const [thinking, setThinking] = useState(settings.thinking ?? true)
  const [retries, setRetries] = useState(settings.retries ?? 3)
  const [saving, setSaving] = useState(false); const [dirty, setDirty] = useState(false)

  useEffect(() => { setPersona(settings.persona || ''); setFooter(settings.footer || ''); setThinking(settings.thinking ?? true); setRetries(settings.retries ?? 3); setDirty(false) }, [settings])

  const save = async () => {
    setSaving(true)
    try {
      const res = await panelFetch('/api/panel/llm-settings', { method: 'POST', body: JSON.stringify({ persona, footer, thinking, retries, restart: true }) })
      const data = await res.json()
      if (data.ok) { toast({ title: '✓ ذخیره شد', description: data.restarted ? 'واتچر ری‌استارت شد' : undefined }); setDirty(false); onReload() }
      else toast({ title: 'ذخیره ناموفق', description: data.error, variant: 'destructive' })
    } catch { toast({ title: 'ذخیره ناموفق', variant: 'destructive' }) } finally { setSaving(false) }
  }

  return (
    <Card className="border-zinc-800 bg-zinc-900/70">
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-sm font-bold"><Brain className="h-4 w-4 text-emerald-400" /> تنظیمات واتچر تلگرام</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5"><Label className="text-xs text-zinc-400">Persona (شخصیت دستیار)</Label><Textarea value={persona} onChange={(e) => { setPersona(e.target.value); setDirty(true) }} rows={4} className="border-zinc-700 bg-zinc-950 text-sm text-zinc-100" placeholder="شخصیت و دستورالعمل‌های دستیار..." /></div>
        <div className="space-y-1.5"><Label className="text-xs text-zinc-400">Footer (امضای پایین پیام)</Label><Input value={footer} onChange={(e) => { setFooter(e.target.value); setDirty(true) }} className="border-zinc-700 bg-zinc-950 text-sm text-zinc-100" /></div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2"><Switch checked={thinking} onCheckedChange={(v) => { setThinking(v); setDirty(true) }} /><Label className="text-xs text-zinc-400">حالت تفکر</Label></div>
          <div className="flex items-center gap-2"><Label className="text-xs text-zinc-400">تلاش مجدد:</Label><Select value={String(retries)} onValueChange={(v) => { setRetries(parseInt(v)); setDirty(true) }}><SelectTrigger className="h-8 w-20 border-zinc-700 bg-zinc-950 text-xs"><SelectValue /></SelectTrigger><SelectContent>{[1, 2, 3, 4, 5].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent></Select></div>
        </div>
        <Button size="sm" onClick={save} disabled={saving || !dirty} className="bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} ذخیره و ری‌استارت واتچر</Button>
      </CardContent>
    </Card>
  )
}
