'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import LockScreen from '@/components/panel/LockScreen'
import StatusTab from '@/components/panel/StatusTab'
import AccountsTab from '@/components/panel/AccountsTab'
import AgentTab from '@/components/panel/AgentTab'
import ChatTab from '@/components/panel/ChatTab'
import LlmTab from '@/components/panel/LlmTab'
import ApiTab from '@/components/panel/ApiTab'
import FilesTab from '@/components/panel/FilesTab'
import ServicesTab from '@/components/panel/ServicesTab'
import SettingsTab from '@/components/panel/SettingsTab'
import SystemTab from '@/components/panel/SystemTab'
import ManualTab from '@/components/panel/ManualTab'
import TerminalTab from '@/components/panel/TerminalTab'
import DesktopTab from '@/components/panel/DesktopTab'
import {
  Activity, BookOpen, Bot, Brain, Cable, ChevronLeft, FolderOpen, LogOut,
  Menu, MessageCircle, Monitor, Palette, Server, ShieldAlert, Star, Terminal, Users, X,
} from 'lucide-react'
import {
  clearStoredKey, getStoredKey, setStoredKey, loadTheme, saveTheme, type PanelTheme,
} from '@/lib/panel'

interface NavItem { value: string; label: string; icon: typeof Activity; group: string; forceMount?: boolean }

const NAV: NavItem[] = [
  { value: 'status', label: 'وضعیت', icon: Activity, group: 'داشبورد' },
  { value: 'chat', label: 'چت', icon: MessageCircle, group: 'داشبورد', forceMount: true },
  { value: 'llm', label: 'هوش مصنوعی', icon: Brain, group: 'داشبورد' },
  { value: 'agent', label: 'ایجنت', icon: Bot, group: 'سیستم', forceMount: true },
  { value: 'accounts', label: 'اکانت‌ها', icon: Users, group: 'سیستم' },
  { value: 'services', label: 'سرویس‌ها', icon: Server, group: 'سیستم' },
  { value: 'files', label: 'فایل‌ها', icon: FolderOpen, group: 'سیستم' },
  { value: 'api', label: 'API و اتصال', icon: Cable, group: 'سیستم' },
  { value: 'terminal', label: 'ترمینال', icon: Terminal, group: 'ابزارها', forceMount: true },
  { value: 'desktop', label: 'دسکتاپ', icon: Monitor, group: 'ابزارها', forceMount: true },
  { value: 'settings', label: 'تنظیمات', icon: Palette, group: 'ابزارها' },
  { value: 'system', label: 'سیستم', icon: ShieldAlert, group: 'ابزارها' },
  { value: 'manual', label: 'راهنما', icon: BookOpen, group: 'ابزارها' },
]

