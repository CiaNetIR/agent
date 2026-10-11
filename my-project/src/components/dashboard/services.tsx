"use client"

import { Database, Globe, ServerCog, Boxes, ShieldCheck } from "lucide-react"
import { useSystemStatus } from "@/hooks/use-server-status"
import { SectionCard, SectionSkeleton } from "./section-card"
import { faNum, fmtBytes, fmtUptime } from "@/lib/format"
import { cn } from "@/lib/utils"

interface ServiceItemProps {
  name: string
  desc: string
  ok: boolean
  extra?: string
  icon: React.ReactNode
}

function ServiceItem({ name, desc, ok, extra, icon }: ServiceItemProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-card/60 p-3">
      <span
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          ok ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
        )}
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold">{name}</p>
          <span
            className={cn(
              "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold",
              ok
                ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "bg-rose-500/15 text-rose-600 dark:text-rose-400"
            )}
          >
            {ok ? "فعال" : "قطع"}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">{desc}</p>
        {extra ? <p className="truncate text-[11px] text-muted-foreground/80">{extra}</p> : null}
      </div>
    </div>
  )
}

export function ServicesSection() {
  const { data, isLoading } = useSystemStatus()

  return (
    <SectionCard title="وضعیت سرویس‌ها" icon={ShieldCheck}>
      {isLoading || !data ? (
        <SectionSkeleton rows={4} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ServiceItem
            name="وب‌سرور Next.js"
            desc={`پورت ۳۰۰۰ • پروسه ${data.services.web.pid ? faNum(data.services.web.pid, { maximumFractionDigits: 0 }) : "—"}`}
            extra={data.services.web.uptimeSec ? `فعالیت: ${fmtUptime(data.services.web.uptimeSec)}` : undefined}
            ok={data.services.web.running}
            icon={<ServerCog className="size-5" aria-hidden="true" />}
          />
          <ServiceItem
            name="گیت‌وی Caddy"
            desc="پورت ۸۱ • پروکسی ورودی ترافیک"
            ok={data.services.gateway.running}
            icon={<Globe className="size-5" aria-hidden="true" />}
          />
          <ServiceItem
            name="دیتابیس SQLite"
            desc={`Prisma • ${fmtBytes(data.services.database.sizeBytes)}`}
            extra={data.services.database.ok ? "اتصال برقرار ✓" : data.services.database.error}
            ok={data.services.database.ok}
            icon={<Database className="size-5" aria-hidden="true" />}
          />
          <ServiceItem
            name="این پنل پایش"
            desc="روی همان وب‌سرور فعال است"
            ok={data.ok}
            extra={`پاسخ API: ${faNum(data.responseMs)} م‌ث`}
            icon={<Boxes className="size-5" aria-hidden="true" />}
          />
        </div>
      )}
    </SectionCard>
  )
}
