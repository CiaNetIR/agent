'use client'

import { useEffect, useRef } from 'react'
import { Loader2, Star } from 'lucide-react'

export default function LockScreen({ onUnlock }: { onUnlock: (key: string) => void }) {
  const attempted = useRef(false)
  useEffect(() => {
    if (attempted.current) return
    attempted.current = true
    ;(async () => {
      try {
        const res = await fetch('/api/panel/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'open' }) })
        const data = await res.json().catch(() => ({}))
        if (res.ok && data.ok) onUnlock(data.sessionToken || 'open-session')
        else setTimeout(() => { attempted.current = false }, 2000)
      } catch { setTimeout(() => { attempted.current = false }, 2000) }
    })()
  }, [onUnlock])
  return (
    <div className="flex min-h-[70vh] items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-amber-400/20 to-emerald-500/20 ring-1 ring-amber-400/40">
          <Star className="h-8 w-8 fill-amber-400 text-amber-400" />
        </div>
        <h1 className="mb-2 text-xl font-bold text-zinc-100">پنل مدیریت <span className="text-amber-400">Z</span></h1>
        <p className="mb-6 text-xs text-zinc-400">فروشگاه VPN | STAR — فقط مالک</p>
        <div className="flex items-center justify-center gap-2 text-zinc-300">
          <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">در حال ورود…</span>
        </div>
      </div>
    </div>
  )
}
