import { NextResponse } from "next/server"
import fs from "node:fs"
import path from "node:path"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const LOG_PATH = path.join(process.cwd(), "dev.log")
const MAX_READ_BYTES = 256 * 1024

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const lines = Math.min(Math.max(Number(searchParams.get("lines") ?? 120) || 120, 10), 400)

    if (!fs.existsSync(LOG_PATH)) {
      return NextResponse.json(
        { ok: true, lines: [], totalBytes: 0, updatedAt: null },
        { headers: { "Cache-Control": "no-store" } }
      )
    }

    const stat = fs.statSync(LOG_PATH)
    const readBytes = Math.min(stat.size, MAX_READ_BYTES)
    const offset = Math.max(0, stat.size - readBytes)

    const fd = fs.openSync(LOG_PATH, "r")
    try {
      const buffer = Buffer.alloc(readBytes)
      fs.readSync(fd, buffer, 0, readBytes, offset)
      const text = buffer.toString("utf8")
      let all = text.split("\n").filter((l) => l.length > 0)
      // drop possibly-partial first line when we sliced mid-file
      if (offset > 0 && all.length > 1) all = all.slice(1)
      const tail = all.slice(-lines)
      return NextResponse.json(
        {
          ok: true,
          lines: tail,
          totalBytes: stat.size,
          updatedAt: stat.mtime.toISOString(),
        },
        { headers: { "Cache-Control": "no-store" } }
      )
    } finally {
      fs.closeSync(fd)
    }
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        lines: [],
        totalBytes: 0,
        updatedAt: null,
        error: err instanceof Error ? err.message : "خطا در خواندن لاگ",
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  }
}
