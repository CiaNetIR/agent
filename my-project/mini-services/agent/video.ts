/**
 * Z agent core — video generation engine («ویدیو:» chat command).
 *
 * The provider's video API only generates 5- or 10-second clips. The owner
 * asked for ANY duration (1 second → several minutes) at the best quality,
 * so this engine:
 *   1. parses the requested duration + options (quality / fps / audio /
 *      orientation) from the chat command,
 *   2. plans the clip list (N×10s + one partial, trimmed with ffmpeg),
 *   3. runs each clip as an async provider task (poll every 6 s),
 *   4. downloads + normalizes every clip (h264 + faststart, exact trim),
 *   5. stitches everything with ffmpeg concat (‑c copy, re-encode fallback),
 *   6. updates the AgentVideo row AND the placeholder chat message
 *      (progress → final video) so the panel can poll and render it.
 *
 * Jobs run fully in the background: the chat stays usable while a video
 * generates (minutes for quality mode, longer for multi-clip films).
 * Cancellation: deleting/clearing the placeholder message marks the job
 * cancelled — the loop aborts before the next clip.
 */
import { spawn } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { readdirSync } from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import { db, PROJECT_DIR } from './lib'
import { llmVideoCreate, llmVideoQuery, promptBridge, llmCooldownActive, type VideoGenOpts } from './llm'

export const VIDEOS_PUBLIC_DIR = path.join(PROJECT_DIR, 'public', 'agent-videos')
const VIDEO_TMP_ROOT = '/home/z/agent-files/video-tmp'

/** max 2 videos generating at once — the owner can queue the rest later */
const MAX_CONCURRENT = 2

/* ---------------- spec parsing ---------------- */

export interface VideoSpec {
  prompt: string
  durationSec: number
  quality: 'speed' | 'quality'
  size: '1920x1080' | '1080x1920'
  fps: 30 | 60
  withAudio: boolean
}

function faDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
}

/**
 * Parse «ویدیو: <prompt> | 30 ثانیه | کیفیت: سرعت | عمودی | صدا | فریم ۶۰»
 * Options are separated with «|» (also accepts «؛»/«--»). Duration accepts:
 *   12 / 12s / 12 ثانیه / ۲ دقیقه / 1:30 / 90 sec — clamped to 1..1800 s.
 */
export function parseVideoSpec(raw: string): { ok: true; spec: VideoSpec } | { ok: false; error: string } {
  const parts = faDigits(raw)
    .split(/\s*[|؛]\s*|\s--/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (!parts.length || parts[0].length < 2) return { ok: false, error: 'توضیح فیلم خیلی کوتاهه — یکم بیشتر توضیح بده' }

  const spec: VideoSpec = {
    prompt: parts[0].trim(),
    durationSec: 10,
    quality: 'quality',
    size: '1920x1080',
    fps: 30,
    withAudio: false,
  }

  for (const opt of parts.slice(1)) {
    const o = opt.toLowerCase()
    // duration: bare number / Ns / N ثانیه / N دقیقه / m:ss
    let m = o.match(/^(\d+):(\d{1,2})$/)
    if (m) {
      spec.durationSec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
      continue
    }
    m = o.match(/^(\d+)\s*(ثانیه|سانیه|s|sec|secs|seconds)?$/) 
    if (m && !/دقیقه/.test(o)) {
      spec.durationSec = parseInt(m[1], 10)
      continue
    }
    m = o.match(/^(\d+)\s*(دقیقه|مین|min|m(?!s))$/)
    if (m) {
      spec.durationSec = parseInt(m[1], 10) * 60
      continue
    }
    if (/کیفیت\s*[:=]?\s*(سرعت|سریع)|^سرعت$|^سریع$|speed/.test(o)) { spec.quality = 'speed'; continue }
    if (/کیفیت\s*[:=]?\s*(بالا|خوب|عالی)|^کیفیت$|quality/.test(o)) { spec.quality = 'quality'; continue }
    if (/عمودی|ایستاده|portrait|vertical|9:16/.test(o)) { spec.size = '1080x1920'; continue }
    if (/افقی|خوابیده|landscape|horizontal|16:9/.test(o)) { spec.size = '1920x1080'; continue }
    if (/با\s*صدا|^صدا$|audio|sound| snd$/.test(o)) { spec.withAudio = true; continue }
    if (/فریم\s*۶?\s*0?60|60\s*fps|fps\s*60/.test(o)) { spec.fps = 60; continue }
    // unknown option → treat everything before a known keyword as prompt continuation
    spec.prompt += ` ${opt}`
  }

  if (!Number.isFinite(spec.durationSec) || spec.durationSec < 1) spec.durationSec = 1
  if (spec.durationSec > 1800) spec.durationSec = 1800
  spec.prompt = spec.prompt.trim().slice(0, 900)
  if (spec.prompt.length < 2) return { ok: false, error: 'توضیح فیلم خالیه' }
  return { ok: true, spec }
}

/* ---------------- ffmpeg helpers ---------------- */

function sh(cmd: string, args: string[], timeoutMs = 180_000): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const t = setTimeout(() => {
      p.kill('SIGKILL')
      resolve({ code: -1, out: `${out}\n(timeout)` })
    }, timeoutMs)
    p.stdout.on('data', (c) => { out += String(c) })
    p.stderr.on('data', (c) => { out += String(c) })
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out: `${out}\n${e.message}` }) })
    p.on('close', (code) => { clearTimeout(t); resolve({ code: code ?? -1, out }) })
  })
}

