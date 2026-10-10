/**
 * Private media serving — GET/HEAD /api/media/agent-videos/* and /api/media/agent-images/*
 *
 * next.config.ts rewrites /agent-videos/* and /agent-images/* here BEFORE the
 * public static handler, so raw media URLs are no longer world-readable.
 * Auth: ?k=<panel key> (the SAME sha256-hex key the panel sends as x-panel-key).
 * Deliberately does NOT touch the 5-fail counter (media tags can't send headers
 * and a missing param must never lock the owner out).
 * Supports HTTP Range so <video> seeking keeps working.
 */
import { createReadStream, statSync } from 'fs'
import { timingSafeEqual } from 'crypto'
import path from 'path'
import { Readable } from 'stream'
import { readPanelConfig } from '@/lib/panel-server'

export const dynamic = 'force-dynamic'

const ROOTS: Record<string, string> = {
  'agent-videos': '/home/z/my-project/public/agent-videos',
  'agent-images': '/home/z/my-project/public/agent-images',
}

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

function unauthorized(): Response {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' },
  })
}

function notFound(): Response {
  return new Response('Not found', { status: 404, headers: { 'X-Robots-Tag': 'noindex, nofollow' } })
}

export async function GET(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path: segs } = await ctx.params
  return serve(req, segs, true)
}

export async function HEAD(req: Request, ctx: { params: Promise<{ path: string[] }> }): Promise<Response> {
  const { path: segs } = await ctx.params
  return serve(req, segs, false)
}

async function serve(req: Request, segs: string[], withBody: boolean): Promise<Response> {
  // ---- auth: ?k= must equal the panel key hash (timing-safe, no fail counting)
  const k = (new URL(req.url).searchParams.get('k') ?? '').toLowerCase().trim()
  const want = readPanelConfig().sha256
  let ok = false
  if (want && /^[0-9a-f]{64}$/.test(k)) {
    try {
      ok = timingSafeEqual(Buffer.from(k, 'hex'), Buffer.from(want, 'hex'))
    } catch {
      ok = false
    }
  }
  if (!ok) return unauthorized()

  const root = ROOTS[segs[0]]
  if (!root) return notFound()
  const rel = segs.slice(1).join('/')
  // flat, safe filenames only (no traversal, no hidden files)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(rel) || rel.includes('..')) return notFound()
  const resolved = path.resolve(path.join(root, rel))
  if (!resolved.startsWith(`${path.resolve(root)}${path.sep}`)) return notFound()

  let st
  try {
    st = statSync(resolved)
    if (!st.isFile()) return notFound()
  } catch {
    return notFound()
  }

  const ext = path.extname(resolved).toLowerCase()
  const type = MIME[ext] ?? 'application/octet-stream'
  const baseHeaders: Record<string, string> = {
    'Content-Type': type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=600',
    'X-Robots-Tag': 'noindex, nofollow',
  }

  // ---- Range support (video seeking)
  const range = req.headers.get('range')
  if (range) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (m && (m[1] !== '' || m[2] !== '')) {
      let start = m[1] === '' ? 0 : parseInt(m[1], 10)
      let end = m[2] === '' ? st.size - 1 : parseInt(m[2], 10)
      if (m[1] === '') {
        // suffix range: last N bytes
        start = Math.max(0, st.size - parseInt(m[2], 10))
        end = st.size - 1
      }
      end = Math.min(end, st.size - 1)
      if (start > end || start >= st.size) {
        return new Response(null, {
          status: 416,
          headers: { ...baseHeaders, 'Content-Range': `bytes */${st.size}` },
        })
      }
      const len = end - start + 1
      const headers: Record<string, string> = {
        ...baseHeaders,
        'Content-Range': `bytes ${start}-${end}/${st.size}`,
        'Content-Length': String(len),
      }
      if (!withBody) return new Response(null, { status: 206, headers })
      const stream = Readable.toWeb(createReadStream(resolved, { start, end })) as unknown as ReadableStream<Uint8Array>
      return new Response(stream, { status: 206, headers })
    }
  }

  const headers: Record<string, string> = { ...baseHeaders, 'Content-Length': String(st.size) }
  if (!withBody) return new Response(null, { status: 200, headers })
  const stream = Readable.toWeb(createReadStream(resolved)) as unknown as ReadableStream<Uint8Array>
  return new Response(stream, { status: 200, headers })
}
