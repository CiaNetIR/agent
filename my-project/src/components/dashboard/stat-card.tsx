"use client"

import { motion } from "framer-motion"
import { Card, CardContent } from "@/components/ui/card"
import type { LucideIcon } from "lucide-react"
import { pctBarClass } from "@/lib/format"
import { cn } from "@/lib/utils"

/** tiny inline sparkline (pure SVG, no chart lib overhead) */
export function Sparkline({
  values,
  className,
  strokeClassName = "stroke-emerald-500",
}: {
  values: number[]
  className?: string
  strokeClassName?: string
}) {
  const w = 100
  const h = 26
  const pts = values.length > 1 ? values : [...values, ...values]
  const max = Math.max(...pts, 1)
  const step = w / Math.max(pts.length - 1, 1)
  const points = pts
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`)
    .join(" ")
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className={cn("h-7 w-full", className)}
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(strokeClassName)}
      />
    </svg>
  )
}

interface StatCardProps {
  title: string
  icon: LucideIcon
  value: string
  sub?: string
  progress?: number | null
  spark?: number[]
  sparkClassName?: string
  chip?: string
  index?: number
}

export function StatCard({
  title,
  icon: Icon,
  value,
  sub,
  progress,
  spark,
  sparkClassName = "stroke-emerald-500",
  chip,
  index = 0,
}: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.06 }}
    >
      <Card className="h-full border-border/60 shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Icon className="size-3.5" aria-hidden="true" />
                {title}
              </p>
              <p className="mt-1.5 truncate text-2xl font-bold tabular-nums leading-none">
                {value}
              </p>
              {sub ? (
                <p className="mt-1.5 truncate text-xs text-muted-foreground">{sub}</p>
              ) : null}
            </div>
            {chip ? (
              <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                {chip}
              </span>
            ) : null}
          </div>

          {typeof progress === "number" ? (
            <div
              className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={Math.round(progress)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={title}
            >
              <motion.div
                className={cn("h-full rounded-full", pctBarClass(progress))}
                initial={{ width: 0 }}
                animate={{ width: `${Math.min(Math.max(progress, 0), 100)}%` }}
                transition={{ duration: 0.5 }}
              />
            </div>
          ) : null}

          {spark && spark.length > 0 ? (
            <div className="mt-2 opacity-80">
              <Sparkline values={spark} strokeClassName={sparkClassName} />
            </div>
          ) : null}
        </CardContent>
      </Card>
    </motion.div>
  )
}