async function downloadTo(url: string, dest: string): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) })
  if (!res.ok) throw new Error(`دانلود کلیپ ناموفق بود (HTTP ${res.status})`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 10_000) throw new Error('کلیپ دانلودشده خالی/خراب بود')
  writeFileSync(dest, buf)
}

/** normalize one clip: h264 + faststart (uniform params → safe concat), trim to exact seconds */
async function normalizeClip(src: string, dest: string, trimSec: number | undefined, withAudio: boolean): Promise<void> {
  const args = ['-y', '-i', src]
  if (trimSec && trimSec > 0) args.push('-t', String(trimSec))
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p')
  // keep the AI-generated sound when asked for; otherwise drop the (silent) track
  if (withAudio) args.push('-c:a', 'aac', '-b:a', '128k')
  else args.push('-an')
  args.push('-movflags', '+faststart', dest)
  const r = await sh('ffmpeg', args)
  if (r.code !== 0) throw new Error(`ffmpeg نتوانست کلیپ را نرمال کند: ${r.out.slice(-160)}`)
}

/** stitch normalized clips → one mp4 (concat demuxer, copy; re-encode fallback) */
async function stitchClips(clipPaths: string[], dest: string): Promise<void> {
  if (clipPaths.length === 1) {
    // single clip — already normalized at the exact duration
    writeFileSync(dest, await (await import('fs')).promises.readFile(clipPaths[0]))
    return
  }
  const listFile = `${dest}.txt`
  writeFileSync(listFile, clipPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8')
  let r = await sh('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', dest])
  if (r.code !== 0) {
    // fallback: full re-encode of the concat (slower, always works)
    r = await sh('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', dest], 600_000)
  }
  try { rmSync(listFile, { force: true }) } catch { /* fine */ }
  if (r.code !== 0) throw new Error(`ffmpeg نتوانست کلیپ‌ها را به هم بچسباند: ${r.out.slice(-160)}`)
}

/* ---------------- clip planning ---------------- */

interface ClipPlan { genDur: 5 | 10; trimSec: number }

export function planClips(durationSec: number): ClipPlan[] {
  const clips: ClipPlan[] = []
  let remaining = Math.max(1, Math.round(durationSec))
  if (remaining <= 5) return [{ genDur: 5, trimSec: remaining }]
  if (remaining <= 10) return [{ genDur: 10, trimSec: remaining }]
  while (remaining > 10) {
    clips.push({ genDur: 10, trimSec: 10 })
    remaining -= 10
  }
  if (remaining > 0) clips.push({ genDur: remaining <= 5 ? 5 : 10, trimSec: remaining })
  return clips
}

