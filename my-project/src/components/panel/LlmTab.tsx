'use client'

import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Brain,
  ChevronDown,
  Cpu,
  Gauge,
  ListOrdered,
  ScrollText,
  Stamp,
} from 'lucide-react'
import { panelFetch, type LlmSettings } from '@/lib/panel'

export default function LlmTab() {
  const [data, setData] = useState<LlmSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        const res = await panelFetch('/api/panel/llm-settings')
        const json: LlmSettings = await res.json()
        if (res.ok && json.ok) setData(json)
        else setErr('خواندن تنظیمات ممکن نشد')
      } catch {
        setErr('ارتباط برقرار نشد')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-xl bg-zinc-800/60" />
        <Skeleton className="h-64 w-full rounded-xl bg-zinc-800/60" />
        <Skeleton className="h-40 w-full rounded-xl bg-zinc-800/60" />
      </div>
    )
  }
  if (err || !data?.settings) {
    return (
      <Card className="border-amber-900/50 bg-amber-950/20">
        <CardContent className="p-4 text-sm text-amber-300">{err}</CardContent>
      </Card>
    )
  }

  const s = data.settings

  return (
    <div className="space-y-4">
      {/* brain / model */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Brain className="h-4 w-4 text-amber-400" /> مغز و مدل
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <p className="text-xs text-zinc-500">مدل زبانی</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge className="bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30">
                <Cpu className="ml-1 h-3 w-3" /> {s.model}
              </Badge>
              {s.thinking && (
                <Badge className="bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30">
                  حالت تفکر
                </Badge>
              )}
              <Badge className="bg-zinc-800 text-zinc-300">{s.retries} تلاش مجدد</Badge>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-zinc-500">محدودیت‌های ارسال</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge className="bg-zinc-800 text-zinc-300">
                <Gauge className="ml-1 h-3 w-3" /> هر چت {s.rate_limits.per_chat_hour}/ساعت
              </Badge>
              <Badge className="bg-zinc-800 text-zinc-300">کلی {s.rate_limits.global_hour}/ساعت</Badge>
              <Badge className="bg-zinc-800 text-zinc-300">
                تاخیر {s.rate_limits.debounce_s} ثانیه
              </Badge>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-zinc-500">قیمت‌های رسمی (بخشی از شخصیت)</p>
            <div className="flex flex-wrap gap-1.5">
              <Badge className="bg-zinc-800 text-zinc-300">اندروید: {s.prices.android_monthly}</Badge>
              <Badge className="bg-zinc-800 text-zinc-300">حجمی: {s.prices.per_gb}</Badge>
            </div>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-zinc-500">فوتر اجباری هر پیام بات</p>
            <p className="rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-300" dir="rtl">
              «{s.footer.trim()}»
            </p>
          </div>
        </CardContent>
      </Card>

      {/* persona */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <ScrollText className="h-4 w-4 text-emerald-400" /> شخصیت دستیار (SYSTEM_PROMPT)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 text-[13px] leading-7 text-zinc-300" dir="rtl">
            {s.persona}
          </pre>
          <p className="mt-2 text-[11px] text-zinc-500">
            منبع اصلی: <code dir="ltr" className="text-zinc-400">~/tg-tools/watcher/watcher.py</code> —
            برای تغییر، از ایجنت بخواه یا خودت توی ترمینال ویرایش کن و ری‌استارت بده.
          </p>
        </CardContent>
      </Card>

      {/* command brain */}
      <Collapsible dir="rtl">
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CollapsibleTrigger className="w-full">
            <CardHeader className="pb-3">
              <CardTitle className="flex w-full items-center justify-between text-sm font-bold text-zinc-200">
                <span className="flex items-center gap-2">
                  <ListOrdered className="h-4 w-4 text-amber-400" /> مغز فرمان‌های Saved Messages
                </span>
                <ChevronDown className="h-4 w-4 text-zinc-500" />
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent>
              <pre className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border border-zinc-800 bg-zinc-950/70 p-4 text-[13px] leading-7 text-zinc-300" dir="rtl">
                {s.command_prompt}
              </pre>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* standing instructions */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Stamp className="h-4 w-4 text-emerald-400" /> قوانین دائمی مالک ({s.instructions.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {s.instructions.length === 0 ? (
            <p className="text-xs text-zinc-500">هیچ قانون دائمی ثبت نشده.</p>
          ) : (
            <ol className="space-y-2">
              {s.instructions.map((ins, i) => (
                <li
                  key={i}
                  className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 text-[13px] leading-7 text-zinc-300"
                >
                  <span className="ml-2 text-emerald-500">{i + 1}.</span>
                  {ins}
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 text-[11px] text-zinc-500">
            این قوانین با فرمان «یادت باشه که …» توی Saved Messages اضافه میشن و با
            «قوانین رو فراموش کن» پاک میشن. بعد از هر تغییری، بکاپ خودکار میره تو
            Saved Messages.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
