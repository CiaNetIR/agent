import { NextRequest, NextResponse } from 'next/server'
import { appendFileSync, existsSync, mkdirSync, realpathSync } from 'fs'
import fsp from 'fs/promises'
import path from 'path'
import { verifyKey, isLocked } from '@/lib/panel-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Owner file-manager API — everything strictly inside /home/z (the cloud
 * sandbox home). No root, no system paths. All mutations audited.
 */

const ROOT = '/home/z'
const PANEL_DIR = '/home/z/my-project/.panel'
const AUDIT_LOG = path.join(PANEL_DIR, 'audit.log')
const MAX_TEXT = 512 * 1024 // 512KB text read/write
const MAX_EMBED = 2 * 1024 * 1024 // 2MB inline base64 (image preview)
const MAX_UPLOAD = 8 * 1024 * 1024 // 8MB upload

/** dirs whose whole SUBTREE is protected from delete (disaster safety) */
const PROTECTED_SUBTREES = [
  '/home/z/my-project/.secrets',
  '/home/z/my-project/tg-tools-backup',
  '/home/z/tg-tools',
]
/** exact paths protected from delete AND rename (the infra itself) */
const PROTECTED_EXACT = new Set([
  ROOT,
  '/home/z/my-project',
  ...PROTECTED_SUBTREES,
])

const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'json', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'py', 'sh', 'bash', 'zsh', 'env', 'example', 'yml', 'yaml', 'toml', 'ini',
  'cfg', 'conf', 'log', 'html', 'htm', 'css', 'scss', 'csv', 'sql', 'prisma',
  'lock', 'gitignore', 'dockerignore', 'xml', 'svg', 'service', 'target',
  'diff', 'patch', 'c', 'cpp', 'h', 'go', 'rs', 'java', 'rb', 'php', 'lua',
  'pl', 'vim', 'ps1', 'makefile', 'readme', 'license',
])
const NO_EXT_TEXT = new Set(['license', 'readme', 'makefile', 'dockerfile'])
const IMG_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
}

function audit(event: string, extra = '') {
  try {
    mkdirSync(PANEL_DIR, { recursive: true })
    appendFileSync(AUDIT_LOG, `${new Date().toISOString()} ${event} ${extra}\n`, 'utf8')
  } catch {
    /* never fail on audit */
  }
}

function extOf(p: string): string {
  const base = path.basename(p).toLowerCase()
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return base.slice(dot + 1)
}

function isTextPath(p: string): boolean {
  const base = path.basename(p).toLowerCase()
  return TEXT_EXTS.has(extOf(p)) || NO_EXT_TEXT.has(base)
}

/**
 * Validate + resolve a user-supplied path. Returns an absolute path inside
 * ROOT (symlink-escape checked), or null when invalid.
 */
function resolveSafe(input: unknown): string | null {
  if (typeof input !== 'string' || !input.trim()) return null
  const rel = input.trim()
  const abs = path.resolve(ROOT, rel.startsWith('/') ? rel : path.join(ROOT, rel))
  if (abs !== ROOT && !abs.startsWith(ROOT + '/')) return null
  // walk up to the nearest existing ancestor and make sure it doesn't
  // symlink outside ROOT
  let check = abs
  for (let i = 0; i < 64; i++) {
    try {
      const real = realpathSync(check)
      if (real !== ROOT && !real.startsWith(ROOT + '/')) return null
      return check === abs ? real : abs
    } catch {
      const parent = path.dirname(check)
      if (parent === check) return null
      check = parent
    }
  }
  return null
}

function isProtectedDelete(p: string): boolean {
  if (PROTECTED_EXACT.has(p)) return true
  return PROTECTED_SUBTREES.some((s) => p === s || p.startsWith(s + '/'))
}

function isProtectedRename(p: string): boolean {
  if (PROTECTED_EXACT.has(p)) return true
  // renaming a file OUT of a protected subtree (.secrets/, tg-tools/, …) used
  // to bypass the delete guard — the renamed copy could then be deleted freely
  return PROTECTED_SUBTREES.some((s) => p === s || p.startsWith(s + '/'))
}

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status })
}

/* ---------------------------------------------------------------- GET */

