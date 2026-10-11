'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/hooks/use-toast'
import { Loader2, LockKeyhole, ShieldCheck, Star } from 'lucide-react'
import { sha256Hex } from '@/lib/panel'

export default function LockScreen({ onUnlock }: { onUnlock: (key: string) => void }) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [shake, setShake] = useState(false)
  const { toast } = useToast()

  async function submit() {
    if (!password.trim() || busy) return
    setBusy(true)
    try {
      const key = await sha256Hex(password.trim())
      const res = await fetch('/api/panel/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.ok) {
        onUnlock(key)
      } else if (res.status === 429) {
        toast({
          title: 'قفل موقت',
          description: `بیش از حد تلاش اشتباه بود. ${data.retryInSec} ثانیه دیگر امتحان کن.`,
          variant: 'destructive',
        })
      } else {
        setShake(true)
        setTimeout(() => setShake(false), 500)
        toast({
          title: 'رمز اشتباهه',
          description:
            data.remaining != null
              ? `${data.remaining} تلاش دیگه مونده (بعدش ۵ دقیقه قفل میشه)`
              : 'رمز پنل رو از پیام بکاپ تلگرام بردار',
          variant: 'destructive',
        })
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4">
      <Card
        dir="rtl"
        className={`w-full max-w-sm border-zinc-800 bg-zinc-900/80 shadow-2xl shadow-black/40 ${
          shake ? 'animate-pulse ring-2 ring-red-500/60' : ''
        }`}
      >
        <CardHeader className="items-center space-y-3 pb-2 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-400/20 to-emerald-500/20 ring-1 ring-amber-400/40">
            <Star className="h-8 w-8 fill-amber-400 text-amber-400" />
          </div>
          <CardTitle className="text-xl font-bold text-zinc-100">
            پنل مدیریت <span className="text-amber-400">Z</span>
          </CardTitle>
          <p className="text-xs text-zinc-400">فروشگاه VPN | STAR — فقط مالک</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="relative">
              <LockKeyhole className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
              <Input
                dir="ltr"
                type="password"
                autoFocus
                aria-label="رمز پنل"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submit()}
                placeholder="رمز پنل"
                className="border-zinc-700 bg-zinc-950 pl-9 text-left text-zinc-100 placeholder:text-zinc-600 focus-visible:ring-emerald-500/50"
              />
            </div>
            <Button
              onClick={submit}
              disabled={busy || !password.trim()}
              className="w-full bg-emerald-600 font-bold text-white hover:bg-emerald-500"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              ورود
            </Button>
          </div>
          <p className="text-center text-[11px] leading-5 text-zinc-500">
            رمز توی پیام بکاپ تلگرام (Saved Messages) برات ارسال شده.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
