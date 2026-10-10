import { NextRequest, NextResponse } from 'next/server'
import { existsSync, readFileSync, mkdirSync } from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { verifyKey, pidAlive, pidUptime, readJsonSafe } from '@/lib/panel-server'
import {
  INSTANCES_CTL,
  WATCHER_CTL,
  INSTANCES_DIR,
  audit,
  run,
  rmInstanceDir,
  writeJsonAtomic,
  writeTextAtomic,
} from '@/lib/panel-ops'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Multi-account management («اکانت‌ها») — each account is an isolated
 * watcher instance under ~/tg-tools/instances/<id>/ with its own session,
 * persona (topic), blacklist and instructions. All instances can run at
 * the same time, each on its own Telegram session (single-client rule is
 * per session — never violated).
 */

interface InstanceStatus {
  supervisorAlive: boolean
  running: boolean
  paused: boolean
  pid: number | null
  uptimeSec: number | null
  repliesTotal: number
  startedCount: number
  mode: string
  lastError: string
  events: { ts: string; event: string; detail: string }[]
}

function instanceStatus(id: string): InstanceStatus {
  const dir = path.join(INSTANCES_DIR, id)
  const sup = pidAlive(path.join(dir, 'supervisor.pid'))
  const wat = pidAlive(path.join(dir, 'watcher.lock'))
  const state = readJsonSafe<Record<string, unknown>>(path.join(dir, 'state.json'), {})
  const events: { ts: string; event: string; detail: string }[] = []
  let lastError = ''
  try {
    const lines = readFileSync(path.join(dir, 'wlog.jsonl'), 'utf8').trim().split('\n')
    for (const line of lines.slice(-40)) {
      try {
        const rec = JSON.parse(line)
        const detail =
          typeof rec.err === 'string' ? rec.err :
          typeof rec.text === 'string' ? rec.text :
          typeof rec.me === 'string' ? rec.me : ''
        events.push({ ts: rec.ts || '', event: rec.event || '', detail: String(detail).slice(0, 90) })
        if (rec.event === 'fatal' || rec.event === 'llm_fail') {
          lastError = String(rec.err || rec.event).slice(0, 140)
        }
      } catch {
        /* skip bad line */
      }
    }
  } catch {
    /* no log yet */
  }
  return {
    supervisorAlive: sup.alive,
    running: wat.alive,
    paused: existsSync(path.join(dir, 'PAUSE')),
    pid: wat.pid,
    uptimeSec: pidUptime(wat.pid),
    repliesTotal: Number(state.replies_total || 0),
    startedCount: Number(state.started_count || 0),
    mode: String(state.mode || 'permanent'),
    lastError,
    events: events.slice(-8).reverse(),
  }
}

/* ---------------------------------------------------------------- GET */

export async function GET(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }
  const rows = await db.tgAccount.findMany({ orderBy: { createdAt: 'asc' } })
  const accounts = rows.map((r) => ({
    id: r.id,
    label: r.label,
    topic: r.topic,
    phone: r.phone,
    persona: r.persona,
    footer: r.footer,
    thinking: r.thinking,
    enabled: r.enabled,
    hasSession: r.session.length > 0,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    status: instanceStatus(r.id),
  }))
  return NextResponse.json({ ok: true, accounts })
}

/* ---------------------------------------------------------------- POST */

interface AccountBody {
  op?: string
  id?: string
  on?: boolean
  label?: string
  topic?: string
  phone?: string
  session?: string
  persona?: string
  footer?: string
  thinking?: boolean
  enabled?: boolean
}

function writeInstanceFiles(
  id: string,
  fields: { label: string; topic: string; session?: string; persona: string; footer: string; thinking: boolean }
) {
  const dir = path.join(INSTANCES_DIR, id)
  mkdirSync(dir, { recursive: true })
  if (fields.session) {
    writeTextAtomic(path.join(dir, 'env'), `TELEGRAM_SESSION_STRING=${fields.session}\n`)
  }
  // merge with existing config — never drop watcher-managed keys
  const cfgPath = path.join(dir, 'config.json')
  const cfg = readJsonSafe<Record<string, unknown>>(cfgPath, {})
  cfg.label = fields.label
  cfg.topic = fields.topic
  cfg.saved_messages_commands = cfg.saved_messages_commands ?? true
  if (!Array.isArray(cfg.blacklist)) cfg.blacklist = []
  if (!Array.isArray(cfg.instructions)) cfg.instructions = []
  if (fields.persona) cfg.persona = fields.persona
  else delete cfg.persona
  if (fields.footer) cfg.footer = fields.footer
  else delete cfg.footer
  cfg.thinking = fields.thinking
  writeJsonAtomic(cfgPath, cfg)
}