export async function GET(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (isLocked()) return jsonError('قفل موقت — کمی بعد دوباره وارد شو', 429)

  const url = req.nextUrl
  const mode = url.searchParams.get('mode') || 'list'
  const target = resolveSafe(url.searchParams.get('path') || ROOT)
  if (!target) return jsonError('مسیر نامعتبره', 400)

  let stat
  try {
    stat = await fsp.stat(target)
  } catch {
    return jsonError('مسیر پیدا نشد', 404)
  }

  /* ---------- dir listing ---------- */
  if (stat.isDirectory()) {
    if (mode !== 'list') return jsonError('این مسیر پوشه‌ست، فایل نیست', 400)
    let dirents
    try {
      dirents = await fsp.readdir(target, { withFileTypes: true })
    } catch (e) {
      return jsonError(`خواندن پوشه نشد: ${(e as Error).message}`, 403)
    }
    const entries = await Promise.all(
      dirents.map(async (d) => {
        let size = 0
        let mtime = ''
        try {
          const st = await fsp.stat(path.join(target, d.name))
          size = st.size
          mtime = st.mtime.toISOString()
        } catch {
          /* broken symlink etc. */
        }
        return {
          name: d.name,
          dir: d.isDirectory(),
          size,
          mtime,
        }
      })
    )
    entries.sort((a, b) => {
      if (a.dir !== b.dir) return a.dir ? -1 : 1
      return a.name.localeCompare(b.name, 'en', { numeric: true })
    })
    audit('list', target)
    return NextResponse.json({
      ok: true,
      path: target,
      parent: target === ROOT ? null : path.dirname(target),
      entries,
    })
  }

  /* ---------- single file ---------- */
  if (mode === 'download') {
    if (stat.size > 128 * 1024 * 1024) return jsonError('فایل برای دانلود خیلی بزرگه', 400)
    try {
      const buf = await fsp.readFile(target)
      const name = path.basename(target)
      const ext = extOf(target)
      const mime =
        IMG_MIME[ext] ||
        (isTextPath(target) ? 'text/plain; charset=utf-8' : 'application/octet-stream')
      return new NextResponse(new Uint8Array(buf), {
        headers: {
          'content-type': mime,
          'content-length': String(buf.length),
          'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
          'cache-control': 'no-store',
        },
      })
    } catch (e) {
      return jsonError(`خواندن فایل نشد: ${(e as Error).message}`, 500)
    }
  }

  /* mode=read → metadata (+ inline text or base64 preview) */
  const ext = extOf(target)
  const payload: Record<string, unknown> = {
    ok: true,
    path: target,
    name: path.basename(target),
    size: stat.size,
    mtime: stat.mtime.toISOString(),
    isText: false,
    isImage: false,
    mime: IMG_MIME[ext] || 'application/octet-stream',
  }
  if (isTextPath(target) && stat.size <= MAX_TEXT) {
    try {
      payload.isText = true
      payload.text = await fsp.readFile(target, 'utf8')
    } catch (e) {
      payload.readError = (e as Error).message
    }
  } else if (IMG_MIME[ext] && stat.size <= MAX_EMBED) {
    try {
      payload.isImage = true
      payload.base64 = (await fsp.readFile(target)).toString('base64')
    } catch (e) {
      payload.readError = (e as Error).message
    }
  } else if (isTextPath(target)) {
    payload.textTooLarge = true
  }
  audit('read', target)
  return NextResponse.json(payload)
}

/* ---------------------------------------------------------------- POST */

interface Body {
  action?: string
  path?: string
  from?: string
  to?: string
  dir?: string
  name?: string
  content?: string
  base64?: string
}

