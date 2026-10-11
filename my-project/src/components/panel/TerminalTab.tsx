'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Eraser, Plus, Terminal as TerminalIcon, Unplug, X, Zap } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { io, type Socket } from 'socket.io-client'
import { getStoredKey } from '@/lib/panel'

type SessStatus = 'connecting' | 'connected' | 'error'

interface SessView {
  id: number
  status: SessStatus
  notice: string
}

interface SessRuntime {
  socket: Socket
  term: Terminal | null
  fit: FitAddon | null
  ro: ResizeObserver | null
}

const MAX_SESSIONS = 4

const fa = (n: number) => {
  try {
    return n.toLocaleString('fa-IR')
  } catch {
    return String(n)
  }
}

export default function TerminalTab() {
  const [sessions, setSessions] = useState<SessView[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [quickCmd, setQuickCmd] = useState('')
  const [globalNotice, setGlobalNotice] = useState('')

  const rtRef = useRef<Map<number, SessRuntime>>(new Map())
  const boxRef = useRef<Map<number, HTMLDivElement>>(new Map())
  const nextIdRef = useRef(1)
  const activeIdRef = useRef<number | null>(null)

  const activeSess = sessions.find((s) => s.id === activeId) || null

  // dead/error sessions no longer occupy a slot — count only live ones
  const liveCount = sessions.filter((s) => s.status !== 'error').length

  useEffect(() => {
    activeIdRef.current = activeId
  }, [activeId])

  // if the active tab was removed → activate the last remaining one
  useEffect(() => {
    if (activeId != null && !sessions.some((s) => s.id === activeId)) {
      setActiveId(sessions.length ? sessions[sessions.length - 1].id : null)
    }
  }, [sessions, activeId])

  const patchSess = useCallback((id: number, patch: Partial<SessView>) => {
    setSessions((arr) => arr.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }, [])

  const cleanupSess = useCallback((id: number) => {
    const rt = rtRef.current.get(id)
    if (rt) {
      rt.ro?.disconnect()
      try { rt.term?.dispose() } catch { /* noop */ }
      rt.socket.removeAllListeners?.()
      try { rt.socket.disconnect() } catch { /* noop */ }
      rtRef.current.delete(id)
    }
  }, [])

  const closeSess = useCallback(
    (id: number) => {
      // closing a live terminal kills its running processes — ask first
      const sess = sessions.find((s) => s.id === id)
      if (sess?.status === 'connected' && !window.confirm('این ترمینال بسته بشه؟ دستورهای در حال اجرا هم کشته می‌شن.')) return
      cleanupSess(id)
      boxRef.current.delete(id)
      setSessions((arr) => arr.filter((s) => s.id !== id))
    },
    [cleanupSess, sessions]
  )

  // dispose everything on unmount
  useEffect(() => {
    const map = rtRef.current
    return () => {
      for (const id of [...map.keys()]) {
        const rt = map.get(id)
        rt?.ro?.disconnect()
        try { rt?.term?.dispose() } catch { /* noop */ }
        rt?.socket.removeAllListeners?.()
        try { rt?.socket.disconnect() } catch { /* noop */ }
        map.delete(id)
      }
    }
  }, [])

  const openSession = useCallback(() => {
    const key = getStoredKey()
    if (!key) {
      setGlobalNotice('اول وارد پنل شو.')
      return
    }
    if (rtRef.current.size >= MAX_SESSIONS) return

    const id = nextIdRef.current++
    setSessions((arr) => [...arr, { id, status: 'connecting', notice: '' }])
    setActiveId(id)
    setGlobalNotice('')

    // Never use a port in the URL — the gateway routes on XTransformPort
    // forceNew: without it io() REUSES one manager for the same URL and the
    // second terminal would never get its own connection
    const socket = io('/?XTransformPort=3001', {
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 12_000,
      forceNew: true,
    })
    rtRef.current.set(id, { socket, term: null, fit: null, ro: null })

    socket.on('connect', () => {
      const box = boxRef.current.get(id)
      socket.emit('auth', {
        key,
        cols: Math.max(40, Math.round((box?.clientWidth || 800) / 9)),
        rows: Math.max(12, Math.round((box?.clientHeight || 420) / 18)),
      })
    })

    socket.on('auth-ok', () => {
      patchSess(id, { status: 'connected', notice: '' })
      // wait for the container div (rendered with the tab), then mount xterm
      let tries = 0
      const mount = () => {
        const box = boxRef.current.get(id)
        if (!box) {
          if (++tries > 40) return // ~2s — give up silently
          setTimeout(mount, 50)
          return
        }
        const rt = rtRef.current.get(id)
        if (!rt || rt.term) return
        const term = new Terminal({
          fontFamily: '"Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 14,
          cursorBlink: true,
          scrollback: 3000,
          theme: {
            background: '#09090b',
            foreground: '#d4d4d8',
            cursor: '#34d399',
            selectionBackground: '#065f46aa',
          },
        })
        const fit = new FitAddon()
        term.loadAddon(fit)
        term.open(box)
        try { fit.fit() } catch { /* noop */ }
        rt.term = term
        rt.fit = fit
        term.onData((d) => socket.emit('input', d))
        if (activeIdRef.current === id) term.focus()

        const ro = new ResizeObserver(() => {
          // only the visible terminal fits — hidden boxes have no size
          if (activeIdRef.current !== id) return
          if (!box || box.clientWidth < 40) return
          try {
            fit.fit()
            socket.emit('resize', { cols: term.cols, rows: term.rows })
          } catch {
            /* noop */
          }
        })
        ro.observe(box)
        rt.ro = ro
      }
      mount()
    })

    socket.on('output', (d: string) => {
      rtRef.current.get(id)?.term?.write(d)
    })

    socket.on('auth-fail', (d: { locked?: boolean; disabled?: boolean; limit?: boolean; max?: number; retryInSec?: number; remaining?: number }) => {
      let msg = ''
      if (d?.disabled) msg = 'ترمینال از سمت سرور غیرفعال شده (PANEL_TERM=0).'
      else if (d?.limit) msg = `حداکثر ${fa(d.max || MAX_SESSIONS)} ترمینال هم‌زمان — اول یکی را ببند.`
      else if (d?.locked) msg = `تلاش زیاد؛ ${d.retryInSec} ثانیه صبر کن.`
      else msg = `رمز پنل قبول نشد${d?.remaining != null ? ` — ${d.remaining} تلاش دیگه` : ''}.`
      patchSess(id, { status: 'error', notice: msg })
      try { socket.disconnect() } catch { /* noop */ }
    })

    socket.on('closed', (d: { reason?: string }) => {
      const msg =
        d?.reason === 'idle-timeout'
          ? 'جلسه بعد از ۳۰ دقیقه بی‌کاری بسته شد.'
          : 'جلسه بسته شد.'
      cleanupSess(id)
      patchSess(id, { status: 'error', notice: msg })
    })

    socket.on('disconnect', () => {
      const rt = rtRef.current.get(id)
      if (!rt) return // already handled by 'closed'
      cleanupSess(id)
      patchSess(id, { status: 'error', notice: 'ارتباط قطع شد.' })
    })

    socket.on('connect_error', () => {
      cleanupSess(id)
      patchSess(id, { status: 'error', notice: 'به سرویس ترمینال وصل نشد — دوباره امتحان کن.' })
    })
  }, [cleanupSess, patchSess])

  // re-fit the terminal that just became visible (tab switch)
  useEffect(() => {
    if (activeId == null) return
    const raf = requestAnimationFrame(() => {
      const rt = rtRef.current.get(activeId)
      const box = boxRef.current.get(activeId)
      if (rt?.fit && box && box.clientWidth > 40) {
        try {
          rt.fit.fit()
          rt.socket.emit('resize', { cols: rt.term?.cols, rows: rt.term?.rows })
          rt.term?.focus()
        } catch {
          /* noop */
        }
      }
    })
    return () => cancelAnimationFrame(raf)
  }, [activeId])

  const activeRt = activeId != null ? rtRef.current.get(activeId) : null
  const activeConnected = activeSess?.status === 'connected' && !!activeRt?.socket

  function disconnectActive() {
    if (activeId == null) return
    cleanupSess(activeId)
    patchSess(activeId, { status: 'error', notice: 'اتصال بسته شد.' })
  }

  function sendQuick() {
    const line = quickCmd.trim()
    if (!line || !activeConnected || !activeRt?.socket) return
    activeRt.socket.emit('input', line + '\r')
    setQuickCmd('')
  }

  function clearScreen() {
    try {
      activeRt?.term?.clear()
      activeRt?.term?.focus()
    } catch {
      /* noop */
    }
  }

  const dotCls = (st: SessStatus) =>
    st === 'connected'
      ? 'bg-emerald-400'
      : st === 'connecting'
        ? 'bg-amber-400 animate-pulse'
        : 'bg-red-400'

  return (
    <Card className="border-zinc-800 bg-zinc-900/70">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
          <TerminalIcon className="h-4 w-4 text-emerald-400" /> شل محیط ابری (کاربر z — بدون روت)
        </CardTitle>
        <div className="flex items-center gap-2">
          {activeSess ? (
            activeSess.status === 'connected' ? (
              <Badge className="bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">وصل</Badge>
            ) : activeSess.status === 'connecting' ? (
              <Badge className="bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40">در حال اتصال…</Badge>
            ) : (
              <Badge className="bg-red-500/15 text-red-400 ring-1 ring-red-500/40">بسته</Badge>
            )
          ) : (
            <Badge className="bg-zinc-800 text-zinc-400">بدون ترمینال</Badge>
          )}
          {activeConnected ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={clearScreen}
                className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
              >
                <Eraser className="h-3.5 w-3.5" /> پاک کردن
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={disconnectActive}
                className="h-8 border-red-900/60 bg-red-950/30 text-red-300 hover:bg-red-950/50"
              >
                <Unplug className="h-3.5 w-3.5" /> قطع
              </Button>
            </>
          ) : null}
          <Button
            size="sm"
            onClick={openSession}
            disabled={liveCount >= MAX_SESSIONS}
            title={liveCount >= MAX_SESSIONS ? `حداکثر ${fa(MAX_SESSIONS)} ترمینال هم‌زمان` : 'باز کردن یک ترمینال جدید'}
            className="h-8 bg-emerald-600 font-bold text-white hover:bg-emerald-500"
          >
            <Zap className="h-3.5 w-3.5" /> ترمینال جدید
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {globalNotice ? (
          <p className="rounded-md border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
            {globalNotice}
          </p>
        ) : null}

        {/* ---- terminal tab bar ---- */}
        <div className="flex flex-wrap items-center gap-1.5" dir="rtl">
          {sessions.map((s, idx) => (
            <div
              key={s.id}
              className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-bold transition-colors ${
                s.id === activeId
                  ? 'border-emerald-600/50 bg-emerald-950/40 text-emerald-300'
                  : 'border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-900'
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveId(s.id)}
                className="flex items-center gap-1.5"
                aria-pressed={s.id === activeId}
              >
                <span className={`h-2 w-2 rounded-full ${dotCls(s.status)}`} aria-hidden />
                ترمینال {fa(idx + 1)}
              </button>
              <button
                type="button"
                onClick={() => closeSess(s.id)}
                title="بستن این ترمینال"
                aria-label={`بستن ترمینال ${fa(idx + 1)}`}
                className="rounded p-0.5 text-zinc-500 hover:bg-zinc-800 hover:text-red-300"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          {sessions.length > 0 && liveCount < MAX_SESSIONS ? (
            <button
              type="button"
              onClick={openSession}
              className="flex items-center gap-1 rounded-lg border border-dashed border-zinc-700 px-2 py-1 text-[11px] font-bold text-zinc-400 transition-colors hover:border-emerald-700 hover:text-emerald-300"
            >
              <Plus className="h-3 w-3" /> جدید
            </button>
          ) : null}
        </div>

        {activeSess?.notice ? (
          <p className="rounded-md border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
            {activeSess.notice}
          </p>
        ) : null}

        {/* ---- terminal stack (one div per session; only the active one visible) ---- */}
        <div className="relative">
          {sessions.map((s) => (
            <div
              key={s.id}
              ref={(el) => {
                if (el) boxRef.current.set(s.id, el)
                else boxRef.current.delete(s.id)
              }}
              dir="ltr"
              className={`${s.id === activeId ? 'block' : 'hidden'} h-[420px] overflow-hidden rounded-lg border border-zinc-800 bg-[#09090b] p-2 md:h-[480px]`}
            />
          ))}
          {!activeConnected ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-zinc-950/85 text-center">
              <TerminalIcon className="h-8 w-8 text-zinc-600" />
              <p className="max-w-xs text-xs leading-6 text-zinc-400">
                {activeSess?.status === 'connecting'
                  ? 'در حال اتصال به سرویس ترمینال…'
                  : activeSess
                    ? 'این جلسه بسته شده — با دکمه «ترمینال جدید» دوباره بازش کن.'
                    : 'دکمه «ترمینال جدید» رو بزن تا یه شل کامل لینوکس باز بشه.'}
              </p>
            </div>
          ) : null}
        </div>

        <div className="flex gap-2">
          <Input
            dir="ltr"
            value={quickCmd}
            onChange={(e) => setQuickCmd(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendQuick()}
            placeholder="fast command — e.g. ~/tg-tools/watcher/watcher_ctl.sh status"
            disabled={!activeConnected}
            className="border-zinc-700 bg-zinc-950 text-left font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-emerald-500/50"
          />
          <Button
            variant="outline"
            onClick={sendQuick}
            disabled={!activeConnected || !quickCmd.trim()}
            className="border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-800"
          >
            اجرا
          </Button>
        </div>
        <p className="text-[11px] leading-5 text-zinc-500">
          ℹ️ این شل متصل به <strong className="text-zinc-400">محیط ابری دستیار</strong> است
          (کاربر <code dir="ltr" className="text-zinc-400">z</code> — بدون روت و بدون sudo؛
          رمز سودی وجود نداره و اینجا قابل تغییر هم نیست). این شل VPS/سرور شخصی
          شما نیست؛ پنل‌هایی مثل aaPanel باید روی سرور خودت با روت نصب بشن. برای
          پاک کردن صفحه هم دکمه «پاک کردن» یا <code dir="ltr" className="text-zinc-400">Ctrl+L</code>.
        </p>
        <p className="text-[11px] leading-5 text-zinc-500">
          ⚡ تا <strong className="text-zinc-400">{fa(MAX_SESSIONS)} ترمینال هم‌زمان</strong> باز
          میشه — هر تب یک شلِ مستقل خودش را دارد و کارها موازی اجرا می‌شوند. هر
          دستوری که توی هر ترمینالی بزنی ثبت میشه (audit). قبل از استفاده دستی از
          ابزارهای تلگرام (مثل <code dir="ltr" className="mx-1 text-zinc-400">send_dm.py</code>)
          حتماً واتچر رو pause کن تا سشن تداخل نکنه.
        </p>
      </CardContent>
    </Card>
  )
}
