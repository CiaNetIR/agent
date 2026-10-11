"use client"

import { useCallback, useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Menu, Star } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Sidebar, SidebarContent } from "@/components/panel/shell/Sidebar"
import { viewTitle, type ViewId } from "@/components/panel/shell/nav"
import LockScreen from "@/components/panel/LockScreen"
import StatusTab from "@/components/panel/StatusTab"
import AccountsTab from "@/components/panel/AccountsTab"
import AgentTab from "@/components/panel/AgentTab"
import ChatTab from "@/components/panel/ChatTab"
import LlmTab from "@/components/panel/LlmTab"
import LlmManager from "@/components/panel/LlmManager"
import ApiTab from "@/components/panel/ApiTab"
import FilesTab from "@/components/panel/FilesTab"
import ServicesTab from "@/components/panel/ServicesTab"
import SettingsTab from "@/components/panel/SettingsTab"
import SystemTab from "@/components/panel/SystemTab"
import ManualTab from "@/components/panel/ManualTab"
import TerminalTab from "@/components/panel/TerminalTab"
import DesktopTab from "@/components/panel/DesktopTab"
import { OverviewSection } from "@/components/dashboard/overview"
import { LiveChartsSection } from "@/components/dashboard/live-charts"
import { SystemInfoSection, NetworkSection } from "@/components/dashboard/system-info"
import { ServicesSection } from "@/components/dashboard/services"
import { PortsSection } from "@/components/dashboard/ports"
import { ProcessesSection } from "@/components/dashboard/processes"
import { LogsSection } from "@/components/dashboard/logs"
import {
  clearStoredKey,
  getStoredKey,
  setStoredKey,
  loadTheme,
  saveTheme,
  type PanelTheme,
} from "@/lib/panel"

const COLLAPSE_KEY = "vpnstar-sidebar-collapsed"

const fadeUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.28 },
}

