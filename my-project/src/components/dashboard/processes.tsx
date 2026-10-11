"use client"

import { ListTree } from "lucide-react"
import { useSystemStatus } from "@/hooks/use-server-status"
import { SectionCard, SectionSkeleton } from "./section-card"
import { faNum } from "@/lib/format"
import { cn } from "@/lib/utils"

function MiniBar({ value, className }: { value: number; className: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-muted">
        <span
          className={cn("block h-full rounded-full", className)}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </span>
      <span className="tabular-nums text-xs">{faNum(value)}٪</span>
    </span>
  )
}

export function ProcessesSection() {
  const { data, isLoading } = useSystemStatus()

  return (
    <SectionCard
      title="پروسه‌های پرمصرف (مرتب بر اساس پردازنده)"
      icon={ListTree}
      action={<span className="text-[11px] text-muted-foreground">{data ? `${faNum(data.processCount, { maximumFractionDigits: 0 })} پروسه فعال` : ""}</span>}
      contentClassName="p-0 sm:p-0"
    >
      <div className="max-h-96 overflow-y-auto p-4 pt-0 sm:p-5 sm:pt-0 custom-scrollbar">
        {isLoading || !data ? (
          <SectionSkeleton rows={6} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-xs text-muted-foreground">
                <th className="py-2 pe-2 text-start font-medium">شناسه</th>
                <th className="py-2 pe-2 text-start font-medium">کاربر</th>
                <th className="py-2 pe-2 text-start font-medium">پردازنده</th>
                <th className="py-2 pe-2 text-start font-medium">رم</th>
                <th className="py-2 text-start font-medium">دستور</th>
              </tr>
            </thead>
            <tbody>
              {data.processes.map((p) => (
                <tr key={p.pid} className="border-b border-border/30 last:border-0">
                  <td className="py-2.5 pe-2 font-mono text-xs tabular-nums">{faNum(p.pid, { maximumFractionDigits: 0 })}</td>
                  <td className="py-2.5 pe-2 text-xs">{p.user}</td>
                  <td className="py-2.5 pe-2">
                    <MiniBar value={p.cpu} className={p.cpu > 60 ? "bg-rose-500" : p.cpu > 25 ? "bg-amber-500" : "bg-emerald-500"} />
                  </td>
                  <td className="py-2.5 pe-2">
                    <MiniBar value={p.mem} className={p.mem > 60 ? "bg-rose-500" : p.mem > 25 ? "bg-amber-500" : "bg-teal-500"} />
                  </td>
                  <td
                    className="max-w-[12rem] truncate py-2.5 font-mono text-xs text-muted-foreground"
                    dir="ltr"
                    title={p.command}
                  >
                    {p.command}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </SectionCard>
  )
}
