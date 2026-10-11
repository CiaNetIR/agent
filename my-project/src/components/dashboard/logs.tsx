"use client"

import { useEffect, useRef, useState } from "react"
import { ScrollText } from "lucide-react"
import { useServerLogs } from "@/hooks/use-server-status"
import { SectionCard } from "./section-card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { fmtBytes } from "@/lib/format"
import { cn } from "@/lib/utils"

function lineClass(line: string): string {
  if (/(⨯|Error|error|ERR|EADDRINUSE|failed|Failed)/.test(line)) return "text-rose-500"
  if (/(✓|Ready|compiled)/.test(line)) return "text-emerald-500"
  if (/(GET|POST|PUT|DELETE|PATCH|HEAD) \//.test(line)) return "text-teal-500"
  if (/warn|Warn|WARNING/.test(line)) return "text-amber-500"
  return "text-muted-foreground"
}

export function LogsSection() {
  const { data, isLoading } = useServerLogs(140)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [stick, setStick] = useState(true)

  useEffect(() => {
    const el = scrollRef.current
    if (el && stick) {
      el.scrollTop = el.scrollHeight
    }
  }, [data, stick])

  return (
    <SectionCard
      title="لاگ زنده سرور (dev.log)"
      icon={ScrollText}
      action={
        <div className="flex items-center gap-2">
          <Label htmlFor="log-stick" className="text-[11px] text-muted-foreground">
            چسبیدن به انتهای لاگ
          </Label>
          <Switch
            id="log-stick"
            checked={stick}
            onCheckedChange={(v) => {
              setStick(v)
              const el = scrollRef.current
              if (v && el) el.scrollTop = el.scrollHeight
            }}
            aria-label="چسبیدن به انتهای لاگ"
          />
        </div>
      }
      contentClassName="p-0 sm:p-0"
    >
      <div
        ref={scrollRef}
        className="custom-scrollbar max-h-96 overflow-y-auto rounded-b-lg bg-zinc-950 p-4 font-mono text-[11px] leading-relaxed dark:bg-black/40"
        dir="ltr"
        role="log"
        aria-live="polite"
        aria-label="خروجی لاگ سرور"
      >
        {isLoading ? (
          <p className="text-muted-foreground">در حال بارگذاری لاگ‌ها…</p>
        ) : !data || data.lines.length === 0 ? (
          <p className="text-muted-foreground">لاگی وجود ندارد</p>
        ) : (
          <>
            {data.lines.map((line, i) => (
              <p key={i} className={cn("whitespace-pre-wrap break-all", lineClass(line))}>
                {line || "\u00A0"}
              </p>
            ))}
            <p className="mt-1 select-none text-[10px] text-muted-foreground/50">
              — انتهای لاگ • حجم فایل: {fmtBytes(data.totalBytes)} —
            </p>
          </>
        )}
      </div>
    </SectionCard>
  )
}