export default function Home() {
  const [key, setKey] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [theme, setTheme] = useState<PanelTheme | null>(null)
  const [watcherLive, setWatcherLive] = useState<boolean | null>(null)
  const [view, setView] = useState<ViewId>("dashboard")
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)

  /* ---------- boot: theme + stored panel key ---------- */
  useEffect(() => {
    // client-only persisted state — must land after hydration
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(loadTheme())
    setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1")
    const stored = getStoredKey()
    const verify: Promise<string | null> = stored
      ? fetch("/api/panel/auth", {
          method: "POST",
          headers: { "content-type": "application/json" },
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

  /* ---------- live watcher chip (independent of the status view) ---------- */
  useEffect(() => {
    if (!key) return
    let stop = false
    const tick = async () => {
      // read the CURRENT stored key on every tick — the owner can change the
      // panel password in Settings, and the chip must not keep sending the
      // stale hash (would 401 forever until reload)
      const k = getStoredKey()
      if (!k) return
      try {
        const r = await fetch("/api/panel/status", { headers: { "x-panel-key": k } })
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

  const onNavigate = useCallback((id: ViewId) => {
    setView(id)
    setDrawerOpen(false)
  }, [])

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1")
      return !c
    })
  }, [])

  const t = theme
  const cssVars = t
    ? ({
        "--tp-main": t.main,
        "--tp-2": t.second,
        "--tp-dim": t.dim,
      } as React.CSSProperties)
    : undefined

  /* ---------- gate: splash → lock → shell ---------- */
  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <Star className="h-10 w-10 animate-pulse fill-amber-400/60 text-amber-400/60" />
      </div>
    )
  }

  if (!key) {
    return (
      <div className="theme-scope min-h-screen bg-zinc-950 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.06),transparent_55%)] text-zinc-100">
        <LockScreen onUnlock={onUnlock} />
      </div>
    )
  }

  return (
    <div
      dir="rtl"
      className="theme-scope flex min-h-screen bg-zinc-950 bg-[radial-gradient(ellipse_at_top,rgba(16,185,129,0.06),transparent_55%)] text-zinc-100"
      style={cssVars}
    >
      {/* desktop sidebar */}
      <Sidebar
        active={view}
        onNavigate={onNavigate}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        watcherLive={watcherLive}
        onLogout={logout}
      />

      {/* main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile topbar */}
        <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDrawerOpen(true)}
                className="h-9 w-9 p-0 text-zinc-300"
                aria-label="باز کردن منو"
              >
                <Menu className="h-5 w-5" />
              </Button>
              <div className="flex items-center gap-1.5">
                <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                <span className="text-sm font-extrabold">پنل CiaNet</span>
              </div>
            </div>
            <span className="truncate text-xs font-bold text-emerald-300">
              {viewTitle(view)}
            </span>
          </div>
        </header>

        {/* desktop view title bar */}
        <header className="sticky top-0 z-30 hidden border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur lg:block">
          <div className="flex items-center justify-between gap-3 px-6 py-3">
            <h2 className="text-sm font-extrabold text-zinc-200">{viewTitle(view)}</h2>
            <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
              <span
                aria-hidden
                className={
                  watcherLive == null
                    ? "inline-block h-1.5 w-1.5 rounded-full bg-zinc-600"
                    : watcherLive
                      ? "inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400"
                      : "inline-block h-1.5 w-1.5 rounded-full bg-red-400"
                }
              />
              VPN | STAR — مرکز فرمان مالک
            </p>
          </div>
        </header>

        {/* content */}
        <main
          className="mx-auto w-full max-w-6xl flex-1 px-3 py-5 sm:px-5"
          style={t && t.zoom !== 1 ? { zoom: t.zoom } : undefined}
        >
          {/* dashboard (real system data via dashboard sections) */}
          <div hidden={view !== "dashboard"} className={view !== "dashboard" ? "hidden" : undefined}>
            <div className="space-y-6">
              <motion.div {...fadeUp}>
                <OverviewSection />
              </motion.div>
              <motion.div {...fadeUp}>
                <LiveChartsSection />
              </motion.div>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <motion.div {...fadeUp}>
                  <SystemInfoSection />
                </motion.div>
                <motion.div {...fadeUp}>
                  <ServicesSection />
                </motion.div>
              </div>
              <motion.div {...fadeUp}>
                <NetworkSection />
              </motion.div>
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <motion.div {...fadeUp}>
                  <PortsSection />
                </motion.div>
                <motion.div {...fadeUp}>
                  <ProcessesSection />
                </motion.div>
              </div>
              <motion.div {...fadeUp}>
                <LogsSection />
              </motion.div>
            </div>
          </div>

          {/* keep-alive views: agent / chat / terminal — mounted once, hidden when inactive
              (unmounting killed live PTY sessions, lost unsaved agent forms and chat history) */}
          <div hidden={view !== "agent"} className={view !== "agent" ? "hidden" : undefined}>
            <AgentTab />
          </div>
          <div hidden={view !== "chat"} className={view !== "chat" ? "hidden" : undefined}>
            <ChatTab />
          </div>
          <div hidden={view !== "terminal"} className={view !== "terminal" ? "hidden" : undefined}>
            <TerminalTab />
          </div>

          {/* on-demand views */}
          {view === "llm" && (
            <div className="space-y-4">
              <LlmManager />
              <LlmTab />
            </div>
          )}
          {view === "status" && <StatusTab />}
          {view === "accounts" && <AccountsTab />}
          {view === "services" && <ServicesTab />}
          {view === "files" && <FilesTab />}
          {view === "api" && <ApiTab />}
          {view === "desktop" && <DesktopTab />}
          {view === "settings" && <SettingsTab theme={theme ?? undefined} onThemeChange={onThemeChange} />}
          {view === "system" && <SystemTab />}
          {view === "manual" && <ManualTab />}
        </main>

        {/* sticky footer */}
        <footer className="mt-auto border-t border-zinc-800/80 bg-zinc-950/90 pb-[max(0.9rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-1.5 px-4 py-3 text-center sm:flex-row sm:text-right">
            <p className="text-[11px] text-zinc-500">
              <span className="text-amber-500/80">★</span> VPN | STAR — ساخته‌شده برای مالک؛
              دستیار هیچ‌وقت با هیچ دستوری خاموش نمیشه.
            </p>
            <p className="text-[11px] text-zinc-600">CiaNet Panel v3 — تهران</p>
          </div>
        </footer>
      </div>

      {/* mobile drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent side="right" className="w-64 border-s border-zinc-800/80 bg-zinc-950 p-0 text-zinc-100">
          <SheetTitle className="sr-only">منوی اصلی</SheetTitle>
          <SidebarContent
            active={view}
            onNavigate={onNavigate}
            watcherLive={watcherLive}
            onLogout={logout}
          />
        </SheetContent>
      </Sheet>
    </div>
  )
}
