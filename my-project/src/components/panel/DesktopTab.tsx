'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { MonitorOff } from 'lucide-react'

/**
 * DesktopTab — noVNC was removed (heavy, unused). Shows a notice instead
 * of trying to embed a non-existent desktop iframe.
 */
export default function DesktopTab() {
  return (
    <div className="space-y-4">
      <Card className="border-[#2D3139] bg-[#181A1F]/70">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <MonitorOff className="h-4 w-4 text-zinc-500" /> دسکتاپ گرافیکی (غیرفعال)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-[12px] leading-6 text-zinc-400">
            سرویس دسکتاپ گرافیکی (noVNC) از این نسخه حذف شده — هم به دلیل مصرف بالای
            منابع و هم به دلیل اینکه استفاده نمی‌شد. اگه به محیط گرافیکی سرور نیاز
            داری، می‌تونی از SSH یا ترمینال تحت وب (تب «ترمینال») استفاده کنی.
          </p>
          <div className="rounded-lg border border-[#2D3139] bg-[#202329] p-3">
            <p className="text-[11px] text-zinc-500">
              💡 برای دسترسی گرافیکی به سرور، می‌تونی RDP یا VNC رو دستی نصب کنی.
              راهنمای نصب XFCE + x11vnc در فایل <code dir="ltr" className="text-emerald-400">OWNER-GUIDE.md</code> موجود هست.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
