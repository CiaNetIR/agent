"use client"

import { Plug } from "lucide-react"
import { useSystemStatus } from "@/hooks/use-server-status"
import { SectionCard, SectionSkeleton } from "./section-card"
import { Badge } from "@/components/ui/badge"
import { faInt } from "@/lib/format"
import { cn } from "@/lib/utils"

function portLabel(port: number): string | null {
  switch (port) {
    case 3000:
      return "اپ Next.js"
    case 81:
      return "گیت‌وی Caddy"
    default:
      return null
  }
}

export function PortsSection() {
  const { data, isLoading } = useSystemStatus()

  return (
    <SectionCard
      title="پورت‌های باز (در حال شنیدن)"
      icon={Plug}
      action={<span className="text-[11px] text-muted-foreground">{data ? `${faInt(data.ports.length)} پورت` : ""}</span>}
      contentClassName="p-0 sm:p-0"
    >
      <div className="max-h-72 overflow-y-auto p-4 pt-0 sm:p-5 sm:pt-0 custom-scrollbar">
        {isLoading || !data ? (
          <SectionSkeleton rows={4} />
        ) : data.ports.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">پورتی یافت نشد</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 text-start text-xs text-muted-foreground">
                <th className="py-2 pe-2 text-start font-medium">پورت</th>
                <th className="py-2 pe-2 text-start font-medium">آدرس</th>
                <th className="py-2 pe-2 text-start font-medium">وضعیت</th>
                <th className="py-2 text-start font-medium">پروسه</th>
              </tr>
            </thead>
            <tbody>
              {data.ports.map((p, i) => {
                const label = portLabel(p.port)
                return (
                  <tr key={`${p.port}-${p.addr}-${i}`} className="border-b border-border/30 last:border-0">
                    <td className="py-2.5 pe-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="tabular-nums font-semibold">{faInt(p.port)}</span>
                        {label ? (
                          <Badge variant="secondary" className="rounded-md px-1.5 py-0 text-[10px]">
                            {label}
                          </Badge>
                        ) : null}
                      </span>
                    </td>
                    <td className="py-2.5 pe-2 font-mono text-xs text-muted-foreground" dir="ltr">
                      {p.addr || "*"}
                    </td>
                    <td className="py-2.5 pe-2">
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className={cn("size-1.5 rounded-full", p.state === "listening" ? "bg-emerald-500" : "bg-muted-foreground")} />
                        {p.state === "listening" ? "شنیدن" : p.state}
                      </span>
                    </td>
                    <td className="max-w-[10rem] truncate py-2.5 font-mono text-xs text-muted-foreground" dir="ltr" title={p.process}>
                      {p.process || "—"}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </SectionCard>
  )
}
