"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { LineChart } from "lucide-react"
import { useSystemStatus, getStatusHistory } from "@/hooks/use-server-status"
import { SectionCard } from "./section-card"
import { faNum } from "@/lib/format"

interface ChartPoint {
  t: number
  cpu: number
  mem: number
}

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: { value?: number; dataKey?: string | number }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  const cpu = payload.find((p) => p.dataKey === "cpu")?.value
  const mem = payload.find((p) => p.dataKey === "mem")?.value
  return (
    <div className="rounded-lg border border-border/60 bg-popover px-3 py-2 text-xs shadow-lg" dir="rtl">
      {typeof label === "number" ? (
        <p className="mb-1 text-muted-foreground">نمونه {faNum(label, { maximumFractionDigits: 0 })}</p>
      ) : null}
      {cpu !== undefined ? (
        <p className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-500" />
          پردازنده: <b>{faNum(cpu)}٪</b>
        </p>
      ) : null}
      {mem !== undefined ? (
        <p className="flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-amber-500" />
          رم: <b>{faNum(mem)}٪</b>
        </p>
      ) : null}
    </div>
  )
}

export function LiveChartsSection() {
  const { data, isLoading } = useSystemStatus()
  const { cpuHistory, memHistory } = getStatusHistory()

  const points: ChartPoint[] = cpuHistory.map((cpu, i) => ({
    t: i,
    cpu: Math.round(cpu * 10) / 10,
    mem: Math.round((memHistory[i] ?? 0) * 10) / 10,
  }))

  return (
    <SectionCard
      title="نمودار زنده منابع (۹۰ نمونه اخیر)"
      icon={LineChart}
      action={
        <span className="text-[11px] text-muted-foreground">
          {data ? `پردازنده ${faNum(data.cpu.usagePct)}٪ • رم ${faNum(data.memory.usedPct)}٪` : "…"}
        </span>
      }
    >
      <div className="h-44 w-full" dir="ltr" aria-label="نمودار مصرف پردازنده و رم">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            در حال جمع‌آوری داده‌ها…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 6, right: 6, bottom: 0, left: -18 }}>
              <defs>
                <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#10b981" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="memFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" className="text-border" vertical={false} />
              <XAxis dataKey="t" hide />
              <YAxis domain={[0, 100]} tickCount={5} tick={{ fontSize: 11 }} stroke="currentColor" className="text-muted-foreground" tickFormatter={(v: number) => faNum(v, { maximumFractionDigits: 0 })} />
              <Tooltip content={<ChartTooltip />} />
              <Area
                type="monotone"
                dataKey="cpu"
                stroke="#10b981"
                strokeWidth={2}
                fill="url(#cpuFill)"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="mem"
                stroke="#f59e0b"
                strokeWidth={2}
                fill="url(#memFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-2 flex items-center justify-center gap-5 text-xs text-muted-foreground" dir="rtl">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-emerald-500" />
          مصرف پردازنده
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-amber-500" />
          مصرف رم
        </span>
      </div>
    </SectionCard>
  )
}
