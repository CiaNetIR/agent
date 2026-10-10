import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { MANUAL_PATH, verifyKey } from '@/lib/panel-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

let cached: { at: number; text: string } | null = null

export async function GET(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  try {
    const stat = req.headers.get('x-no-cache') === '1'
    if (!stat && cached && Date.now() - cached.at < 30_000) {
      return NextResponse.json({ ok: true, markdown: cached.text })
    }
    const text = readFileSync(MANUAL_PATH, 'utf8')
    cached = { at: Date.now(), text }
    return NextResponse.json({ ok: true, markdown: text })
  } catch {
    return NextResponse.json(
      { ok: false, error: 'فایل راهنما پیدا نشد (tg-tools-backup/Z-OWNER-MANUAL.md)' },
      { status: 404 }
    )
  }
}
