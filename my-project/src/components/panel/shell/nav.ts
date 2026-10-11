import type { LucideIcon } from "lucide-react"
import {
  Activity,
  BookOpen,
  Bot,
  Brain,
  Cable,
  FolderOpen,
  LayoutDashboard,
  MessageCircle,
  Monitor,
  Palette,
  Server,
  ShieldAlert,
  Terminal,
  Users,
} from "lucide-react"

/**
 * CiaNet panel — navigation map for the sidebar shell.
 * keepAlive views stay mounted (hidden) when inactive so live PTY
 * sessions (terminal), unsaved forms (agent) and chat history survive
 * navigation — same contract as the legacy tab shell.
 */
export type ViewId =
  | "dashboard"
  | "agent"
  | "chat"
  | "llm"
  | "status"
  | "accounts"
  | "services"
  | "files"
  | "api"
  | "terminal"
  | "desktop"
  | "settings"
  | "system"
  | "manual"

export interface NavItem {
  id: ViewId
  label: string
  icon: LucideIcon
  /** stay mounted when inactive (PTY / forms / history) */
  keepAlive?: boolean
  /** badge dot when the watcher live-poll says offline */
  watcherRelevant?: boolean
}

export interface NavGroup {
  title: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "مرور کلی",
    items: [{ id: "dashboard", label: "داشبورد", icon: LayoutDashboard }],
  },
  {
    title: "هوش مصنوعی",
    items: [
      { id: "agent", label: "ایجنت", icon: Bot, keepAlive: true },
      { id: "chat", label: "چت", icon: MessageCircle, keepAlive: true },
      { id: "llm", label: "مدل‌ها و مغز", icon: Brain },
    ],
  },
  {
    title: "مدیریت سیستم",
    items: [
      { id: "status", label: "وضعیت واتچر", icon: Activity, watcherRelevant: true },
      { id: "accounts", label: "اکانت‌ها", icon: Users },
      { id: "services", label: "سرویس‌ها", icon: Server },
      { id: "files", label: "فایل‌ها", icon: FolderOpen },
      { id: "api", label: "API و اتصال", icon: Cable },
    ],
  },
  {
    title: "ابزارها",
    items: [
      { id: "terminal", label: "ترمینال", icon: Terminal, keepAlive: true },
      { id: "desktop", label: "دسکتاپ", icon: Monitor },
    ],
  },
  {
    title: "ترمیم و راهنما",
    items: [
      { id: "settings", label: "تنظیمات", icon: Palette },
      { id: "system", label: "سیستم", icon: ShieldAlert },
      { id: "manual", label: "راهنما", icon: BookOpen },
    ],
  },
]

export const ALL_VIEWS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items)

export function viewTitle(id: ViewId): string {
  return ALL_VIEWS.find((v) => v.id === id)?.label ?? id
}
