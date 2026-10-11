'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Eraser, Terminal as TerminalIcon, Unplug, Zap } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { io, type Socket } from 'socket.io-client'
import { getStoredKey } from '@/lib/panel'

type TermStatus = 'idle' | 'connecting' | 'connected' | 'error'

export default function TerminalTab() {
  const [status, setStatus] = useState<TermStatus>('idle')
  const [notice, setNotice] = useState('')
  const [quickCmd, setQuickCmd] = useState('')
  const socketRef = useRef<Socket | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const boxRef = useRef<HTMLDivElement | null>(null)
  const roRef = useRef<ResizeObserver | null>(null)

  const cleanup = useCallback(() => {
    roRef.current?.disconnect()
    roRef.current = null
    termRef.current?.dispose()
    termRef.current = null
    fitRef.current = null
    socketRef.current?.removeAllListeners?.()
    socketRef.current?.disconnect()
    socketRef.current = null
  }, [])

  useEffect(() => cleanup, [cleanup])

  function connect() {
    if (status === 'connecting' || status === 'connected') return
    const key = getStoredKey()
    if (!key) {
      setNotice('اول وارد پنل شو.')
      return
    }
    setStatus('connecting')
    setNotice('')

    // Never use a port in the URL — the gateway routes on XTransformPort
    const socket = io('/?XTransformPort=3001', {
      transports: ['websocket', 'polling'],
      reconnection: false,
      timeout: 12_000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      const box = boxRef.current
      socket.emit('auth', {
        key,
        cols: Math.max(40, Math.round((box?.clientWidth || 800) / 9)),
        rows: Math.max(12, Math.round((box?.clientHeight || 420) / 18)),
      })
    })

    socket.on('auth-ok', () => {
      setStatus('connected')
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
      term.open(boxRef.current!)
      fit.fit()
      termRef.current = term
      fitRef.current = fit
      term.onData((d) => socket.emit('input', d))
      term.focus()

      const ro = new ResizeObserver(() => {
        try {
          fit.fit()
          socket.emit('resize', { cols: term.cols, rows: term.rows })
        } catch {
          /* noop */
        }
      })
      ro.observe(boxRef.current!)
      roRef.current = ro
    })

    socket.on('output', (d: string) => termRef.current?.write(d))

    socket.on('auth-fail', (d: { locked?: boolean; disabled?: boolean; retryInSec?: number; remaining?: number }) => {
      setStatus('error')
      if (d?.disabled) setNotice('ترمینال از سمت سرور غیرفعال شده (PANEL_TERM=0).')
      else if (d?.locked) setNotice(`تلاش زیاد؛ ${d.retryInSec} ثانیه صبر کن.`)
      else setNotice(`رمز پنل قبول نشد${d?.remaining != null ? ` — ${d.remaining} تلاش دیگه` : ''}.`)
      socket.disconnect()
    })

    socket.on('closed', (d: { reason?: string }) => {
      setNotice(
        d?.reason === 'idle-timeout'
          ? 'جلسه بعد از ۳۰ دقیقه بی‌کاری بسته شد.'
          : d?.reason === 'new-session'
            ? 'یه جلسه جدید جای این جلسه رو گرفت.'
            : 'جلسه بسته شد.'
      )
      setStatus('idle')
      cleanup()
    })

    socket.on('disconnect', () => {
      setStatus((s) => {
        if (s === 'connected') {
          setNotice('ارتباط قطع شد.')
          return 'idle'
        }
        return s
      })
      setTimeout(() => {
        if (socketRef.current === socket) cleanup()
      }, 100)
    })

    socket.on('connect_error', () => {
      setStatus('error')
      setNotice('به سرویس ترمینال وصل نشد — چند لحظه بعد دوباره امتحان کن.')
      cleanup()
    })
  }

  function disconnect() {
    cleanup()
    setStatus('idle')
    setNotice('اتصال بسته شد.')
  }

  function sendQuick() {
    const line = quickCmd.trim()
    if (!line || status !== 'connected' || !socketRef.current) return
    socketRef.current.emit('input', line + '\r')
    setQuickCmd('')
  }

  function clearScreen() {
    try {
      termRef.current?.clear()
      termRef.current?.focus()
    } catch {
      /* noop */
    }
  }

  return (
    <Card className="border-zinc-800 bg-zinc-900/70">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
          <TerminalIcon className="h-4 w-4 text-emerald-400" /> شل محیط ابری (کاربر z — بدون روت)
        </CardTitle>
        <div className="flex items-center gap-2">
          {status === 'connected' ? (
            <Badge className="bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/40">وصل</Badge>
          ) : status === 'connecting' ? (
            <Badge className="bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/40">در حال اتصال…</Badge>
          ) : (
            <Badge className="bg-zinc-800 text-zinc-400">قطع</Badge>
          )}
          {status === 'connected' ? (
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
                onClick={disconnect}
                className="h-8 border-red-900/60 bg-red-950/30 text-red-300 hover:bg-red-950/50"
              >
                <Unplug className="h-3.5 w-3.5" /> قطع
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              onClick={connect}
              disabled={status === 'connecting'}
              className="h-8 bg-emerald-600 font-bold text-white hover:bg-emerald-500"
            >
              <Zap className="h-3.5 w-3.5" /> وصل شو
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {notice ? (
          <p className="rounded-md border border-amber-900/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
            {notice}
          </p>
        ) : null}
        <div className="relative">
          <div
            ref={boxRef}
            dir="ltr"
            className="h-[420px] overflow-hidden rounded-lg border border-zinc-800 bg-[#09090b] p-2 md:h-[480px]"
          />
          {status !== 'connected' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-zinc-950/85 text-center">
              <TerminalIcon className="h-8 w-8 text-zinc-600" />
              <p className="max-w-xs text-xs leading-6 text-zinc-400">
                {status === 'connecting'
                  ? 'در حال اتصال به سرویس ترمینال…'
                  : 'دکمه «وصل شو» رو بزن تا یه شل کامل لینوکس باز بشه.'}
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
            disabled={status !== 'connected'}
            className="border-zinc-700 bg-zinc-950 text-left font-mono text-xs text-zinc-200 placeholder:text-zinc-600 focus-visible:ring-emerald-500/50"
          />
          <Button
            variant="outline"
            onClick={sendQuick}
            disabled={status !== 'connected' || !quickCmd.trim()}
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
          ⚠️ فقط یه جلسه همزمان باز میشه. هر دستوری که توی ترمینال بزنی ثبت
          میشه (audit). قبل از استفاده دستی از ابزارهای تلگرام (مثل
          <code dir="ltr" className="mx-1 text-zinc-400">send_dm.py</code>)
          حتماً واتچر رو pause کن تا سشن تداخل نکنه.
        </p>
      </CardContent>
    </Card>
  )
}
