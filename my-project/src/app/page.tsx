'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
  Activity,
  BookOpen,
  Bot,
  Brain,
  Cable,
  FolderOpen,
  LogOut,
  MessageCircle,
  Monitor,
  Palette,
  Server,
  ShieldAlert,
  Star,
  Terminal,
  Users,
} from 'lucide-react'
import {
  clearStoredKey,
  getStoredKey,
  setStoredKey,
  loadTheme,
  saveTheme,
  type PanelTheme,
} from '@/lib/panel'

export default function Home() {
  const [key, setKey] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [theme, setTheme] = useState<PanelTheme | null>(null)
  const [watcherLive, setWatcherLive] = useState<boolean | null>(null)
  // controlled tabs: keeps the mobile tab-bar's active pill centered
  const [activeTab, setActiveTab] = useState('status')
  const tabsListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // client-only persisted theme (session/localStorage) — must land after
    // hydration to avoid SSR mismatch; hence setState in effect here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(loadTheme())
    const stored = getStoredKey()
    const verify: Promise<string | null> = stored
      ? fetch('/api/panel/auth', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ key: stored }),
        })
          .then((r) => {
            if (!r.ok) {
              clearStoredKey()
              return null
            }
            return stored
          })
          .catch(() => stored)
      : Promise.resolve(null)
    let cancelled = false
    verify
      .then((k) => {
        if (!cancelled) {
          setKey(k)
          setReady(true)
        }
      })
      .catch(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  /* light live chip for the main watcher (independent of the status tab) */
  useEffect(() => {
    if (!key) return
    let stop = false
    const tick = async () => {
      // read the CURRENT stored key on every tick — the owner can change the
      // panel password in Settings, and the live chip must not keep sending
      // the stale hash (would 401 forever until reload)
      const k = getStoredKey()
      if (!k) return
      try {
        const r = await fetch('/api/panel/status', {
          headers: { 'x-panel-key': k },
        })
        if (r.ok) {
          const j = (await r.json()) as { watcher?: { running?: boolean } }
          if (!stop) setWatcherLive(!!j.watcher?.running)
        }
      } catch {
        /* offline blip */
      }
    }
    tick()
    const iv = setInterval(tick, 30_000)
    return () => {
      stop = true
      clearInterval(iv)
    }
  }, [key])

  const onUnlock = useCallback((k: string) => {
    setStoredKey(k)
    setKey(k)
  }, [])

  const logout = useCallback(() => {
    clearStoredKey()
    setKey(null)
  }, [])

  const onThemeChange = useCallback((t: PanelTheme) => {
    setTheme(t)
    saveTheme(t)
  }, [])

  const onTabChange = useCallback((v: string) => {
    setActiveTab(v)
    // mobile tab-bar: bring the newly-active pill into view (RTL-aware).
    // setTimeout (not rAF): Radix must first flip data-state in the DOM.
    setTimeout(() => {
      tabsListRef.current
        ?.querySelector('[data-state="active"]')
        ?.scrollIntoView({ inline: 'center', behavior: 'smooth', block: 'nearest' })
    }, 120)
  }, [])

  const t = theme
  const cssVars = t
    ? ({
        '--tp-main': t.main,
        '--tp-2': t.second,
        '--tp-dim': t.dim,
      } as React.CSSProperties)
    : undefined

  return (
    <div
      dir="rtl"
      className="theme-scope flex min-h-screen flex-col bg-zinc-950 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.06),transparent_55%)] text-zinc-100"
      style={cssVars}
    >
      {/* header */}
      <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400/20 to-emerald-500/20 ring-1 ring-amber-400/40">
              <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
            </div>
            <div>
              <h1 className="text-base font-extrabold leading-tight text-zinc-100">
                پنل مدیریت <span className="text-amber-400">Z</span>
              </h1>
              <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    watcherLive == null
                      ? 'bg-zinc-600'
                      : watcherLive
                        ? 'animate-pulse bg-emerald-400'
                        : 'bg-red-400'
                  }`}
                  aria-hidden
                />
                {watcherLive == null
                  ? 'VPN | STAR — مرکز فرمان مالک'
                  : watcherLive
                    ? 'دستیار اصلی فعال'
                    : 'دستیار اصلی خاموش'}
              </p>
            </div>
          </div>
          {key ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              className="h-8 text-zinc-400 hover:bg-zinc-900 hover:text-red-300"
            >
              <LogOut className="h-3.5 w-3.5" /> خروج
            </Button>
          ) : null}
        </div>
      </header>

      {/* main */}
      <main
        className="mx-auto w-full max-w-5xl flex-1 px-4 py-5"
        style={t && t.zoom !== 1 ? { zoom: t.zoom } : undefined}
      >
        {!ready ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <Star className="h-10 w-10 animate-pulse fill-amber-400/60 text-amber-400/60" />
          </div>
        ) : !key ? (
          <LockScreen onUnlock={onUnlock} />
        ) : (
          <Tabs value={activeTab} onValueChange={onTabChange} dir="rtl" className="w-full">
            {/* mobile: single-row swipeable pill bar (was a 6-row 237px grid);
                lg+: the full 13-column grid as before */}
            <TabsList
              ref={tabsListRef}
              className="tabs-bar mb-4 flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-900/70 p-1 lg:grid lg:grid-cols-13"
            >
              <TabsTrigger
                value="status"
                className="flex-none gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white lg:px-1 lg:text-[11px]"
              >
                <Activity className="h-4 w-4 shrink-0" /> وضعیت
              </TabsTrigger>
              <TabsTrigger
                value="accounts"
                className="flex-none gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white lg:px-1 lg:text-[11px]"
              >
                <Users className="h-4 w-4 shrink-0" /> اکانت‌ها
              </TabsTrigger>
              <TabsTrigger
                value="agent"
                className="flex-none gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white lg:px-1 lg:text-[11px]"
              >
                <Bot className="h-4 w-4 shrink-0" /> ایجنت
              </TabsTrigger>
              <TabsTrigger
                value="chat"
                className="flex-none gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white lg:px-1 lg:text-[11px]"
              >
                <MessageCircle className="h-4 w-4 shrink-0" /> چت
              </TabsTrigger>
              <TabsTrigger
                value="llm"
                className="flex-none gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white lg:px-1 lg:text-[11px]"
              >
                <Brain className="h-4 w-4 shrink-0" /> هوش مصنوعی
              </TabsTrigger>
              <TabsTrigger
                value="api"
                className="flex-none gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white lg:px-1 lg:text-[11px]"
              >
                <Cable className="h-4 w-4 shrink-0" /> API و اتصال
              </TabsTrigger>
              <TabsTrigger
                value="files"
                className="flex-none gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white lg:px-1 lg:text-[11px]"
              >
                <FolderOpen className="h-4 w-4 shrink-0" /> فایل‌ها
              </TabsTrigger>
              <TabsTrigger
                value="services"
                className="flex-none gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white lg:px-1 lg:text-[11px]"
              >
                <Server className="h-4 w-4 shrink-0" /> سرویس‌ها
              </TabsTrigger>
              <TabsTrigger
                value="settings"
                className="flex-none gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white lg:px-1 lg:text-[11px]"
              >
                <Palette className="h-4 w-4 shrink-0" /> تنظیمات
              </TabsTrigger>
              <TabsTrigger
                value="system"
                className="flex-none gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white lg:px-1 lg:text-[11px]"
              >
                <ShieldAlert className="h-4 w-4 shrink-0" /> سیستم
              </TabsTrigger>
              <TabsTrigger
                value="manual"
                className="flex-none gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white lg:px-1 lg:text-[11px]"
              >
                <BookOpen className="h-4 w-4 shrink-0" /> راهنما
              </TabsTrigger>
              <TabsTrigger
                value="terminal"
                className="flex-none gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white lg:px-1 lg:text-[11px]"
              >
                <Terminal className="h-4 w-4 shrink-0" /> ترمینال
              </TabsTrigger>
              <TabsTrigger
                value="desktop"
                className="flex-none gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold data-[state=active]:bg-emerald-600 data-[state=active]:text-white lg:px-1 lg:text-[11px]"
              >
                <Monitor className="h-4 w-4 shrink-0" /> دسکتاپ
              </TabsTrigger>
            </TabsList>
            <TabsContent value="status">
              <StatusTab />
            </TabsContent>
            <TabsContent value="accounts">
              <AccountsTab />
            </TabsContent>
            {/* forceMount: switching tabs must NOT unmount these — it killed
                all live PTY sessions (terminal), lost unsaved form edits (agent)
                and dropped loaded chat history (chat). Hidden instead. */}
            <TabsContent value="agent" forceMount className="data-[state=inactive]:hidden">
              <AgentTab />
            </TabsContent>
            <TabsContent value="chat" forceMount className="data-[state=inactive]:hidden">
              <ChatTab />
            </TabsContent>
            <TabsContent value="llm">
              <LlmTab />
            </TabsContent>
            <TabsContent value="api">
              <ApiTab />
            </TabsContent>
            <TabsContent value="files">
              <FilesTab />
            </TabsContent>
            <TabsContent value="services">
              <ServicesTab />
            </TabsContent>
            <TabsContent value="settings">
              <SettingsTab theme={theme ?? undefined} onThemeChange={onThemeChange} />
            </TabsContent>
            <TabsContent value="system">
              <SystemTab />
            </TabsContent>
            <TabsContent value="manual">
              <ManualTab />
            </TabsContent>
            <TabsContent value="terminal" forceMount className="data-[state=inactive]:hidden">
              <TerminalTab />
            </TabsContent>
            {/* forceMount: keeps the live VNC session (iframe websocket) alive
                while the owner browses other tabs — hidden instead of unmounted */}
            <TabsContent value="desktop" forceMount className="data-[state=inactive]:hidden">
              <DesktopTab />
            </TabsContent>
          </Tabs>
        )}
      </main>

      {/* sticky footer */}
      <footer className="mt-auto border-t border-zinc-800/80 bg-zinc-950/90 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-1.5 px-4 py-3 text-center sm:flex-row sm:text-right">
          <p className="text-[11px] text-zinc-500">
            <span className="text-amber-500/80">★</span> VPN | STAR — ساخته‌شده برای مالک؛
            دستیار هیچ‌وقت با هیچ دستوری خاموش نمیشه.
          </p>
          <p className="text-[11px] text-zinc-600">Z Panel v2 — تهران</p>
        </div>
      </footer>
    </div>
  )
}
