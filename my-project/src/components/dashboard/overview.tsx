"use client"

import { Cpu, Gauge, HardDrive, MemoryStick, Timer, Layers, Zap } from "lucide-react"
import { useSystemStatus, getStatusHistory } from "@/hooks/use-server-status"
import { StatCard } from "./stat-card"
import { Skeleton } from "@/components/ui/skeleton"
import { faNum, fmtBytes, fmtUptime, pctTextClass } from "@/lib/format"
import { cn } from "@/lib/utils"

export function OverviewSection() {
  const { data, isLoading, isError, refetch } = useSystemStatus()
  const { cpuHistory, memHistory } = getStatusHistory()

  if (isError) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400">
        خطا در دریافت وضعیت سرور.{" "}
        <button className="font-semibold underline" onClick={() => refetch()}>
          تلاش مجدد
        </button>
      </div>
    )
  }

  if (isLoading || !data) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-40 rounded-xl" />
        ))}
      </div>
    )
  }

  const rootDisk = data.disks.find((d) => d.mount === "/") ?? data.disks[0]
  const load1 = data.system.loadAvg?.[0] ?? 0

  return (
    <section aria-label="نمای کلی منابع" className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          index={0}
          title="پردازنده"
          icon={Cpu}
          value={`${faNum(data.cpu.usagePct)}٪`}
          sub={`${data.system.cpuModel.replace(/\s+/g, " ").trim().slice(0, 34)}`}
          progress={data.cpu.usagePct}
          spark={cpuHistory}
          chip={`${faNum(data.system.cpuCores, { maximumFractionDigits: 0 })} هسته`}
        />
        <StatCard
          index={1}
          title="حافظه رم"
          icon={MemoryStick}
          value={`${faNum(data.memory.usedPct)}٪`}
          sub={`${fmtBytes(data.memory.used)} از ${fmtBytes(data.memory.total)}`}
          progress={data.memory.usedPct}
          spark={memHistory}
          sparkClassName="stroke-amber-500"
          chip={`آزاد: ${fmtBytes(data.memory.available)}`}
        />
        <StatCard
          index={2}
          title="فضای دیسک"
          icon={HardDrive}
          value={
            rootDisk
              ? `${faNum(rootDisk.usedPct, { maximumFractionDigits: 0 })}٪`
              : "—"
          }
          sub={
            rootDisk
              ? `${fmtBytes(rootDisk.usedBytes)} از ${fmtBytes(rootDisk.totalBytes)}`
              : "اطلاعات در دسترس نیست"
          }
          progress={rootDisk?.usedPct ?? null}
          sparkClassName="stroke-teal-500"
          chip={rootDisk ? rootDisk.type : undefined}
        />
        <StatCard
          index={3}
          title="بار سیستمی"
          icon={Gauge}
          value={faNum(load1, { maximumFractionDigits: 2 })}
          sub={`۵ دقیقه: ${faNum(data.system.loadAvg?.[1], { maximumFractionDigits: 2 })} • ۱۵ دقیقه: ${faNum(data.system.loadAvg?.[2], { maximumFractionDigits: 2 })}`}
          sparkClassName={cn("stroke-rose-500")}
          chip={`بازه: ${faNum(load1 / Math.max(data.system.cpuCores, 1), { maximumFractionDigits: 1 })}`}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5">
          <Timer className="size-3.5 text-emerald-500" aria-hidden="true" />
          بالاتر رفتن سیستم: <b className="font-semibold">{fmtUptime(data.system.uptimeSec)}</b>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5">
          <Layers className="size-3.5 text-teal-500" aria-hidden="true" />
          تعداد پروسه‌ها: <b className="font-semibold">{faNum(data.processCount, { maximumFractionDigits: 0 })}</b>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5">
          <Zap className="size-3.5 text-amber-500" aria-hidden="true" />
          کش رم: <b className="font-semibold">{fmtBytes(data.memory.cached)}</b>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-3 py-1.5">
          سوآپ:{" "}
          <b className={cn("font-semibold", pctTextClass(data.memory.swapPct || 0))}>
            {data.memory.swapTotal > 0
              ? `${fmtBytes(data.memory.swapUsed)} از ${fmtBytes(data.memory.swapTotal)}`
              : "غیرفعال"}
          </b>
        </span>
      </div>
    </section>
  )
}
