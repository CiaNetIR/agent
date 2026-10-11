"use client"

import { MonitorCog, Network } from "lucide-react"
import { useSystemStatus } from "@/hooks/use-server-status"
import { SectionCard, SectionSkeleton } from "./section-card"
import { faNum, fmtUptime } from "@/lib/format"

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border/40 py-2 last:border-0">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="truncate text-sm font-medium" title={typeof value === "string" ? value : undefined}>
        {value}
      </span>
    </div>
  )
}

export function SystemInfoSection() {
  const { data, isLoading } = useSystemStatus()

  return (
    <SectionCard title="مشخصات سیستم" icon={MonitorCog}>
      {isLoading || !data ? (
        <SectionSkeleton rows={6} />
      ) : (
        <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          <div>
            <InfoRow label="نام میزبان" value={data.system.hostname || "—"} />
            <InfoRow
              label="سیستم‌عامل"
              value={`${data.system.platform === "linux" ? "لینوکس" : data.system.platform} (${data.system.arch})`}
            />
            <InfoRow label="هسته" value={data.system.kernel} />
            <InfoRow label="تعداد هسته پردازنده" value={faNum(data.system.cpuCores, { maximumFractionDigits: 0 })} />
            <InfoRow label="آی‌پی داخلی" value={data.system.ip || "—"} />
          </div>
          <div>
            <InfoRow label="نسخه Node.js" value={data.system.nodeVersion} />
            <InfoRow label="نسخه Bun" value={data.system.bunVersion} />
            <InfoRow label="نسخه Next.js" value={data.system.nextVersion} />
            <InfoRow label="مدت فعالیت سیستم" value={fmtUptime(data.system.uptimeSec)} />
            <InfoRow label="منطقه زمانی" value={data.system.timezone} />
          </div>
        </div>
      )}
    </SectionCard>
  )
}

export function NetworkSection() {
  const { data, isLoading } = useSystemStatus()

  return (
    <SectionCard title="اطلاعات شبکه" icon={Network}>
      {isLoading || !data ? (
        <SectionSkeleton rows={3} />
      ) : (
        <div>
          <InfoRow
            label="آدرس‌های شنیدن‌شده (Listen)"
            value={faNum(data.ports.length, { maximumFractionDigits: 0 })}
          />
          <InfoRow
            label="وب‌سرور (پورت ۳۰۰۰)"
            value={
              data.ports.some((p) => p.port === 3000) ? (
                <span className="text-emerald-500">در حال شنیدن ✓</span>
              ) : (
                <span className="text-rose-500">قطع</span>
              )
            }
          />
          <InfoRow
            label="گیت‌وی Caddy (پورت ۸۱)"
            value={
              data.ports.some((p) => p.port === 81) ? (
                <span className="text-emerald-500">در حال شنیدن ✓</span>
              ) : (
                <span className="text-rose-500">قطع</span>
              )
            }
          />
          <InfoRow
            label="مدل پردازنده"
            value={data.system.cpuModel.replace(/\s+/g, " ").trim()}
          />
        </div>
      )}
    </SectionCard>
  )
}
