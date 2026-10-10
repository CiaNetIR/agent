import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { verifyKey, pidAlive, WATCHER_DIR } from '@/lib/panel-server'
import { WATCHER_CTL, WATCHER_CONFIG, audit, writeJsonAtomic } from '@/lib/panel-ops'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)
const PY = '/home/z/.venv/bin/python'

let cache: { at: number; data: unknown } | null = null
const CACHE_MS = 60_000

async function loadLlmSettings(): Promise<unknown> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data
  const code = [
    'import sys, json',
    "sys.path.insert(0, '/home/z/tg-tools')",
    "sys.path.insert(0, '/home/z/tg-tools/watcher')",
    'import watcher',
    'print(json.dumps(watcher.llm_settings_dict(), ensure_ascii=False))',
  ].join('; ')
  const { stdout } = await execFileAsync(PY, ['-c', code], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const data = JSON.parse(stdout.trim().split('\n').pop() || '{}')
  cache = { at: Date.now(), data }
  return data
}

/* ---------------------------------------------------------------- GET */

export async function GET(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  try {
    const data = await loadLlmSettings()
    return NextResponse.json({ ok: true, settings: data })
  } catch {
    return NextResponse.json(
      { ok: false, error: 'خواندن تنظیمات از watcher.py ممکن نشد' },
      { status: 500 }
    )
  }
}

/* ---------------------------------------------------------------- POST */
// Save owner-editable LLM overrides into watcher-config.json (merged with
// the watcher's own keys — blacklist/instructions are never touched), then
// restart the main watcher so runtime values (rate limits) pick up.

const LIMITS = {
  persona: 16_000,
  command_prompt: 16_000,
  footer: 300,
}

function readWatcherConfig(): Record<string, unknown> {
  try {
    if (existsSync(WATCHER_CONFIG)) {
      return JSON.parse(readFileSync(WATCHER_CONFIG, 'utf8'))
    }
  } catch {
    /* fallthrough */
  }
  return { blacklist: [], instructions: [], saved_messages_commands: true }
}

interface SaveBody {
  persona?: string
  command_prompt?: string
  footer?: string
  thinking?: boolean
  retries?: number
  rate_limits?: { per_chat_hour?: number; global_hour?: number; debounce_s?: number }
  restart?: boolean
}

export async function POST(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let body: SaveBody
  try {
    body = (await req.json()) as SaveBody
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400 })
  }

  const cfg = readWatcherConfig()
  const changed: string[] = []

  // string overrides — empty string removes the override (back to default)
  for (const key of ['persona', 'command_prompt', 'footer'] as const) {
    if (typeof body[key] === 'string') {
      const v = (body[key] as string).trim()
      if (v.length > LIMITS[key]) {
        return NextResponse.json(
          { ok: false, error: `«${key}» بیشتر از حد مجاز است` },
          { status: 400 }
        )
      }
      if (v) cfg[key] = v
      else delete cfg[key]
      changed.push(key)
    }
  }

  if (typeof body.thinking === 'boolean') {
    cfg.thinking = body.thinking
    changed.push('thinking')
  }

  if (body.retries !== undefined) {
    const r = Number(body.retries)
    if (!Number.isInteger(r) || r < 1 || r > 5) {
      return NextResponse.json({ ok: false, error: 'تلاش مجدد باید ۱ تا ۵ باشد' }, { status: 400 })
    }
    cfg.retries = r
    changed.push('retries')
  }

  if (body.rate_limits) {
    const rl = (cfg.rate_limits && typeof cfg.rate_limits === 'object')
      ? { ...(cfg.rate_limits as Record<string, number>) }
      : {}
    const bounds: Record<string, [number, number]> = {
      per_chat_hour: [1, 200],
      global_hour: [1, 1000],
      debounce_s: [0, 300],
    }
    for (const [k, [lo, hi]] of Object.entries(bounds)) {
      const v = Number((body.rate_limits as Record<string, number>)[k])
      if (v === undefined || Number.isNaN(v)) continue
      if (!Number.isInteger(v) || v < lo || v > hi) {
        return NextResponse.json(
          { ok: false, error: `مقدار ${k} خارج از محدوده ${lo}–${hi} است` },
          { status: 400 }
        )
      }
      rl[k] = v
    }
    cfg.rate_limits = rl
    changed.push('rate_limits')
  }

  if (changed.length === 0) {
    return NextResponse.json({ ok: false, error: 'چیزی برای ذخیره نبود' }, { status: 400 })
  }

  try {
    writeJsonAtomic(WATCHER_CONFIG, cfg)
  } catch {
    return NextResponse.json({ ok: false, error: 'نوشتن فایل تنظیمات ممکن نشد' }, { status: 500 })
  }
  audit('llm_settings_save', changed.join(','))

  cache = null // force reload

  // restart the watcher so rate limits / persona apply at runtime
  let restarted = false
  let restartError = ''
  if (body.restart !== false) {
    await execFileAsync('bash', [WATCHER_CTL, 'stop'], { timeout: 30_000 }).catch(() => null)
    await new Promise((r) => setTimeout(r, 1500))
    await execFileAsync('bash', [WATCHER_CTL, 'start'], { timeout: 60_000 }).catch(() => null)
    // verify the watcher REALLY came back up — never report success while the
    // Telegram responder is actually down
    await new Promise((r) => setTimeout(r, 1500))
    restarted = pidAlive(path.join(WATCHER_DIR, 'watcher.lock')).alive
    if (!restarted) restartError = 'واتچر بعد از ری‌استارت بالا نیامد — از تب «سرویس‌ها» چکش کن'
  }

  try {
    const data = await loadLlmSettings()
    return NextResponse.json({ ok: true, settings: data, changed, restarted, restartError: restartError || undefined })
  } catch {
    return NextResponse.json({ ok: true, changed, restarted, restartError: restartError || undefined })
  }
}
