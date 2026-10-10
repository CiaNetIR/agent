import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { BACKUP_TRIGGER, pidAlive, verifyKey } from '@/lib/panel-server'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const THROTTLE_MS = 60_000

export async function POST(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const watcher = pidAlive(path.join('/home/z/tg-tools/watcher', 'watcher.lock'))
  if (!watcher.alive) {
    return NextResponse.json(
      { ok: false, reason: 'watcher-down', error: 'دستیار فعال نیست؛ اول روشنش کن' },
      { status: 409 }
    )
  }
  if (existsSync(BACKUP_TRIGGER)) {
    try {
      const age = Date.now() - statSync(BACKUP_TRIGGER).mtimeMs
      if (age < THROTTLE_MS) {
        return NextResponse.json(
          {
            ok: false,
            reason: 'throttled',
            retryAfterSec: Math.ceil((THROTTLE_MS - age) / 1000),
            error: 'یه درخواست بکاپ همین الان ثبت شده؛ چند ثانیه صبر کن',
          },
          { status: 429 }
        )
      }
    } catch {
      /* fallthrough */
    }
  }
  try {
    writeFileSync(BACKUP_TRIGGER, String(Date.now()), 'utf8')
  } catch {
    return NextResponse.json(
      { ok: false, error: 'نشد فایل دستور بکاپ رو ساخت' },
      { status: 500 }
    )
  }
  return NextResponse.json({
    ok: true,
    message: 'ثبت شد — تا حداکثر ۱۰ ثانیه دیگه فایل بکاپ میاد تو Saved Messages تلگرامت',
  })
}
