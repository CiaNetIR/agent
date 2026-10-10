import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import { existsSync, rmSync, statSync } from 'fs'
import path from 'path'
import { db } from '@/lib/db'
import { verifyKey, pidAlive } from '@/lib/panel-server'
import {
  INSTANCES_CTL,
  INSTANCES_DIR,
  PANEL_DIR,
  PROJECT_DIR,
  TERM_CTL,
  WATCHER_CTL,
  WATCHER_DIR,
  audit,
  run,
  systemAudit,
} from '@/lib/panel-ops'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * System / Danger-Zone («سیستم») — real, owner-typed-confirmed operations:
 *   services-stop / services-start   soft power off/on of every service
 *   factory-reset                    wipe panel data (db, instances, logs)
 *   delete-project                   tar-backup then wipe the project tree
 *   power-off-server                 kill the dev web server itself
 * Destructive actions require a typed Persian confirm word and are logged
 * to /home/z/system-actions.log (which survives project deletion).
 *
 * delete-project NOTE (learned the hard way, 2026-10-07): the project dir
 * contains mount points (upload/) so `mv` of the whole dir FAILS mid-way
 * (EXDEV/EBUSY fallback leaves a mess). Correct approach: tar a small
 * real backup (code+db+secrets — NOT node_modules/.next) into ~/.trash,
 * then delete everything except the upload mount.
 */

const CONFIRM_WORDS: Record<string, string> = {
  'factory-reset': 'ریست',
  'delete-project': 'حذف',
  'power-off-server': 'خاموش',
}

async function instances(): Promise<string[]> {
  try {
    const { readdirSync } = await import('fs')
    return readdirSync(INSTANCES_DIR).filter((d) =>
      existsSync(path.join(INSTANCES_DIR, d, 'env'))
    )
  } catch {
    return []
  }
}

async function stopAllServices(): Promise<string[]> {
  const log: string[] = []
  const ids = await instances()
  for (const id of ids) {
    const r = await run(INSTANCES_CTL, [id, 'stop'], 30_000)
    log.push(`instance ${id}: ${r.out.split('\n')[0]}`)
  }
  log.push((await run(WATCHER_CTL, ['stop'], 30_000)).out.split('\n').pop() || '')
  log.push((await run(TERM_CTL, ['stop'], 20_000)).out.split('\n').pop() || '')
  return log
}

async function startAllServices(): Promise<string[]> {
  const log: string[] = []
  log.push((await run(WATCHER_CTL, ['start'], 60_000)).out.split('\n')[0] || '')
  const ids = await instances()
  for (const id of ids) {
    const r = await run(INSTANCES_CTL, [id, 'start'], 30_000)
    log.push(`instance ${id}: ${r.out.split('\n')[0]}`)
  }
  log.push((await run(TERM_CTL, ['start'], 30_000)).out.split('\n')[0] || '')
  return log
}

/* ---------------------------------------------------------------- GET */

export async function GET(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  const accounts = await db.tgAccount.count()
  const watcher = pidAlive(path.join(WATCHER_DIR, 'watcher.lock'))
  const terminal = pidAlive(path.join('/home/z/my-project/mini-services/terminal', 'supervisor.pid'))

  let dbSize = 0
  let auditSize = 0
  try {
    dbSize = statSync('/home/z/my-project/db/custom.db').size
  } catch {
    /* noop */
  }
  try {
    auditSize = statSync(path.join(PANEL_DIR, 'audit.log')).size
  } catch {
    /* noop */
  }

  return NextResponse.json({
    ok: true,
    info: {
      projectDir: PROJECT_DIR,
      trashDir: '/home/z/.trash',
      dbAccounts: accounts,
      instanceCount: (await instances()).length,
      watcherRunning: watcher.alive,
      terminalAlive: terminal.alive,
      sizes: { db: dbSize, audit: auditSize },
    },
    warnings: {
      'factory-reset': 'دیتابیس پنل، همه اکانت‌های افزوده و لاگ‌های پنل پاک می‌شن. رمز پنل، کدها، سشن اصلی و بکاپ‌ها دست‌نخورده می‌مونن.',
      'delete-project': 'اول یه بکاپ فشرده از کدها، دیتابیس و رازها (سشن تلگرام) توی سبد بازیافت (~/.trash) ساخته می‌شه، بعد کل پروژه (به‌جز فایل‌های آپلود) واقعاً پاک می‌شه و همه سرویس‌ها خاموش می‌شن؛ سایت از دسترس خارج میشه. راه برگشت: از ایجنت بخواه بکاپ سبد رو برگردونه و نصب کنه.',
      'power-off-server': 'وب‌سرور پنل واقعاً کشته می‌شه؛ هیچ چیز اون رو خودکار برنمی‌گردونه. فقط ایجنت/پلتفرم می‌تونه روشنش کنه.',
    },
  })
}

