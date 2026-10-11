/**
 * GET /api/handoff?token=... — authenticated one-time-token download of
 * the CIANET handoff document (owner-only, no public file exposure).
 *
 *   - Missing/wrong token → 404 (indistinguishable from a non-existent route)
 *   - >5 successful downloads → 410 Gone (limit tracked in .secrets/handoff-state.json)
 *   - Success → the handoff markdown as an attachment, never cached
 *
 * The token and state files are re-read from disk on every request, so
 * rotating the token or resetting the counter takes effect immediately.
 */
import { NextRequest, NextResponse } from 'next/server'
import { readFileSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const HOME = process.env.HOME || os.homedir() || '/root'
const PROJECT_DIR = process.env.PROJECT_DIR || path.join(HOME, 'my-project')
const TOKEN_PATH = path.join(PROJECT_DIR, '.secrets', 'handoff-token.txt')
const STATE_PATH = path.join(PROJECT_DIR, '.secrets', 'handoff-state.json')
const HANDOFF_PATH = path.join(HOME, 'HANDOFF-private.md')
const MAX_DOWNLOADS = 5

interface HandoffState {
  count: number
  firstUse: string
}

function readState(): HandoffState {
  try {
    const raw = JSON.parse(readFileSync(STATE_PATH, 'utf8')) as Partial<HandoffState>
    const count = typeof raw.count === 'number' && Number.isFinite(raw.count) ? Math.floor(raw.count) : 0
    return {
      count: Math.max(0, count),
      firstUse: typeof raw.firstUse === 'string' ? raw.firstUse : '',
    }
  } catch {
    // Missing or corrupt state file → treat as first use.
    return { count: 0, firstUse: '' }
  }
}

function writeState(state: HandoffState): void {
  try {
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n', 'utf8')
  } catch {
    // Best-effort limit bookkeeping; never block the download on it.
  }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token') ?? ''

  let expected = ''
  try {
    expected = readFileSync(TOKEN_PATH, 'utf8').trim()
  } catch {
    expected = ''
  }
  if (!expected || token !== expected) {
    return new NextResponse('Not found', { status: 404 })
  }

  const state = readState()
  if (state.count >= MAX_DOWNLOADS) {
    return new NextResponse('Gone', { status: 410 })
  }

  let body = ''
  try {
    body = readFileSync(HANDOFF_PATH, 'utf8')
  } catch {
    return new NextResponse('Not found', { status: 404 })
  }

  writeState({
    count: state.count + 1,
    firstUse: state.firstUse || new Date().toISOString(),
  })

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': 'attachment; filename="CIANET-HANDOFF.md"',
      'Cache-Control': 'no-store',
    },
  })
}
