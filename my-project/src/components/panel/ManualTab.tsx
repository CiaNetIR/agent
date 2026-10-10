'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useToast } from '@/hooks/use-toast'
import { BookOpen, Download } from 'lucide-react'
import Markdown from 'react-markdown'
import { panelFetch } from '@/lib/panel'

export default function ManualTab() {
  const [md, setMd] = useState('')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const { toast } = useToast()

  useEffect(() => {
    ;(async () => {
      try {
        const res = await panelFetch('/api/panel/manual')
        const json = await res.json()
        if (res.ok && json.ok) setMd(json.markdown)
        else setErr(json.error || 'راهنما پیدا نشد')
      } catch {
        setErr('ارتباط برقرار نشد')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  function download() {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'Z-OWNER-MANUAL.md'
    a.click()
    URL.revokeObjectURL(url)
    toast({ title: 'راهنما دانلود شد' })
  }

  if (loading) {
    return <Skeleton className="h-96 w-full rounded-xl bg-zinc-800/60" />
  }
  if (err) {
    return (
      <Card className="border-amber-900/50 bg-amber-950/20">
        <CardContent className="p-4 text-sm text-amber-300">{err}</CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-zinc-800 bg-zinc-900/70">
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
          <BookOpen className="h-4 w-4 text-amber-400" /> راهنمای کامل مالک
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={download}
          className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
        >
          <Download className="h-3.5 w-3.5" /> دانلود
        </Button>
      </CardHeader>
      <CardContent>
        <div
          dir="rtl"
          className="max-h-[70vh] overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-950/60 p-5"
        >
          <div className="manual prose-sm max-w-none text-zinc-300 [&_code]:rounded [&_code]:bg-zinc-800 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-emerald-300 [&_code]:text-[12px] [&_h1]:mt-6 [&_h1]:mb-3 [&_h1]:text-lg [&_h1]:font-black [&_h1]:text-amber-400 [&_h2]:mt-6 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-emerald-400 [&_h3]:mt-4 [&_h3]:mb-2 [&_h3]:text-sm [&_h3]:font-bold [&_h3]:text-zinc-100 [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:pr-5 [&_p]:mt-2 [&_p]:leading-8 [&_pre]:mt-3 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-black [&_pre]:p-3 [&_pre]:text-[12px] [&_pre]:leading-6 [&_pre]:text-zinc-300 [&_strong]:text-zinc-100 [&_ul]:list-disc [&_ul]:pr-5 [&_pre]:[direction:ltr] [&_code]:[direction:ltr] [&_pre]:text-left">
            <Markdown>{md}</Markdown>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
