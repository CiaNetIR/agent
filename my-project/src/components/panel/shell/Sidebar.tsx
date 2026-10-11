"use client"

import { Star } from "lucide-react"
import { cn } from "@/lib/utils"
import { NAV_GROUPS, type ViewId } from "./nav"

export interface SidebarProps {
  active: ViewId
  onNavigate: (id: ViewId) => void
  /** icon-only mode (desktop) */
  collapsed?: boolean
  onToggleCollapsed?: () => void
  watcherLive: boolean | null
  onLogout?: () => void
}

function LiveDot({ live }: { live: boolean | null }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        live == null ? "bg-zinc-600" : live ? "animate-pulse bg-emerald-400" : "bg-red-400"
      )}
    />
  )
}

/**
 * Shared sidebar content — rendered inside the desktop <aside> and the
 * mobile drawer (Sheet) alike.
 */
export function SidebarContent({
  active,
  onNavigate,
  collapsed = false,
  onToggleCollapsed,
  watcherLive,
  onLogout,
}: SidebarProps) {
  return (
    <div className="flex h-full flex-col">
      {/* brand */}
      <div className="flex items-center gap-2.5 border-b border-zinc-800/80 px-3 py-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400/20 to-emerald-500/20 ring-1 ring-amber-400/40">
          <Star className="h-5 w-5 fill-amber-400 text-amber-400" />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <h1 className="truncate text-sm font-extrabold leading-tight text-zinc-100">
              پنل مدیریت <span className="text-amber-400">CiaNet</span>
            </h1>
            <p className="flex items-center gap-1.5 text-[10.5px] leading-tight text-zinc-500">
              <LiveDot live={watcherLive} />
              {watcherLive == null
                ? "VPN | STAR — مرکز فرمان"
                : watcherLive
                  ? "دستیار اصلی فعال"
                  : "دستیار اصلی خاموش"}
            </p>
          </div>
        )}
      </div>

      {/* nav */}
      <nav
        className="flex-1 space-y-4 overflow-y-auto px-2 py-3"
        aria-label="ناوبری اصلی پنل"
      >
        {NAV_GROUPS.map((group) => (
          <div key={group.title}>
            {!collapsed && (
              <p className="px-2 pb-1.5 text-[10px] font-bold tracking-wide text-zinc-600">
                {group.title}
              </p>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const Icon = item.icon
                const isActive = active === item.id
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onNavigate(item.id)}
                      aria-current={isActive ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold outline-none transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-emerald-500/60",
                        isActive
                          ? "bg-emerald-600/15 text-emerald-300 ring-1 ring-emerald-500/30"
                          : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-[18px] w-[18px] shrink-0",
                          isActive ? "text-emerald-400" : "text-zinc-500 group-hover:text-zinc-300"
                        )}
                      />
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {!collapsed && item.watcherRelevant && watcherLive === false && (
                        <span className="ms-auto h-1.5 w-1.5 rounded-full bg-red-400" aria-label="واتچر خاموش است" />
                      )}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* footer actions */}
      <div className="border-t border-zinc-800/80 p-2">
        {onToggleCollapsed && (
          <button
            type="button"
            onClick={onToggleCollapsed}
            className={cn(
              "mb-0.5 hidden w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold text-zinc-500 transition-colors hover:bg-zinc-900 hover:text-zinc-300 lg:flex",
              "focus-visible:ring-2 focus-visible:ring-emerald-500/60 focus-visible:outline-none"
            )}
            aria-label={collapsed ? "باز کردن منو" : "جمع کردن منو"}
          >
            <span
              aria-hidden
              className={cn(
                "flex h-[18px] w-[18px] items-center justify-center text-base leading-none",
                collapsed && "mx-auto"
              )}
            >
              {collapsed ? "«" : "»"}
            </span>
            {!collapsed && <span>جمع کردن منو</span>}
          </button>
        )}
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-semibold text-zinc-500 transition-colors hover:bg-red-950/40 hover:text-red-300",
              "focus-visible:ring-2 focus-visible:ring-red-500/60 focus-visible:outline-none"
            )}
          >
            <span
              aria-hidden
              className={cn("flex h-[18px] w-[18px] items-center justify-center text-base leading-none", collapsed && "mx-auto")}
            >
              ⏻
            </span>
            {!collapsed && <span>خروج</span>}
          </button>
        )}
      </div>
    </div>
  )
}

/** Desktop sidebar (fixed, collapsible to icon rail). */
export function Sidebar(props: SidebarProps) {
  const collapsed = props.collapsed ?? false
  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-screen shrink-0 border-s border-zinc-800/80 bg-zinc-950/95 backdrop-blur transition-[width] duration-200 lg:flex lg:flex-col",
        collapsed ? "w-[68px]" : "w-60"
      )}
    >
      <SidebarContent {...props} />
    </aside>
  )
}