/* ---------------- chat message helpers ---------------- */

async function msgMetaUpdate(chatMsgId: string, metaPatch: Record<string, unknown>): Promise<void> {
  const row = await db.chatMessage.findUnique({ where: { id: chatMsgId } })
  if (!row) return
  let meta: Record<string, unknown> = {}
  try { meta = JSON.parse(row.meta || '{}') as Record<string, unknown> } catch { meta = {} }
  await db.chatMessage.update({
    where: { id: chatMsgId },
    data: { meta: JSON.stringify({ ...meta, ...metaPatch }).slice(0, 4000) },
  })
}

/* ---------------- job control ---------------- */

export async function countProcessingVideos(): Promise<number> {
  return db.agentVideo.count({ where: { status: 'processing' } })
}

/** mark the jobs attached to deleted/cleared messages as cancelled */
export async function cancelVideosForMessages(chatMsgIds: string[]): Promise<void> {
  if (!chatMsgIds.length) return
  await db.agentVideo.updateMany({
    where: { chatMsgId: { in: chatMsgIds }, status: 'processing' },
    data: { status: 'cancelled', finishedAt: new Date() },
  })
}

export async function cancelAllProcessingVideos(): Promise<void> {
  await db.agentVideo.updateMany({
    where: { status: 'processing' },
    data: { status: 'cancelled', finishedAt: new Date() },
  })
}

/* ---------------- the background pipeline ---------------- */

export interface VideoJobStart {
  ok: boolean
  error?: string
  /** placeholder assistant message (returned to the chat immediately) */
  message?: { id: string; content: string; files: unknown[]; meta: Record<string, unknown>; at: string }
  jobId?: string
}

export async function startVideoJob(input: {
  spec: VideoSpec
}): Promise<VideoJobStart> {
  const { spec } = input
  const busy = await countProcessingVideos()
  if (busy >= MAX_CONCURRENT) {
    return { ok: false, error: `الان ${busy} فیلم در حال ساختسه — یکی تموم شه این یکی رو بفرست (صفح بالا نمیره ولی موتور شلوغه)` }
  }

  const clips = planClips(spec.durationSec)
  const estMin = Math.max(1, Math.round(clips.length * (spec.quality === 'quality' ? 2.5 : 1.2)))

  // placeholder assistant message — the job keeps it updated live
  const msg = await db.chatMessage.create({
    data: {
      role: 'assistant',
      content: `🎬 فیلم‌سازی شروع شد — «${spec.prompt.slice(0, 160)}»\n\n⏱ مدت: ${spec.durationSec} ثانیه در ${clips.length} پارت • کیفیت: ${spec.quality === 'quality' ? 'بالا' : 'سریع'} • ${spec.size === '1080x1920' ? 'عمودی' : 'افقی'} ${spec.fps}fps${spec.withAudio ? ' • با صدا' : ''}\n⏳ زمان تقریبی: ~${estMin} دقیقه — این پنجره باز بمونه؛ همین‌جا پیشرفت و خود فیلم میاد.`,
      meta: JSON.stringify({
        videoStatus: 'processing', clipsTotal: clips.length, clipsDone: 0,
        durationSec: spec.durationSec, videoQuality: spec.quality, videoSize: spec.size, videoFps: spec.fps,
      }),
    },
  })

  const job = await db.agentVideo.create({
    data: {
      prompt: spec.prompt,
      status: 'processing',
      quality: spec.quality,
      size: spec.size,
      fps: spec.fps,
      withAudio: spec.withAudio,
      durationSec: spec.durationSec,
      clipsTotal: clips.length,
      chatMsgId: msg.id,
    },
  })

  // fire-and-forget — the pipeline runs while the chat stays usable
  void runVideoPipeline(job.id, spec, clips, msg.id).catch(async (e) => {
    const errMsg = e instanceof Error ? e.message : String(e)
    try {
      await db.agentVideo.update({ where: { id: job.id }, data: { status: 'error', error: errMsg.slice(0, 500), finishedAt: new Date() } })
      const row = await db.chatMessage.findUnique({ where: { id: msg.id } })
      await db.chatMessage.update({
        where: { id: msg.id },
        data: {
          content: `😞 ساخت فیلم گیر کرد: ${errMsg.slice(0, 200)}\n\nدوباره تلاش کن — یا مدت رو کمتر کن (هر پارت جدا ساخته می‌شه و پارت‌های بیشتر یعنی زمان بیشتر).`,
          meta: JSON.stringify({ ...safeParseMeta(row?.meta), videoStatus: 'error', error: errMsg.slice(0, 160) }),
        },
      })
    } catch { /* already cleaned up */ }
  })

  return {
    ok: true,
    jobId: job.id,
    message: { id: msg.id, content: msg.content, files: [], meta: safeParseMeta(msg.meta), at: msg.createdAt.toISOString() },
  }
}