/* ---------------------------------------------------------------- POST */

export async function POST(req: NextRequest) {
  if (!verifyKey(req.headers.get('x-panel-key'))) {
    return NextResponse.json({ ok: false }, { status: 401 })
  }

  let body: { action?: string; confirm?: string }
  try {
    body = (await req.json()) as { action?: string; confirm?: string }
  } catch {
    return NextResponse.json({ ok: false, error: 'بدنه نامعتبر' }, { status: 400 })
  }

  const action = String(body.action || '')
  const need = CONFIRM_WORDS[action]
  if (need && String(body.confirm || '').trim() !== need) {
    return NextResponse.json(
      { ok: false, error: `برای تأیید باید عیناً بنویسی: ${need}` },
      { status: 400 }
    )
  }

  audit('system_action', action)
  systemAudit('system_action', action)

  switch (action) {
    /* ---- soft power: services only, panel stays alive ---- */
    case 'services-stop': {
      const log = await stopAllServices()
      return NextResponse.json({ ok: true, action, log })
    }
    case 'services-start': {
      const log = await startAllServices()
      return NextResponse.json({ ok: true, action, log })
    }

    /* ---- hard reset: wipe panel data, keep code/secrets/password ---- */
    case 'factory-reset': {
      const log: string[] = []
      // stop + remove all instances
      const ids = await instances()
      for (const id of ids) {
        await run(INSTANCES_CTL, [id, 'stop'], 30_000)
        try {
          rmSync(path.join(INSTANCES_DIR, id), { recursive: true, force: true })
          log.push(`instance ${id} removed`)
        } catch {
          /* noop */
        }
      }
      // wipe db rows
      await db.tgAccount.deleteMany()
      log.push('database wiped')
      // panel caches/logs/tmp
      try {
        rmSync(path.join(PANEL_DIR, 'audit.log'), { force: true })
        log.push('panel logs cleared')
      } catch {
        /* noop */
      }
      return NextResponse.json({ ok: true, action, log })
    }

    /* ---- delete project: tar backup first, then wipe (upload stays) ---- */
    case 'delete-project': {
      await stopAllServices()
      // respond first, then backup+wipe (detached) so this response gets out
      spawn('bash', ['-c',
        'sleep 3; mkdir -p /home/z/.trash; ' +
        'ts=$(date +%Y%m%d-%H%M%S); ' +
        'tar czf "/home/z/.trash/my-project-src-$ts.tar.gz" -C /home/z/my-project ' +
        'src prisma db mini-services package.json bun.lock next.config.ts tsconfig.json ' +
        'tailwind.config.ts postcss.config.mjs components.json eslint.config.mjs ' +
        'Caddyfile .env .secrets worklog.md 2>/dev/null; ' +
        'find /home/z/my-project -mindepth 1 -maxdepth 1 ! -name upload -exec rm -rf {} +; ' +
        'echo "deleted via panel $(date)" > /home/z/my-project/DELETED.txt',
      ], { detached: true, stdio: 'ignore' }).unref()
      return NextResponse.json({
        ok: true,
        action,
        note: 'بکاپ کدها و رازها توی سبد بازیافت ساخته می‌شه و بعد پروژه واقعاً پاک می‌شه؛ پنل چند لحظه دیگر از دسترس خارج میشه.',
      })
    }

    /* ---- full power off: kill the dev web server itself ---- */
    case 'power-off-server': {
      await stopAllServices()
      // NOTE: patterns use [x] char-classes so the spawned bash script's
      // own cmdline (which contains these strings literally) never
      // self-matches — otherwise the script kills itself at pkill #1 and
      // the node/next-server processes survive.
      spawn('bash', ['-c',
        'sleep 3; pkill -f "bun run de[v]"; pkill -f "next de[v]"; ' +
        'pkill -f "next-serve[r]"',
      ], { detached: true, stdio: 'ignore' }).unref()
      return NextResponse.json({
        ok: true,
        action,
        note: 'وب‌سرور در حال خاموشی کامل است؛ پنل از دسترس خارج میشه و خودکار برنمی‌گرده.',
      })
    }

    default:
      return NextResponse.json({ ok: false, error: 'عملیات ناشناخته' }, { status: 400 })
  }
}
