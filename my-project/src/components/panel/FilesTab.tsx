'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  FolderOpen,
  FileText,
  File as FileIcon,
  Image as ImageIcon,
  FilePlus2,
  FolderPlus,
  Download,
  Home,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Upload,
} from 'lucide-react'
import { panelFetch } from '@/lib/panel'
import { useToast } from '@/hooks/use-toast'

const ROOT = '/home/z'

interface FileEntry {
  name: string
  dir: boolean
  size: number
  mtime: string
}

interface FileRead {
  ok: boolean
  path: string
  name: string
  size: number
  mtime: string
  isText: boolean
  isImage: boolean
  text?: string
  base64?: string
  mime?: string
  textTooLarge?: boolean
  readError?: string
}

function fmtBytes(n: number): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function fmtTime(iso: string): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('fa-IR', { dateStyle: 'short', timeStyle: 'short' })
  } catch {
    return iso
  }
}

const SCROLLBAR =
  'max-h-[440px] overflow-y-auto [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-track]:bg-transparent'

export default function FilesTab() {
  const { toast } = useToast()
  const [cwd, setCwd] = useState(ROOT)
  const [parent, setParent] = useState<string | null>(null)
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)

  /* viewer / editor */
  const [viewer, setViewer] = useState<{
    open: boolean
    loading: boolean
    data: FileRead | null
    draft: string
    saving: boolean
  }>({ open: false, loading: false, data: null, draft: '', saving: false })

  /* new item dialog */
  const [newItem, setNewItem] = useState<{
    open: boolean
    mode: 'folder' | 'file'
    name: string
    busy: boolean
  }>({ open: false, mode: 'folder', name: '', busy: false })

  /* rename dialog */
  const [renameState, setRenameState] = useState<{
    open: boolean
    path: string
    name: string
    busy: boolean
  }>({ open: false, path: '', name: '', busy: false })

  /* delete confirm */
  const [deleteState, setDeleteState] = useState<{
    open: boolean
    path: string
    name: string
    isDir: boolean
    busy: boolean
  }>({ open: false, path: '', name: '', isDir: false, busy: false })

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadDir = useCallback(
    async (p: string, showLoading = true) => {
      if (showLoading) setLoading(true)
      try {
        const res = await panelFetch(`/api/panel/files?path=${encodeURIComponent(p)}`)
        const json = await res.json()
        if (!res.ok || !json.ok) {
          toast({ title: 'خطا', description: json.error || 'خواندن پوشه نشد', variant: 'destructive' })
          setErr(json.error || 'خواندن پوشه نشد')
          return
        }
        setErr(null)
        setCwd(json.path)
        setParent(json.parent)
        setEntries(json.entries || [])
      } catch {
        toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
        setErr('ارتباط برقرار نشد')
      } finally {
        if (showLoading) setLoading(false)
      }
    },
    [toast]
  )

  useEffect(() => {
    void loadDir(ROOT)
  }, [loadDir])

  /* ---------------- actions ---------------- */

  async function openFile(p: string) {
    setViewer({ open: true, loading: true, data: null, draft: '', saving: false })
    try {
      const res = await panelFetch(
        `/api/panel/files?mode=read&path=${encodeURIComponent(p)}`
      )
      const json = (await res.json()) as FileRead & { error?: string }
      if (!res.ok || !json.ok) {
        toast({ title: 'خطا', description: json.error || 'فایل باز نشد', variant: 'destructive' })
        setViewer((v) => ({ ...v, open: false }))
        return
      }
      setViewer({ open: true, loading: false, data: json, draft: json.text || '', saving: false })
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
      setViewer((v) => ({ ...v, open: false }))
    }
  }

  async function saveFile() {
    const d = viewer.data
    if (!d) return
    setViewer((v) => ({ ...v, saving: true }))
    try {
      const res = await panelFetch('/api/panel/files', {
        method: 'POST',
        body: JSON.stringify({ action: 'write', path: d.path, content: viewer.draft }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        toast({ title: 'ذخیره نشد', description: json.error, variant: 'destructive' })
      } else {
        toast({ title: 'ذخیره شد ✓', description: d.name })
        setViewer((v) => ({ ...v, data: { ...d, text: v.draft, size: v.draft.length } }))
        void loadDir(cwd, false)
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setViewer((v) => ({ ...v, saving: false }))
    }
  }

  async function downloadFile(p: string, name: string) {
    setBusyPath(p)
    try {
      const res = await panelFetch(
        `/api/panel/files?mode=download&path=${encodeURIComponent(p)}`
      )
      if (!res.ok) {
        toast({ title: 'دانلود نشد', variant: 'destructive' })
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setBusyPath(null)
    }
  }

  async function createItem() {
    const name = newItem.name.trim()
    if (!name) return
    setNewItem((s) => ({ ...s, busy: true }))
    try {
      const full = `${cwd}/${name}`
      const res = await panelFetch('/api/panel/files', {
        method: 'POST',
        body: JSON.stringify({
          action: newItem.mode === 'folder' ? 'mkdir' : 'newfile',
          path: full,
        }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        toast({ title: 'ساخته نشد', description: json.error, variant: 'destructive' })
      } else {
        toast({ title: 'ساخته شد ✓', description: name })
        setNewItem({ open: false, mode: 'folder', name: '', busy: false })
        void loadDir(cwd, false)
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setNewItem((s) => ({ ...s, busy: false }))
    }
  }

  async function doRename() {
    const name = renameState.name.trim()
    if (!name) return
    setRenameState((s) => ({ ...s, busy: true }))
    try {
      const res = await panelFetch('/api/panel/files', {
        method: 'POST',
        body: JSON.stringify({ action: 'rename', from: renameState.path, to: name }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        toast({ title: 'تغییر اسم نشد', description: json.error, variant: 'destructive' })
      } else {
        toast({ title: 'اسم عوض شد ✓', description: name })
        setRenameState({ open: false, path: '', name: '', busy: false })
        void loadDir(cwd, false)
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setRenameState((s) => ({ ...s, busy: false }))
    }
  }

  async function doDelete() {
    setDeleteState((s) => ({ ...s, busy: true }))
    try {
      const res = await panelFetch('/api/panel/files', {
        method: 'POST',
        body: JSON.stringify({ action: 'delete', path: deleteState.path }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        toast({ title: 'حذف نشد', description: json.error, variant: 'destructive' })
      } else {
        toast({ title: 'حذف شد', description: deleteState.name })
        setDeleteState({ open: false, path: '', name: '', isDir: false, busy: false })
        void loadDir(cwd, false)
      }
    } catch {
      toast({ title: 'ارتباط برقرار نشد', variant: 'destructive' })
    } finally {
      setDeleteState((s) => ({ ...s, busy: false }))
    }
  }

  async function handleUpload(files: FileList | null) {
    if (!files || !files.length) return
    const list = Array.from(files)
    setUploading({ done: 0, total: list.length })
    let okCount = 0
    let lastErr = ''
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      try {
        const b64 = await new Promise<string>((resolve, reject) => {
          const r = new FileReader()
          r.onload = () => resolve(String(r.result || '').split(',')[1] || '')
          r.onerror = () => reject(new Error('read fail'))
          r.readAsDataURL(f)
        })
        const res = await panelFetch('/api/panel/files', {
          method: 'POST',
          body: JSON.stringify({ action: 'upload', dir: cwd, name: f.name, base64: b64 }),
        })
        const json = await res.json()
        if (res.ok && json.ok) okCount += 1
        else lastErr = json.error || ''
      } catch {
        lastErr = 'ارتباط قطع شد'
      }
      setUploading({ done: i + 1, total: list.length })
    }
    setUploading(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (okCount) toast({ title: 'آپلود شد ✓', description: `${okCount} از ${list.length} فایل` })
    if (okCount < list.length) {
      toast({ title: 'بعضی فایل‌ها آپلود نشدن', description: lastErr, variant: 'destructive' })
    }
    void loadDir(cwd, false)
  }

  /* ---------------- breadcrumb ---------------- */

  const crumbs: { label: string; path: string }[] = [{ label: 'خانه z', path: ROOT }]
  if (cwd !== ROOT) {
    const parts = cwd.slice(ROOT.length).split('/').filter(Boolean)
    parts.forEach((part, i) => {
      crumbs.push({ label: part, path: `${ROOT}/${parts.slice(0, i + 1).join('/')}` })
    })
  }

  /* ---------------- render ---------------- */

  return (
    <Card className="border-zinc-800 bg-zinc-900/70">
      <CardHeader className="space-y-3 pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-sm font-bold text-zinc-200">
            <FolderOpen className="h-4 w-4 text-emerald-400" /> مدیریت فایل‌ها
          </CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNewItem({ open: true, mode: 'folder', name: '', busy: false })}
              className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
            >
              <FolderPlus className="h-3.5 w-3.5" /> پوشه جدید
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setNewItem({ open: true, mode: 'file', name: '', busy: false })}
              className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
            >
              <FilePlus2 className="h-3.5 w-3.5" /> فایل جدید
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={!!uploading}
              className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
            >
              <Upload className="h-3.5 w-3.5" />
              {uploading ? `${uploading.done}/${uploading.total}` : 'آپلود'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadDir(cwd)}
              className="h-8 border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-800"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /> رفرش
            </Button>
          </div>
        </div>
        {/* breadcrumb */}
        <div className="flex items-center gap-1 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-xs">
          <Home className="h-3.5 w-3.5 shrink-0 text-amber-400" />
          {crumbs.map((c, i) => (
            <span key={c.path} className="flex shrink-0 items-center gap-1">
              {i > 0 && <span className="text-zinc-600">/</span>}
              <button
                type="button"
                onClick={() => void loadDir(c.path)}
                className={`font-mono transition-colors hover:text-emerald-400 ${
                  i === crumbs.length - 1 ? 'font-bold text-emerald-400' : 'text-zinc-300'
                }`}
                dir="ltr"
              >
                {c.label}
              </button>
            </span>
          ))}
          <span className="ms-auto shrink-0 pe-1 text-[10px] text-zinc-600">
            {entries.length} مورد
          </span>
        </div>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
          </div>
        ) : err ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
            <TriangleAlert className="h-8 w-8 text-amber-400" />
            <p className="text-xs text-amber-300">{err}</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadDir(cwd)}
              className="h-8 border-amber-800/60 bg-amber-950/40 text-amber-300 hover:bg-amber-950/60"
            >
              <RefreshCw className="h-3.5 w-3.5" /> تلاش دوباره
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-center">
            <FolderOpen className="h-8 w-8 text-zinc-700" />
            <p className="text-xs text-zinc-500">این پوشه خالیه — یه چیزی بساز یا آپلود کن.</p>
          </div>
        ) : (
          <div className={SCROLLBAR}>
            <ul className="divide-y divide-zinc-800/70">
              {entries.map((e) => {
                const full = `${cwd}/${e.name}`
                const busy = busyPath === full
                return (
                  <li
                    key={e.name}
                    className="group flex items-center gap-2 py-2 pe-1 transition-colors hover:bg-zinc-800/40"
                  >
                    <button
                      type="button"
                      onClick={() => (e.dir ? void loadDir(full) : void openFile(full))}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-start"
                    >
                      {e.dir ? (
                        <FolderOpen className="h-4 w-4 shrink-0 text-amber-400" />
                      ) : (
                        <FileIcon className="h-4 w-4 shrink-0 text-zinc-500" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span
                          dir="ltr"
                          className={`block truncate font-mono text-xs ${
                            e.dir ? 'font-bold text-zinc-100' : 'text-zinc-300'
                          }`}
                        >
                          {e.name}
                        </span>
                        <span className="block text-[10px] text-zinc-600">
                          {e.dir ? 'پوشه' : fmtBytes(e.size)} · {fmtTime(e.mtime)}
                        </span>
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-0.5 opacity-70 transition-opacity group-hover:opacity-100">
                      {!e.dir && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-zinc-400 hover:bg-zinc-800 hover:text-emerald-300"
                          onClick={() => void downloadFile(full, e.name)}
                          title="دانلود"
                        >
                          <Download className="h-3.5 w-3.5" />
                          <span className="sr-only">دانلود {e.name}</span>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-zinc-400 hover:bg-zinc-800 hover:text-amber-300"
                        onClick={() =>
                          setRenameState({ open: true, path: full, name: e.name, busy: false })
                        }
                        title="تغییر اسم"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                        <span className="sr-only">تغییر اسم {e.name}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-zinc-400 hover:bg-zinc-800 hover:text-red-300"
                        onClick={() =>
                          setDeleteState({
                            open: true,
                            path: full,
                            name: e.name,
                            isDir: e.dir,
                            busy: false,
                          })
                        }
                        title="حذف"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span className="sr-only">حذف {e.name}</span>
                      </Button>
                    </div>
                    {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-400" /> : null}
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        <p className="mt-3 text-[11px] leading-5 text-zinc-500">
          ℹ️ همه فایل‌های محیط ابری (خونه <code dir="ltr" className="text-zinc-400">z</code>).
          فایل متنی رو که باز کنی می‌تونی همون‌جا ویرایش و ذخیره کنی؛ مسیرهای حیاتی
          (پروژه، سِکرت‌ها، بکاپ‌ها، دستیار) از حذف‌شدن محافظت می‌شن.
        </p>
      </CardContent>

      {/* hidden upload input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => void handleUpload(e.target.files)}
      />

      {/* ---------- file viewer / editor ---------- */}
      <Dialog
        open={viewer.open}
        onOpenChange={(o) => setViewer((v) => ({ ...v, open: o }))}
      >
        <DialogContent dir="rtl" className="max-w-2xl border-zinc-800 bg-zinc-950 sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2 text-sm">
              <FileText className="h-4 w-4 text-emerald-400" />
              <span dir="ltr" className="font-mono">
                {viewer.data?.name || '…'}
              </span>
              {viewer.data ? (
                <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-400">
                  {fmtBytes(viewer.data.size)}
                </Badge>
              ) : null}
            </DialogTitle>
          </DialogHeader>
          {viewer.loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
            </div>
          ) : viewer.data?.readError ? (
            <p className="text-xs text-red-300">{viewer.data.readError}</p>
          ) : viewer.data?.isImage ? (
            <img
              src={`data:${viewer.data.mime || 'image/png'};base64,${viewer.data.base64}`}
              alt={viewer.data.name}
              className="mx-auto max-h-[420px] rounded-md border border-zinc-800 object-contain"
            />
          ) : viewer.data?.isText ? (
            <Textarea
              dir="ltr"
              value={viewer.draft}
              onChange={(e) => setViewer((v) => ({ ...v, draft: e.target.value }))}
              className="h-72 resize-none border-zinc-800 bg-zinc-900 font-mono text-xs text-zinc-200 focus-visible:ring-emerald-500/50"
              spellCheck={false}
            />
          ) : viewer.data?.textTooLarge ? (
            <p className="text-xs text-amber-300">
              این فایل متنی بزرگ‌تر از ۵۱۲ کیلوبایته — فقط دانلودش کن یا از ترمینال ویرایشش کن.
            </p>
          ) : /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(viewer.data?.name || '') ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <ImageIcon className="h-8 w-8 text-zinc-600" />
              <p className="text-xs text-amber-300">
                این تصویر بزرگ‌تر از ۲ مگابایته و پیش‌نمایش باز نمی‌شه — دانلودش کن.
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <FileIcon className="h-8 w-8 text-zinc-600" />
              <p className="text-xs text-zinc-500">
                پیش‌نمایش این نوع فایل نیست — می‌تونی دانلودش کنی.
              </p>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => viewer.data && void downloadFile(viewer.data.path, viewer.data.name)}
              className="border-zinc-700 bg-zinc-950 text-zinc-200 hover:bg-zinc-800"
            >
              <Download className="h-3.5 w-3.5" /> دانلود
            </Button>
            {viewer.data?.isText ? (
              <Button
                size="sm"
                onClick={() => void saveFile()}
                disabled={viewer.saving}
                className="bg-emerald-600 font-bold text-white hover:bg-emerald-500"
              >
                {viewer.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                ذخیره
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- new item ---------- */}
      <Dialog open={newItem.open} onOpenChange={(o) => setNewItem((s) => ({ ...s, open: o }))}>
        <DialogContent dir="rtl" className="max-w-sm border-zinc-800 bg-zinc-950">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {newItem.mode === 'folder' ? 'پوشه جدید' : 'فایل جدید'}
            </DialogTitle>
          </DialogHeader>
          <Input
            dir="ltr"
            autoFocus
            value={newItem.name}
            onChange={(e) => setNewItem((s) => ({ ...s, name: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && !newItem.busy && void createItem()}
            placeholder="new-folder"
            className="border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-200 focus-visible:ring-emerald-500/50"
          />
          <DialogFooter>
            <Button
              size="sm"
              onClick={() => void createItem()}
              disabled={newItem.busy || !newItem.name.trim()}
              className="bg-emerald-600 font-bold text-white hover:bg-emerald-500"
            >
              {newItem.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              بساز
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- rename ---------- */}
      <Dialog
        open={renameState.open}
        onOpenChange={(o) => setRenameState((s) => ({ ...s, open: o }))}
      >
        <DialogContent dir="rtl" className="max-w-sm border-zinc-800 bg-zinc-950">
          <DialogHeader>
            <DialogTitle className="text-sm">تغییر اسم</DialogTitle>
          </DialogHeader>
          <Input
            dir="ltr"
            autoFocus
            value={renameState.name}
            onChange={(e) => setRenameState((s) => ({ ...s, name: e.target.value }))}
            onKeyDown={(e) => e.key === 'Enter' && !renameState.busy && void doRename()}
            className="border-zinc-700 bg-zinc-900 font-mono text-xs text-zinc-200 focus-visible:ring-emerald-500/50"
          />
          <DialogFooter>
            <Button
              size="sm"
              onClick={() => void doRename()}
              disabled={renameState.busy || !renameState.name.trim()}
              className="bg-amber-500 font-bold text-zinc-950 hover:bg-amber-400"
            >
              {renameState.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              عوضش کن
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ---------- delete confirm ---------- */}
      <AlertDialog
        open={deleteState.open}
        onOpenChange={(o) => setDeleteState((s) => ({ ...s, open: o }))}
      >
        <AlertDialogContent dir="rtl" className="border-zinc-800 bg-zinc-950">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm">
              {deleteState.isDir ? 'کل پوشه حذف بشه؟' : 'فایل حذف بشه؟'}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs leading-6">
              <span dir="ltr" className="block truncate font-mono text-red-300">
                {deleteState.name}
              </span>
              {deleteState.isDir
                ? 'همه‌ی محتوای داخلش هم حذف میشه و برگشت‌پذیر نیست!'
                : 'این کار برگشت‌پذیر نیست!'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800">
              بی‌خیال
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteState.busy}
              onClick={(e) => {
                e.preventDefault()
                void doDelete()
              }}
              className="bg-red-600 text-xs font-bold text-white hover:bg-red-500"
            >
              {deleteState.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              حذف کن
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