export async function POST(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }
  if (isLocked()) return jsonError('قفل موقت — کمی بعد دوباره وارد شو', 429)

  let body: Body
  try {
    body = (await req.json()) as Body
  } catch {
    return jsonError('بدنه نامعتبر', 400)
  }

  try {
    switch (body.action) {
      /* ---------------- new folder ---------------- */
      case 'mkdir': {
        const target = resolveSafe(body.path)
        if (!target || target === ROOT) return jsonError('مسیر نامعتبره')
        if (existsSync(target)) return jsonError('این اسم از قبل هست')
        await fsp.mkdir(target, { recursive: false })
        audit('mkdir', target)
        return NextResponse.json({ ok: true, path: target })
      }

      /* ---------------- new file ---------------- */
      case 'newfile': {
        const target = resolveSafe(body.path)
        if (!target || target === ROOT) return jsonError('مسیر نامعتبره')
        if (existsSync(target)) return jsonError('این فایل از قبل هست')
        const content = typeof body.content === 'string' ? body.content : ''
        if (content.length > MAX_TEXT) return jsonError('محتوا خیلی بزرگه (حداکثر ۵۱۲KB)')
        await fsp.writeFile(target, content, 'utf8')
        audit('newfile', target)
        return NextResponse.json({ ok: true, path: target })
      }

      /* ---------------- save file ---------------- */
      case 'write': {
        const target = resolveSafe(body.path)
        if (!target || target === ROOT) return jsonError('مسیر نامعتبره')
        if (typeof body.content !== 'string') return jsonError('محتوا لازمه')
        if (body.content.length > MAX_TEXT) return jsonError('محتوا خیلی بزرگه (حداکثر ۵۱۲KB)')
        const st = await fsp.stat(target).catch(() => null)
        if (!st || !st.isFile()) return jsonError('فایل مقصد پیدا نشد', 404)
        await fsp.writeFile(target, body.content, 'utf8')
        audit('write', `${target} (${body.content.length}B)`)
        return NextResponse.json({ ok: true, path: target })
      }

      /* ---------------- rename / move ---------------- */
      case 'rename': {
        const from = resolveSafe(body.from)
        if (!from) return jsonError('مسیر مبدأ نامعتبره')
        if (!existsSync(from)) return jsonError('مبدأ پیدا نشد', 404)
        if (isProtectedRename(from)) return jsonError('مسیرهای حیاتی قابل تغییر اسم نیستن')
        let to: string | null
        const rawTo = String(body.to || '').trim()
        if (!rawTo) return jsonError('اسم جدید لازمه')
        if (rawTo.includes('/')) {
          to = resolveSafe(rawTo)
        } else {
          to = resolveSafe(path.join(path.dirname(from), rawTo))
        }
        if (!to) return jsonError('مقصد نامعتبره')
        if (to === from) return jsonError('اسم جدید همون اسم قبلیه')
        if (existsSync(to)) return jsonError('با این اسم از قبل چیزی هست')
        await fsp.rename(from, to)
        audit('rename', `${from} -> ${to}`)
        return NextResponse.json({ ok: true, path: to })
      }

      /* ---------------- delete ---------------- */
      case 'delete': {
        const target = resolveSafe(body.path)
        if (!target || target === ROOT) return jsonError('مسیر نامعتبره')
        if (!existsSync(target)) return jsonError('پیدا نشد', 404)
        if (isProtectedDelete(target)) {
          return jsonError(
            'این مسیر حیاتیه (پروژه، سِکرت‌ها، بکاپ‌ها یا دستیار) و از پنل قابل حذف نیست. اگه واقعاً لازمه، از ترمینال با دقت انجامش بده.',
            403
          )
        }
        await fsp.rm(target, { recursive: true, force: true })
        audit('DELETE', target)
        return NextResponse.json({ ok: true })
      }

      /* ---------------- upload ---------------- */
      case 'upload': {
        const dir = resolveSafe(body.dir)
        const name = String(body.name || '').trim()
        if (!dir) return jsonError('پوشه مقصد نامعتبره')
        const dirStat = await fsp.stat(dir).catch(() => null)
        if (!dirStat || !dirStat.isDirectory()) return jsonError('پوشه مقصد پیدا نشد', 404)
        if (!name || name.includes('/') || name === '.' || name === '..' || name.length > 255) {
          return jsonError('نام فایل نامعتبره')
        }
        const b64 = String(body.base64 || '').replace(/\s+/g, '')
        if (!b64) return jsonError('محتوای فایل خالیه')
        if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return jsonError('محتوا خرابه (base64 نیست)')
        const buf = Buffer.from(b64, 'base64')
        if (!buf.length) return jsonError('فایل خالیه')
        if (buf.length > MAX_UPLOAD) return jsonError('حجم بیشتر از ۸ مگابایت مجاز نیست')
        const target = path.join(dir, name)
        if (!resolveSafe(target)) return jsonError('مقصد نامعتبره')
        await fsp.writeFile(target, buf)
        audit('upload', `${target} (${buf.length}B)`)
        return NextResponse.json({ ok: true, path: target })
      }

      default:
        return jsonError('عملیات ناشناخته', 400)
    }
  } catch (e) {
    const msg = (e as Error).message || 'خطای ناشناخته'
    audit('error', `${body.action || '?'} :: ${msg}`)
    return jsonError(msg, 500)
  }
}
