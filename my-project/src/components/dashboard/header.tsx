"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Activity, Moon, RefreshCw, Server, Sun } from "lucide-react"
import { useTheme } from "next-themes"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip"
import { useSystemStatus } from "@/hooks/use-server-status"
import { faInt } from "@/lib/format"

function TehranClock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    const tick = () => setNow(new Date())
    const raf = requestAnimationFrame(tick)
    const t = setInterval(tick, 1000)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(t)
    }
  }, [])
  if (!now) return <span className="tabular-nums text-sm text-muted-foreground">--:--:--</span>
  const time = new Intl.DateTimeFormat("fa-IR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "Asia/Tehran",
  }).format(now)
  const date = new Intl.DateTimeFormat("fa-IR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "Asia/Tehran",
  }).format(now)
  return (
    <div className="text-left" dir="rtl">
      <div className="tabular-nums text-sm font-semibold leading-tight">{time}</div>
      <div className="text-[11px] leading-tight text-muted-foreground">{date}</div>
    </div>
  )
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            aria-label="تغییر پوسته روشن و تاریک"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            className="size-9"
          >
            <Sun className="hidden size-4 dark:block" aria-hidden="true" />
            <Moon className="block size-4 dark:hidden" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>تغییر پوسته</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function DashboardHeader() {
  const { data, refetch, isFetching } = useSystemStatus()

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-3 px-4 py-3 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="flex items-center gap-3"
        >
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <Server className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-base font-bold leading-tight sm:text-lg">پنل پایش سرور</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">
              داشبورد زنده وضعیت منابع، سرویس‌ها و لاگ‌ها
            </p>
          </div>
        </motion.div>

        <div className="ms-auto flex items-center gap-2 sm:gap-3">
          {data?.ok ? (
            <span className="hidden items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 sm:inline-flex">
              <span className="relative flex size-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
                <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
              </span>
              آنلاین
            </span>
          ) : (
            <span className="hidden items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400 sm:inline-flex">
              <Activity className="size-3" aria-hidden="true" />
              در حال اتصال…
            </span>
          )}

          {data ? (
            <span className="hidden text-xs text-muted-foreground md:inline">
              پاسخ API: {faInt(data.responseMs)} میلی‌ثانیه
            </span>
          ) : null}

          <TehranClock />

          <Button
            variant="outline"
            size="icon"
            aria-label="بروزرسانی دستی وضعیت"
            className="size-9"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw
              className={`size-4 transition-transform ${isFetching ? "animate-spin" : ""}`}
              aria-hidden="true"
            />
          </Button>

          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