function safeParseMeta(s: string | undefined | null): Record<string, unknown> {
  try { const m = JSON.parse(s || '{}') as Record<string, unknown>; return m && typeof m === 'object' ? m : {} } catch { return {} }
}

async function runVideoPipeline(jobId: string, spec: VideoSpec, clips: ClipPlan[], chatMsgId: string): Promise<void> {
  mkdirSync(VIDEO_TMP_ROOT, { recursive: true })
  const tmpDir = mkdtempSync(path.join(VIDEO_TMP_ROOT, 'job-'))
  try {
    mkdirSync(VIDEOS_PUBLIC_DIR, { recursive: true })

    // Persian → English bridge (faithful, no softening — see promptBridge)
    const basePrompt = await promptBridge(spec.prompt, 'video')

    const clipPaths: string[] = []
    for (let i = 0; i < clips.length; i++) {
      // cancelled while we were working? (message deleted / chat cleared)
      const job = await db.agentVideo.findUnique({ where: { id: jobId } })
      if (!job || job.status === 'cancelled') {
        try { await db.chatMessage.delete({ where: { id: chatMsgId } }) } catch { /* already gone */ }
        return
      }

      const plan = clips[i]
      // continuity hint for parts after the first — same style/scene
      const prompt = i === 0
        ? basePrompt
        : `${basePrompt} (seamless continuation, part ${i + 1} of a single continuous film — same characters, style, lighting and scene; continue the motion exactly where the previous part ended)`

      const opts: VideoGenOpts = {
        quality: spec.quality,
        size: spec.size,
        fps: spec.fps,
        duration: plan.genDur,
        withAudio: spec.withAudio,
      }

      const taskId = await llmVideoCreate(prompt, opts)

      // poll the provider task (up to ~15 min per clip — quality mode is slow).
      // A transient provider error (429 rate-limit cooldown / network blip)
      // must NOT kill the film: keep waiting, grant extra deadline for stalls
      // (capped at +10 min), and never query while the shared cooldown is on.
      let url = ''
      const deadline = Date.now() + 15 * 60_000
      let extraMs = 0
      const MAX_STALL_EXTRA = 10 * 60_000
      let pollMs = 6_000
      while (Date.now() < deadline + extraMs) {
        await new Promise((r) => setTimeout(r, pollMs))
        pollMs = Math.min(20_000, pollMs + 2_000)
        const jobNow = await db.agentVideo.findUnique({ where: { id: jobId } })
        if (!jobNow || jobNow.status === 'cancelled') {
          try { await db.chatMessage.delete({ where: { id: chatMsgId } }) } catch { /* gone */ }
          return
        }
        // account-wide rate-limit cooldown → wait it out instead of poking
        if (llmCooldownActive()) {
          extraMs = Math.min(extraMs + pollMs, MAX_STALL_EXTRA)
          continue
        }
        try {
          const q = await llmVideoQuery(taskId)
          if (q.status === 'SUCCESS' && q.url) { url = q.url; break }
          if (q.status === 'FAIL') throw new Error(`پارت ${i + 1}: سرویس ویدیو تسک را رد کرد`)
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          if (/رد کرد/.test(msg)) throw e // provider explicitly FAILED the task — real error
          // transient (429 / network) — extend the deadline and keep waiting
          console.error(`[video] poll transient error (part ${i + 1}): ${msg.slice(0, 120)}`)
          extraMs = Math.min(extraMs + pollMs + 15_000, MAX_STALL_EXTRA)
        }
      }
      if (!url) throw new Error(`پارت ${i + 1}: مهلت ساخت کلیپ تمام شد`)

      const raw = path.join(tmpDir, `raw-${i}.mp4`)
      await downloadTo(url, raw)

      // normalize (+ exact trim) → uniform h264 streams for a safe concat
      const norm = path.join(tmpDir, `clip-${String(i).padStart(3, '0')}.mp4`)
      await normalizeClip(raw, norm, plan.trimSec < plan.genDur ? plan.trimSec : undefined, spec.withAudio)
      clipPaths.push(norm)

      // progress → both the job row and the placeholder message meta
      await db.agentVideo.update({ where: { id: jobId }, data: { clipsDone: i + 1 } })
      await msgMetaUpdate(chatMsgId, { clipsDone: i + 1 })
    }

    // stitch everything into the final film
    const final = path.join(VIDEOS_PUBLIC_DIR, `vid-${Date.now()}-${randomBytes(3).toString('hex')}.mp4`)
    await stitchClips(clipPaths, final)
    const rel = `/agent-videos/${path.basename(final)}`

    await db.agentVideo.update({
      where: { id: jobId },
      data: { status: 'done', path: rel, finishedAt: new Date() },
    })

    const stat = await (await import('fs')).promises.stat(final)
    const row = await db.chatMessage.findUnique({ where: { id: chatMsgId } })
    await db.chatMessage.update({
      where: { id: chatMsgId },
      data: {
        content: `🎬 اینم فیلم ${spec.durationSec} ثانیه‌ای که خواستی — «${spec.prompt.slice(0, 160)}»\n(${spec.size === '1080x1920' ? 'عمودی' : 'افقی'} • ${spec.fps}fps • کیفیت ${spec.quality === 'quality' ? 'بالا' : 'سریع'} • ${(stat.size / 1024 / 1024).toFixed(1)} مگابایت)`,
        filesJson: JSON.stringify([{
          i: 0, kind: 'gen-video',
          name: `${spec.prompt.slice(0, 40)}.mp4`.replace(/[\\/:*?"<>|]/g, '_'),
          mime: 'video/mp4', size: stat.size, path: rel,
        }]),
        meta: JSON.stringify({ ...safeParseMeta(row?.meta), videoStatus: 'done', videoPath: rel }),
      },
    })
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

/* ---------------- startup hygiene ---------------- */

/** on boot: any job left «processing» from a previous run is dead — mark it */
export async function reconcileStaleVideos(): Promise<void> {
  const stale = await db.agentVideo.findMany({ where: { status: 'processing' } })
  for (const j of stale) {
    if (!j.chatMsgId) continue
    const row = await db.chatMessage.findUnique({ where: { id: j.chatMsgId } })
    await db.agentVideo.update({
      where: { id: j.id },
      data: { status: 'error', error: 'سرویس ری‌استارت شد و کار نیمه‌کاره ماند', finishedAt: new Date() },
    })
    if (row) {
      await db.chatMessage.update({
        where: { id: j.chatMsgId },
        data: {
          content: `⚡ ساخت این فیلم نیمه‌کاره موند (سرویس ری‌استارت شد). همین دستور رو دوباره بفرست تا از نو بسازم.`,
          meta: JSON.stringify({ ...safeParseMeta(row.meta), videoStatus: 'error' }),
        },
      })
    }
  }
  // clean orphaned tmp dirs from crashed runs
  try {
    if (existsSync(VIDEO_TMP_ROOT)) {
      for (const d of readdirSync(VIDEO_TMP_ROOT)) {
        if (d.startsWith('job-')) {
          try { rmSync(path.join(VIDEO_TMP_ROOT, d), { recursive: true, force: true }) } catch { /* busy */ }
        }
      }
    }
  } catch { /* no tmp root */ }
}
