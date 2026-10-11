import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { verifyKey } from '@/lib/panel-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)
const PY = '/home/z/.venv/bin/python'

let cache: { at: number; data: unknown } | null = null
const CACHE_MS = 60_000

async function loadLlmSettings(): Promise<unknown> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data
  const code = [
    "import sys, json",
    "sys.path.insert(0, '/home/z/tg-tools')",
    "sys.path.insert(0, '/home/z/tg-tools/watcher')",
    "import watcher",
    "print(json.dumps(watcher.llm_settings_dict(), ensure_ascii=False))",
  ].join('; ')
  const { stdout } = await execFileAsync(PY, ['-c', code], {
    timeout: 20_000,
    maxBuffer: 4 * 1024 * 1024,
  })
  const data = JSON.parse(stdout.trim().split('\n').pop() || '{}')
  cache = { at: Date.now(), data }
  return data
}

export async function GET(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  try {
    const data = await loadLlmSettings()
    return NextResponse.json({ ok: true, settings: data })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: 'خواندن تنظیمات از watcher.py ممکن نشد' },
      { status: 500 }
    )
  }
}