export default function Home() {
  const [key, setKey] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [theme, setTheme] = useState<PanelTheme | null>(null)
  const [watcherLive, setWatcherLive] = useState<boolean | null>(null)
  const [activeTab, setActiveTab] = useState('status')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(loadTheme())
    const stored = getStoredKey()
    const verify: Promise<string | null> = stored
      ? fetch('/api/panel/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: stored }) })
          .then((r) => { if (!r.ok) { clearStoredKey(); return null } return stored }).catch(() => stored)
      : Promise.resolve(null)
    let cancelled = false
    verify.then((k) => { if (!cancelled) { setKey(k); setReady(true) } }).catch(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!key) return
    let stop = false
    const tick = async () => {
      const k = getStoredKey(); if (!k) return
      try { const r = await fetch('/api/panel/status', { headers: { 'x-panel-key': k } }); if (r.ok) { const j = (await r.json()) as { watcher?: { running?: boolean } }; if (!stop) setWatcherLive(!!j.watcher?.running) } } catch { }
    }
    tick(); const iv = setInterval(tick, 30_000)
    return () => { stop = true; clearInterval(iv) }
  }, [key])

  const onUnlock = useCallback((k: string) => { setStoredKey(k); setKey(k) }, [])
  const logout = useCallback(() => { clearStoredKey(); setKey(null) }, [])
  const onThemeChange = useCallback((t: PanelTheme) => { setTheme(t); saveTheme(t) }, [])
  const onTabChange = useCallback((v: string) => { setActiveTab(v); setSidebarOpen(false) }, [])

  const t = theme
  const cssVars = t ? ({ '--tp-main': t.main, '--tp-2': t.second, '--tp-dim': t.dim } as React.CSSProperties) : undefined
  const groups = NAV.reduce<Record<string, NavItem[]>>((acc, item) => { if (!acc[item.group]) acc[item.group] = []; acc[item.group].push(item); return acc }, {})

  return (
    <div dir="rtl" className="theme-scope flex min-h-screen bg-[#0a0a0b] text-zinc-100" style={cssVars}>
      {sidebarOpen && <div className="ci-sidebar-overlay open fixed inset-0 z-49 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />}
      <aside className={`ci-sidebar ${sidebarOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''} flex flex-col border-l border-[rgba(255,255,255,0.06)] bg-[#0d0d0f]`}>
        <div className="flex items-center justify-between gap-2 border-b border-[rgba(255,255,255,0.06)] px-4 py-3.5">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400/20 to-emerald-500/20 ring-1 ring-amber-400/40">
              <Star className="h-4.5 w-4.5 fill-amber-400 text-amber-400" />
            </div>
            {!sidebarCollapsed && (
              <div className="min-w-0">
                <h1 className="truncate text-sm font-extrabold text-zinc-100">پنل مدیریت <span className="text-amber-400">Z</span></h1>
                <p className="flex items-center gap-1 text-[10px] text-zinc-500">
                  <span className={`inline-block h-1.5 w-1.5 rounded-full ${watcherLive == null ? 'bg-zinc-600' : watcherLive ? 'animate-pulse bg-emerald-400' : 'bg-red-400'}`} aria-hidden />
                  {watcherLive == null ? '...' : watcherLive ? 'فعال' : 'خاموش'}
                </p>
              </div>
            )}
          </div>
          <button className="rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 lg:hidden" onClick={() => setSidebarOpen(false)}><X className="h-4 w-4" /></button>
          <button className="hidden rounded-lg p-1.5 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 lg:block" onClick={() => setSidebarCollapsed(!sidebarCollapsed)}><ChevronLeft className={`h-4 w-4 transition-transform ${sidebarCollapsed ? 'rotate-180' : ''}`} /></button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 py-3">
          {Object.entries(groups).map(([groupName, items]) => (
            <div key={groupName} className="mb-4">
              {!sidebarCollapsed && <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-wider text-zinc-600">{groupName}</p>}
              {items.map((item) => {
                const Icon = item.icon; const isActive = activeTab === item.value
                return (
                  <button key={item.value} onClick={() => onTabChange(item.value)}
                    className={`ci-sidebar-item ${isActive ? 'active' : ''} flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${isActive ? 'text-emerald-400' : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'}`}
                    title={sidebarCollapsed ? item.label : undefined}>
                    <Icon className="h-4 w-4 shrink-0" />
                    {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-[rgba(255,255,255,0.06)] px-2 py-3">
          {!sidebarCollapsed && <p className="px-3 pb-2 text-[10px] text-zinc-600">Z Panel v2 — تهران</p>}
          <button onClick={logout} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 transition-colors hover:bg-red-500/10 hover:text-red-300" title={sidebarCollapsed ? 'خروج' : undefined}>
            <LogOut className="h-4 w-4 shrink-0" />
            {!sidebarCollapsed && <span>خروج</span>}
          </button>
        </div>
      </aside>
      <div className="ci-main flex flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-[rgba(255,255,255,0.06)] bg-[#0a0a0b]/90 px-4 py-3 backdrop-blur lg:hidden">
          <button onClick={() => setSidebarOpen(true)} className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800"><Menu className="h-5 w-5" /></button>
          <div className="flex items-center gap-2"><Star className="h-4 w-4 fill-amber-400 text-amber-400" /><span className="text-sm font-bold text-zinc-100">پنل <span className="text-amber-400">Z</span></span></div>
          <div className="w-9" />
        </header>
        <main className="flex-1 overflow-y-auto px-4 py-5 lg:px-6" style={t && t.zoom !== 1 ? { zoom: t.zoom } : undefined}>
          {!ready ? (
            <div className="flex min-h-[60vh] items-center justify-center"><Star className="h-10 w-10 animate-pulse fill-amber-400/60 text-amber-400/60" /></div>
          ) : !key ? (
            <LockScreen onUnlock={onUnlock} />
          ) : (
            <div dir="rtl" className="mx-auto w-full max-w-5xl">
              {NAV.map((item) => {
                if (activeTab !== item.value && !item.forceMount) return null
                return (
                  <div key={item.value} className={activeTab === item.value ? '' : 'hidden'}>
                    {item.value === 'status' && <StatusTab />}
                    {item.value === 'accounts' && <AccountsTab />}
                    {item.value === 'agent' && <AgentTab />}
                    {item.value === 'chat' && <ChatTab />}
                    {item.value === 'llm' && <LlmTab />}
                    {item.value === 'api' && <ApiTab />}
                    {item.value === 'files' && <FilesTab />}
                    {item.value === 'services' && <ServicesTab />}
                    {item.value === 'settings' && <SettingsTab theme={theme ?? undefined} onThemeChange={onThemeChange} />}
                    {item.value === 'system' && <SystemTab />}
                    {item.value === 'manual' && <ManualTab />}
                    {item.value === 'terminal' && <TerminalTab />}
                    {item.value === 'desktop' && <DesktopTab />}
                  </div>
                )
              })}
            </div>
          )}
        </main>
        <footer className="mt-auto border-t border-[rgba(255,255,255,0.06)] bg-[#0a0a0b]/90 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex max-w-5xl items-center justify-between gap-2">
            <p className="text-[10px] text-zinc-600"><span className="text-amber-500/80">★</span> VPN | STAR</p>
            <p className="text-[10px] text-zinc-700">Z Panel v2 — تهران</p>
          </div>
        </footer>
      </div>
    </div>
  )
}