export async function POST(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let body: AccountBody
  try {
    body = (await req.json()) as AccountBody
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400 })
  }

  const op = String(body.op || '')

  /* ---------- create ---------- */
  if (op === 'create') {
    const label = String(body.label || '').trim()
    const topic = String(body.topic || '').trim()
    const phone = String(body.phone || '').trim()
    const session = String(body.session || '').trim()
    const persona = String(body.persona || '').trim()
    const footer = String(body.footer || '').trim()
    const thinking = body.thinking !== false

    if (!label || label.length > 40) {
      return NextResponse.json({ ok: false, error: 'عنوان اکانت لازم است (حداکثر ۴۰ حرف)' }, { status: 400 })
    }
    if (topic.length > 80) {
      return NextResponse.json({ ok: false, error: 'موضوع حداکثر ۸۰ حرف' }, { status: 400 })
    }
    if (session.length < 40) {
      return NextResponse.json(
        { ok: false, error: 'سشن‌استرینگ معتبر نیست (حداقل ~۴۰ کاراکتر؛ رشته‌ای که Telethon می‌دهد)' },
        { status: 400 }
      )
    }
    if (persona.length > 16_000 || footer.length > 300) {
      return NextResponse.json({ ok: false, error: 'متن شخصیت/فوتر بیش از حد بلند است' }, { status: 400 })
    }

    const row = await db.tgAccount.create({
      data: { label, topic, phone, session, persona, footer, thinking, enabled: true },
    })
    writeInstanceFiles(row.id, { label, topic, session, persona, footer, thinking })
    audit('account_create', `${row.id} ${label}`)
    return NextResponse.json({ ok: true, id: row.id })
  }

  /* ---------- master toggle: main watcher + ALL account instances ---------- */
  if (op === 'toggle-all') {
    const on = body.on === true
    // main watcher first (stop) / last-ish (start) — both are independent processes
    const main = await run(WATCHER_CTL, [on ? 'start' : 'stop'], on ? 90_000 : 45_000)
    const rows = await db.tgAccount.findMany({ orderBy: { createdAt: 'asc' } })
    // when turning ON: only accounts that are enabled and own a session
    const targets = rows.filter((r) => (on ? r.enabled && r.session.length > 0 : true))
    const results = await Promise.all(
      targets.map((r) => run(INSTANCES_CTL, [r.id, on ? 'start' : 'stop'], 45_000))
    )
    const okCount = results.filter((r) => r.ok).length
    audit('account_toggle_all', `${on ? 'on' : 'off'} main=${main.ok} instances=${okCount}/${targets.length}`)
    return NextResponse.json({
      ok: true,
      on,
      main: main.ok,
      mainOutput: main.out.slice(-400),
      instances: okCount,
      instancesTotal: targets.length,
    })
  }

  /* ---------- ops that need an existing id ---------- */
  const id = String(body.id || '')
  if (!/^[a-z0-9]{20,30}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: 'شناسه اکانت نامعتبر' }, { status: 400 })
  }
  const row = await db.tgAccount.findUnique({ where: { id } })
  if (!row) {
    return NextResponse.json({ ok: false, error: 'اکانت پیدا نشد' }, { status: 404 })
  }

  switch (op) {
    case 'update': {
      const label = body.label !== undefined ? String(body.label).trim() : row.label
      const topic = body.topic !== undefined ? String(body.topic).trim() : row.topic
      const phone = body.phone !== undefined ? String(body.phone).trim() : row.phone
      // empty session on update = keep the existing one
      const session = body.session && String(body.session).trim().length >= 40
        ? String(body.session).trim()
        : row.session
      const persona = body.persona !== undefined ? String(body.persona).trim() : row.persona
      const footer = body.footer !== undefined ? String(body.footer).trim() : row.footer
      const thinking = body.thinking !== undefined ? body.thinking !== false : row.thinking
      const enabled = body.enabled !== undefined ? !!body.enabled : row.enabled
      if (!label || label.length > 40) {
        return NextResponse.json({ ok: false, error: 'عنوان اکانت لازم است' }, { status: 400 })
      }
      await db.tgAccount.update({
        where: { id },
        data: { label, topic, phone, session, persona, footer, thinking, enabled },
      })
      writeInstanceFiles(id, { label, topic, session, persona, footer, thinking })
      audit('account_update', `${id} ${label}`)
      return NextResponse.json({ ok: true })
    }

    case 'delete': {
      await run(INSTANCES_CTL, [id, 'stop'], 30_000)
      rmInstanceDir(id)
      await db.tgAccount.delete({ where: { id } })
      audit('account_delete', id)
      return NextResponse.json({ ok: true })
    }

    case 'start': {
      const r = await run(INSTANCES_CTL, [id, 'start'], 30_000)
      audit('account_start', id)
      return NextResponse.json({ ok: r.ok, output: r.out })
    }

    case 'stop': {
      const r = await run(INSTANCES_CTL, [id, 'stop'], 30_000)
      audit('account_stop', id)
      return NextResponse.json({ ok: r.ok, output: r.out })
    }

    case 'restart': {
      await run(INSTANCES_CTL, [id, 'stop'], 30_000)
      const r = await run(INSTANCES_CTL, [id, 'start'], 30_000)
      audit('account_restart', id)
      return NextResponse.json({ ok: r.ok, output: r.out })
    }

    default:
      return NextResponse.json({ ok: false, error: 'عملیات ناشناخته' }, { status: 400 })
  }
}
