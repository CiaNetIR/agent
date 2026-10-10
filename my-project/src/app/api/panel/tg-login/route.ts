import { NextRequest, NextResponse } from 'next/server'
import { execFile } from 'child_process'
import path from 'path'
import { mkdirSync } from 'fs'
import { db } from '@/lib/db'
import { verifyKey } from '@/lib/panel-server'
import { INSTANCES_DIR, audit, writeJsonAtomic, writeTextAtomic } from '@/lib/panel-ops'
import { readJsonSafe } from '@/lib/panel-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * «اتصال ساده» Telegram wizard: phone → code → (2FA password) → done.
 * Wraps ~/tg-tools/login_new.py (real Telethon login for a NEW account —
 * never touches the main session). On success the account is created
 * server-side; the session string is NEVER sent to the browser.
 */

const PY = '/home/z/.venv/bin/python'
const SCRIPT = '/home/z/tg-tools/login_new.py'

function runLogin(args: string[], timeoutMs = 30_000): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    execFile(PY, [SCRIPT, ...args], { timeout: timeoutMs, maxBuffer: 512 * 1024 }, (err, stdout, stderr) => {
      const text = `${stdout || ''}`.trim()
      try {
        const lines = text.split('\n').filter(Boolean)
        resolve(JSON.parse(lines[lines.length - 1]) as Record<string, unknown>)
      } catch {
        resolve({ ok: false, error: (err?.message || stderr || 'پاسخ نامعتبر از اسکریپت ورود').slice(0, 200) })
      }
    })
  })
}

function writeInstanceFiles(
  id: string,
  fields: { label: string; topic: string; session: string; phone: string }
) {
  const dir = path.join(INSTANCES_DIR, id)
  mkdirSync(dir, { recursive: true })
  writeTextAtomic(path.join(dir, 'env'), `TELEGRAM_SESSION_STRING=${fields.session}\n`)
  const cfgPath = path.join(dir, 'config.json')
  const cfg = readJsonSafe<Record<string, unknown>>(cfgPath, {})
  cfg.label = fields.label
  cfg.topic = fields.topic
  cfg.saved_messages_commands = true
  if (!Array.isArray(cfg.blacklist)) cfg.blacklist = []
  if (!Array.isArray(cfg.instructions)) cfg.instructions = []
  writeJsonAtomic(cfgPath, cfg)
}

interface LoginBody {
  op?: string
  phone?: string
  code?: string
  password?: string
  label?: string
  topic?: string
}

export async function POST(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let body: LoginBody
  try {
    body = (await req.json()) as LoginBody
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400 })
  }

  const op = String(body.op || '')

  /* ---------- status ---------- */
  if (op === 'status') {
    const r = await runLogin(['status'], 10_000)
    return NextResponse.json(r)
  }

  /* ---------- cancel ---------- */
  if (op === 'cancel') {
    const r = await runLogin(['cancel'], 10_000)
    audit('tg_login_cancel', '')
    return NextResponse.json(r)
  }

  /* ---------- step 1: phone → code ---------- */
  if (op === 'send-code') {
    const phone = String(body.phone || '').trim()
    if (!/^\+?\d{7,15}$/.test(phone)) {
      return NextResponse.json({ ok: false, error: 'شماره معتبر نیست (مثل +989123456789)' }, { status: 400 })
    }
    const r = await runLogin(['send-code', '--phone', phone], 45_000)
    audit('tg_login_send_code', r.ok ? phone : `fail ${phone}`)
    return NextResponse.json(r)
  }

  /* ---------- step 2/3: code (+ password) → account ---------- */
  if (op === 'complete') {
    const code = String(body.code || '').trim()
    const password = String(body.password || '')
    if (!/^\d{4,8}$/.test(code)) {
      return NextResponse.json({ ok: false, error: 'کد باید ۴ تا ۸ رقم باشد' }, { status: 400 })
    }
    const args = ['complete', '--code', code]
    if (password) args.push('--password', password)
    const r = await runLogin(args, 45_000)
    audit('tg_login_complete', String(r.status || (r.ok ? 'ok' : 'fail')))

    if (!r.ok || r.status !== 'logged_in') {
      return NextResponse.json(r)
    }

    // success — create the account server-side (session never leaves the server)
    const user = (r.user || {}) as Record<string, string>
    const phone = String(user.phone || '')
    const label =
      (String(body.label || '').trim() || '').slice(0, 40) ||
      (user.username ? `@${user.username}` : `اکانت ${phone.slice(-4)}`)
    const topic = String(body.topic || '').trim().slice(0, 80)
    const session = String(r.session || '')

    const row = await db.tgAccount.create({
      data: { label, topic, phone, session, persona: '', footer: '', thinking: true, enabled: true },
    })
    writeInstanceFiles(row.id, { label, topic, session, phone })
    audit('tg_login_account_created', `${row.id} ${label}`)

    return NextResponse.json({
      ok: true,
      status: 'logged_in',
      account: { id: row.id, label, topic, phone, name: user.first_name || '', username: user.username || '' },
    })
  }

  return NextResponse.json({ ok: false, error: 'عملیات ناشناخته' }, { status: 400 })
}
