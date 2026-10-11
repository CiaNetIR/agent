"use client"

import { Activity } from "lucide-react"
import { useSystemStatus } from "@/hooks/use-server-status"
import { faTime, fmtBytes } from "@/lib/format"

export function DashboardFooter() {
  const { data } = useSystemStatus()

  return (
    <footer className="mt-auto border-t border-border/60 bg-card/50 pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 text-xs text-muted-foreground sm:px-6">
        <p className="flex items-center gap-1.5">
          <Activity className="size-3.5 text-emerald-500" aria-hidden="true" />
          پنل پایش سرور — ساخته‌شده با Next.js و Tailwind CSS
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {data ? (
            <>
              <span>آخرین بروزرسانی: {faTime(data.timestamp, true)}</span>
              <span aria-hidden="true">•</span>
              <span>حجم دیتابیس: {fmtBytes(data.services.database.sizeBytes)}</span>
              <span aria-hidden="true">•</span>
              <span>worklog: {fmtBytes(data.project.worklogBytes)}</span>
            </>
          ) : (
            <span>در انتظار داده‌ها…</span>
          )}
        </p>
      </div>
    </footer>
  )
}
