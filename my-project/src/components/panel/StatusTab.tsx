'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import {
  Activity,
  Ban,
  Bot,
  Clock,
  MessageCircle,
  Package,
  RefreshCw,
  Send,
  ShieldAlert,
  Zap,
} from 'lucide-react'
import {
  EVENT_LABELS,
  formatUptime,
  panelFetch,
  tehranTime,
  type StatusData,
} from '@/lib/panel'

export default function StatusTab({ onRefreshLog }: { onRefreshLog?: () => void }) {
  const [data, setData] = useState<StatusData | null>(null)
  const [loading, setLoading] = useState(true)
  const [backingUp, setBackingUp] = useState(false)
  const { toast } = useToast()
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await panelFetch('/api/panel/status')
      if (res.status === 401) {
        toast({ title: 'نشست منقضی شده', description: 'دوباره وارد شو', variant: 'destructive' })
        return
      }
      const json: StatusData = await res.json()
      setData(json)
    } catch {
      /* keep old data */
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
    timerRef.current = setInterval(load, 30_000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [load])

  async function requestBackup() {
    if (backingUp) return
    setBackingUp(true)
    try {
      const res = await panelFetch('/api/panel/backup', { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json.ok) {
        toast({
          title: 'بکاپ فوری ثبت شد ✅',
          description: 'حداکثر ۱۰ ثانیه دیگه فایل بکاپ میاد تو Saved Messages تلگرامت.',
        })
      } else {
        toast({ title: 'نشد', description: json.error || 'دوباره امتحان کن', variant: 'destructive' })
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setBackingUp(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl bg-zinc-800/60" />
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-xl bg-zinc-800/60" />
      </div>
    )
  }
  if (!data?.ok) {
    return (
      <Card className="border-red-900 bg-red-950/30">
        <CardContent className="flex items-center gap-3 p-4 text-red-300">
          <ShieldAlert className="h-5 w-5" />
          وضعیت خوانده نشد — یکبار رفرش کن.
        </CardContent>
      </Card>
    )
  }

  const { watcher, state, today, blacklist, events } = data
  const statusBadge = !watcher.running
    ? { label: 'خاموش', cls: 'bg-red-500/15 text-red-400 ring-red-500/40' }
    : watcher.paused
      ? { label: 'توقف موقت', cls: 'bg-amber-500/15 text-amber-400 ring-amber-500/40' }
      : { label: 'فعال', cls: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/40' }

  return (
    <div className="space-y-4">
      {/* stat cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-zinc-400">وضعیت دستیار</p>
              <p className="mt-1 text-lg font-bold text-zinc-100">واتچر Z</p>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                {formatUptime(watcher.uptimeSec)} بالاست
              </p>
            </div>
            <Badge className={`ring-1 ${statusBadge.cls}`}>{statusBadge.label}</Badge>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-zinc-400">کل جواب‌های ارسالی</p>
              <p className="mt-1 text-2xl font-black text-emerald-400">{state.replies_total}</p>
            </div>
            <Send className="h-8 w-8 text-emerald-500/40" />
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-zinc-400">امروز (به وقت تهران)</p>
              <p className="mt-1 text-sm text-zinc-200">
                {today.incoming} پیام اومده
              </p>
              <p className="text-[11px] text-zinc-500">{today.replies} جواب رفته</p>
            </div>
            <MessageCircle className="h-8 w-8 text-amber-500/40" />
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <p className="text-xs text-zinc-400">دوره فعالیت</p>
              <p className="mt-1 text-lg font-bold text-zinc-100">
                {state.permanent ? 'همیشه فعال' : 'محدود'}
              </p>
              <p className="mt-0.5 text-[11px] text-zinc-500">
                استارت‌ها: {state.started_count}
              </p>
            </div>
            <Clock className="h-8 w-8 text-zinc-500/40" />
          </CardContent>
        </Card>
      </div>

      {/* actions + meta */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-zinc-200">
              <Package className="h-4 w-4 text-emerald-400" /> بکاپ فوری
            </div>
            <p className="text-xs leading-6 text-zinc-400">
              یه فایل بکاپ کامل (سشن + تنظیمات + کد) همین الان میره تو
              Saved Messages تلگرامت.
            </p>
            <Button
              onClick={requestBackup}
              disabled={backingUp}
              className="w-full bg-emerald-600 font-bold hover:bg-emerald-500"
            >
              {backingUp ? 'در حال ثبت…' : 'بکاپ بگیر و بفرست'}
            </Button>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-zinc-200">
              <Bot className="h-4 w-4 text-amber-400" /> مغز دستیار
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Badge className="bg-zinc-800 text-zinc-300">glm-4-plus</Badge>
              <Badge className="bg-zinc-800 text-zinc-300">حالت تفکر فعال</Badge>
              <Badge className="bg-zinc-800 text-zinc-300">۳ تلاش</Badge>
              <Badge className="bg-zinc-800 text-zinc-300">فوتر اجباری</Badge>
            </div>
            <p className="text-xs text-zinc-500">جزئیات کامل توی تب «تنظیمات Z»</p>
          </CardContent>
        </Card>
        <Card className="border-zinc-800 bg-zinc-900/70">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 text-sm font-bold text-zinc-200">
              <Ban className="h-4 w-4 text-red-400" /> بلاک‌لیست ({blacklist.length})
            </div>
            {blacklist.length === 0 ? (
              <p className="text-xs text-zinc-500">خالی</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {blacklist.map((b) => (
                  <Badge key={b.username} className="bg-red-500/10 text-red-400 ring-1 ring-red-500/30">
                    @{b.username}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* recent events */}
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Activity className="h-4 w-4 text-emerald-400" /> رویدادهای اخیر
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="hidden text-[10px] text-zinc-500 sm:inline">هر ۳۰ ثانیه رفرش میشه</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                load()
                onRefreshLog?.()
              }}
              className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-80 rounded-lg border border-zinc-800 bg-zinc-950/60 p-3">
            {events.length === 0 ? (
              <p className="p-4 text-center text-xs text-zinc-500">هنوز رویدادی ثبت نشده</p>
            ) : (
              <ul className="space-y-1.5">
                {events.map((ev, i) => (
                  <li
                    key={`${ev.ts}-${i}`}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-zinc-900"
                  >
                    <span className="shrink-0 text-[10px] tabular-nums text-zinc-500">
                      {tehranTime(ev.ts)}
                    </span>
                    <span
                      className={`shrink-0 font-medium ${
                        ev.event === 'reply_send'
                          ? 'text-emerald-400'
                          : ev.event === 'llm_fail' || ev.event === 'backup_fail'
                            ? 'text-red-400'
                            : 'text-zinc-300'
                      }`}
                    >
                      {EVENT_LABELS[ev.event] || ev.event}
                    </span>
                    {ev.chat_id ? (
                      <span className="shrink-0 text-[10px] text-zinc-600" dir="ltr">
                        #{ev.chat_id}
                      </span>
                    ) : null}
                    {ev.detail ? (
                      <span className="truncate text-zinc-500" dir="auto">
                        {ev.detail}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </ScrollArea>
        </CardContent>
      </Card>

      <p className="flex items-center gap-1.5 text-[11px] text-zinc-500">
        <Zap className="h-3 w-3 text-amber-500/70" />
        دستیار به هیچ دستوری خاموش نمیشه؛ توقف موقت فقط از شل سرور ممکنه.
      </p>
    </div>
  )
}
