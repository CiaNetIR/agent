/**
 * Z agent core — scraper runner.
 *
 * Contract with ANY scraper script (owner's Python scraper):
 *   - runs with cwd = /home/z/agent/scraper
 *   - may write up to three outputs into ./out/ :
 *       out/output.txt   → summary text (sent to Telegram via sendq)
 *       out/output.csv   → product rows (sku,name,price,stock) → WooCommerce sync
 *       out/output.json  → structured data (stored in the DB)
 *   - exit code 0 = success
 * The default scraper.py (crypto spot prices) is a REAL working sample the
 * owner can replace with his own file (same name or change the path setting).
 */
import { spawn } from 'child_process'
import path from 'path'
import { existsSync } from 'fs'
import {
  SCRAPER_HOME,
  db,
  finishRun,
  getSettings,
  readTextIfNewer,
  sendqWrite,
  startRun,
  tehranHHMM,
} from './lib'
import { wooSyncCsv } from './woo'

export const SCRAPER_OUT = path.join(SCRAPER_HOME, 'out')

let scraping = false

export function isScraping(): boolean {
  return scraping
}

export async function runScraper(trigger: 'schedule' | 'manual'): Promise<{ ok: boolean; summary: string; runId: string }> {
  const settings = await getSettings()
  const script = settings.scraper_script || path.join(SCRAPER_HOME, 'scraper.py')
  const run = await startRun('scraper', `${trigger}`)
  if (scraping) {
    await finishRun(run.id, 'skipped', 'یک اجرای دیگه هنوز در جریانه')
    return { ok: false, summary: 'اجراهای قبلی هنوز تموم نشده', runId: run.id }
  }
  if (!existsSync(script)) {
    await finishRun(run.id, 'error', `اسکریپت پیدا نشد: ${script}`)
    return { ok: false, summary: `اسکریپت پیدا نشد: ${script}`, runId: run.id }
  }
  scraping = true
  const startedMs = Date.now()
  try {
    // stderr tail — MUST be drained: a chatty scraper (long tracebacks) would
    // otherwise fill the OS pipe, block the child forever on write(2) and the
    // run would only end at the 10-minute SIGKILL with all outputs discarded
    let errTail = ''
    const code = await new Promise<number>((resolve) => {
      const p = spawn('python3', [script], {
        cwd: SCRAPER_HOME,
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      })
      let last = 0
      p.stdout.on('data', () => {
        const now = Date.now()
        if (now - last > 5000) {
          last = now
        }
      })
      p.stderr?.on('data', (c: Buffer) => {
        errTail = (errTail + c.toString('utf8')).slice(-4000)
      })
      p.on('error', () => resolve(-1))
      p.on('close', (c) => resolve(c ?? -1))
      // hard kill after 10 minutes
      setTimeout(() => {
        try {
          p.kill('SIGKILL')
        } catch {
          /* already gone */
        }
      }, 10 * 60_000).unref?.()
    })

    const txt = readTextIfNewer(path.join(SCRAPER_OUT, 'output.txt'), startedMs)
    const csv = readTextIfNewer(path.join(SCRAPER_OUT, 'output.csv'), startedMs)
    const json = readTextIfNewer(path.join(SCRAPER_OUT, 'output.json'), startedMs)

    if (code !== 0) {
      await finishRun(run.id, 'error', `اسکرپر با کد ${code} تمام شد (خروجی ناقص)`, { stderr: errTail.slice(-1500) })
      return {
        ok: false,
        summary: `اسکرپر با کد ${code} تمام شد${errTail ? `: ${errTail.slice(-160).replace(/\s+/g, ' ')}` : ''}`,
        runId: run.id,
      }
    }

    // store all outputs in the DB
    let txtRows = 0
    if (txt) {
      await db.agentScrapeOutput.create({ data: { runId: run.id, kind: 'txt', content: txt.slice(0, 8000), rows: 1 } })
      txtRows = 1
    }
    let csvRows = 0
    if (csv) {
      const lines = csv.trim().split('\n').length - 1
      csvRows = Math.max(0, lines)
      await db.agentScrapeOutput.create({ data: { runId: run.id, kind: 'csv', content: csv.slice(0, 8000), rows: csvRows } })
    }
    if (json) {
      await db.agentScrapeOutput.create({ data: { runId: run.id, kind: 'json', content: json.slice(0, 50_000), rows: 1 } })
    }

    // TXT → Telegram (through the watcher's client — sendq)
    let sent = false
    if (txt && settings.scraper_send_txt === '1') {
      const chat = settings.telegram_chat || 'me'
      const header = `📄 خروجی اسکرپر — ${tehranHHMM()}\n\n`
      sent = sendqWrite({ chat, text: (header + txt).slice(0, 3900) })
    }

    // CSV → WooCommerce (auto-sync when configured+enabled)
    let syncSummary = ''
    if (csv && settings.woo_auto_sync === '1') {
      const r = await wooSyncCsv(csv, { record: true })
      syncSummary = r.configured
        ? ` | ووکامرس: ${r.created} جدید/${r.updated} آپدیت`
        : ' | ووکامرس پیکربندی نشده — رد شد'
    }

    const summary = `اسکرپر ok: txt${txt ? '✓' : '—'} csv${csv ? `(${csvRows} ردیف)✓` : '—'} json${json ? '✓' : '—'}${sent ? ' | تلگرام ✓' : ''}${syncSummary}`
    await finishRun(run.id, 'ok', summary, { txt: !!txt, csv: !!csv, json: !!json, csvRows, sent })
    return { ok: true, summary, runId: run.id }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await finishRun(run.id, 'error', `خطای اجرای اسکرپر: ${msg.slice(0, 150)}`)
    return { ok: false, summary: msg, runId: run.id }
  } finally {
    scraping = false
  }
}
