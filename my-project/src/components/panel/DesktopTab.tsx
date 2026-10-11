'use client'

import { useCallback, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ExternalLink, Monitor, RefreshCw } from 'lucide-react'

/** noVNC web UI — the gateway routes this exact query param to port 6080 */
const DESKTOP_URL = '/?XTransformPort=6080'

export default function DesktopTab() {
  // bumping the key re-mounts the iframe → clean reload of the noVNC client
  const [frameKey, setFrameKey] = useState(0)

  const openInNewTab = useCallback(() => {
    window.open(DESKTOP_URL, '_blank', 'noopener')
  }, [])

  const reloadFrame = useCallback(() => {
    setFrameKey((k) => k + 1)
  }, [])

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-zinc-900/70">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <Monitor className="h-4 w-4 text-emerald-400" /> دسکتاپ گرافیکی سرور — XFCE از
            طریق مرورگر
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={openInNewTab}
              className="h-8 bg-emerald-600 text-xs font-bold text-white hover:bg-emerald-500"
            >
              <ExternalLink className="h-3.5 w-3.5" /> در تب جدید باز کن
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={reloadFrame}
              className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
            >
              <RefreshCw className="h-3.5 w-3.5" /> رفرش
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[11px] leading-5 text-zinc-500">
            رمز VNC توی فایل .secrets/vnc.env سرور ذخیره شده. اگه صفحه بسته بود از دکمه رفرش
            یا ری‌استارت توی تب سرویس‌ها استفاده کن.
          </p>
          <div className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
            <iframe
              key={frameKey}
              src={DESKTOP_URL}
              title="دسکتاپ سرور"
              aria-label="دسکتاپ گرافیکی سرور (noVNC)"
              className="h-[65vh] w-full border-0 bg-zinc-950 sm:h-[70vh]"
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
