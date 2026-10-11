import { NextResponse } from "next/server"
import os from "node:os"
import fs from "node:fs"
import path from "node:path"
import { exec } from "node:child_process"
import { promisify } from "node:util"
import { db } from "@/lib/db"

const execAsync = promisify(exec)

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

const PROJECT_ROOT = process.cwd()
const IGNORED_FS_TYPES = new Set([
  "tmpfs",
  "devtmpfs",
  "shm",
  "squashfs",
  "devfs",
  "proc",
  "sysfs",
  "cgroup",
  "cgroup2",
])
const MAX_DISK_BYTES = 5 * 1024 * 1024 * 1024 * 1024 // 5TB — skip fake ossfs mounts

interface CpuTimes {
  idle: number
  total: number
  user: number
  system: number
  iowait: number
}

function readCpuTimes(): CpuTimes | null {
  try {
    const raw = fs.readFileSync("/proc/stat", "utf8")
    const line = raw.split("\n")[0] ?? ""
    const parts = line.split(/\s+/).slice(1).map(Number)
    if (parts.length < 5 || parts.some((n) => Number.isNaN(n))) return null
    const [user = 0, nice = 0, system = 0, idle = 0, iowait = 0, irq = 0, softirq = 0, steal = 0] = parts
    const total = parts.reduce((a, b) => a + (b || 0), 0)
    return {
      idle: idle + iowait,
      total,
      user: user + nice,
      system: system + irq + softirq + steal,
      iowait,
    }
  } catch {
    return null
  }
}

async function measureCpu() {
  const a = readCpuTimes()
  if (!a) return { usagePct: 0, userPct: 0, sysPct: 0, iowaitPct: 0 }
  await new Promise((r) => setTimeout(r, 200))
  const b = readCpuTimes()
  if (!b) return { usagePct: 0, userPct: 0, sysPct: 0, iowaitPct: 0 }
  const dTotal = b.total - a.total
  if (dTotal <= 0) return { usagePct: 0, userPct: 0, sysPct: 0, iowaitPct: 0 }
  const pct = (v: number) => Math.max(0, Math.min(100, (v / dTotal) * 100))
  return {
    usagePct: pct(dTotal - (b.idle - a.idle)),
    userPct: pct(b.user - a.user),
    sysPct: pct(b.system - a.system),
    iowaitPct: pct(b.iowait - a.iowait),
  }
}

function readMemory() {
  try {
    const raw = fs.readFileSync("/proc/meminfo", "utf8")
    const get = (k: string): number => {
      const m = raw.match(new RegExp(`^${k}:\\s+(\\d+) kB`, "m"))
      return m ? Number(m[1]) * 1024 : 0
    }
    const total = get("MemTotal")
    const available = get("MemAvailable")
    const cached = get("Cached") + get("SReclaimable") + get("Buffers")
    const swapTotal = get("SwapTotal")
    const swapFree = get("SwapFree")
    const used = Math.max(total - available, 0)
    return {
      total,
      used,
      available,
      cached,
      usedPct: total ? (used / total) * 100 : 0,
      swapTotal,
      swapUsed: Math.max(swapTotal - swapFree, 0),
      swapPct: swapTotal ? ((swapTotal - swapFree) / swapTotal) * 100 : 0,
    }
  } catch {
    const total = os.totalmem()
    const free = os.freemem()
    return {
      total,
      used: total - free,
      available: free,
      cached: 0,
      usedPct: total ? ((total - free) / total) * 100 : 0,
      swapTotal: 0,
      swapUsed: 0,
      swapPct: 0,
    }
  }
}

async function readDisks() {
  try {
    const { stdout } = await execAsync("df -kPT", { timeout: 3000 })
    return stdout
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => {
        const cols = line.trim().split(/\s+/)
        // Filesystem Type 1024-blocks Used Available Capacity Mounted
        if (cols.length < 7) return null
        const totalKb = Number(cols[2])
        const usedKb = Number(cols[3])
        return {
          fs: cols[0],
          type: cols[1],
          totalBytes: totalKb * 1024,
          usedBytes: usedKb * 1024,
          availBytes: Number(cols[4]) * 1024,
          usedPct:
            Number(String(cols[5]).replace("%", "")) ||
            (totalKb ? (usedKb / totalKb) * 100 : 0),
          mount: cols.slice(6).join(" "),
        }
      })
      .filter(
        (d): d is NonNullable<typeof d> =>
          d !== null &&
          !IGNORED_FS_TYPES.has(d.type) &&
          !d.fs.startsWith("ossfs") &&
          d.totalBytes > 1024 * 1024 &&
          d.totalBytes < MAX_DISK_BYTES
      )
  } catch {
    return []
  }
}

async function readPorts() {
  try {
    const { stdout } = await execAsync("ss -tlnp", { timeout: 3000 })
    return stdout
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => {
        const cols = line.trim().split(/\s+/)
        // State Recv-Q Send-Q Local:Port Peer:Port [Process]
        const local = cols[3] ?? ""
        const lastColon = local.lastIndexOf(":")
        const addr = lastColon >= 0 ? local.slice(0, lastColon) : local
        const port = lastColon >= 0 ? Number(local.slice(lastColon + 1)) : 0
        if (!port) return null
        const procPart = cols.slice(6).join(" ")
        const procMatch = procPart.match(/users:\(\("([^"]+)"/)
        return {
          proto: "tcp",
          state: cols[0] === "LISTEN" ? "listening" : (cols[0] ?? "—"),
          addr: addr || "*",
          port,
          process: procMatch?.[1] ?? "",
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .sort((a, b) => a.port - b.port)
  } catch {
    return []
  }
}

async function readProcesses() {
  try {
    const { stdout } = await execAsync("ps aux --sort=-%cpu | head -16", { timeout: 3000 })
    return stdout
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => {
        const cols = line.trim().split(/\s+/, 11)
        if (cols.length < 11) return null
        return {
          user: cols[0],
          pid: Number(cols[1]),
          cpu: Number(cols[2]) || 0,
          mem: Number(cols[3]) || 0,
          command: cols[10],
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
  } catch {
    return []
  }
}

async function countProcesses(): Promise<number> {
  try {
    const { stdout } = await execAsync("ps ax --no-headers | wc -l", { timeout: 3000 })
    return Math.max(Number(stdout.trim()) - 1, 0)
  } catch {
    return 0
  }
}

async function getDevServerInfo(ports: { port: number }[]) {
  const running = ports.some((p) => p.port === 3000)
  if (!running) return { running: false, pid: null, uptimeSec: null }
  try {
    const { stdout } = await execAsync("pgrep -f 'next-server' | head -1", { timeout: 2000 })
    const pid = Number(stdout.trim().split("\n")[0]) || null
    let uptimeSec: number | null = null
    if (pid) {
      try {
        const { stdout: et } = await execAsync(`ps -o etimes= -p ${pid}`, { timeout: 2000 })
        uptimeSec = Number(et.trim()) || null
      } catch {
        /* etimes unsupported */
      }
    }
    return { running, pid, uptimeSec }
  } catch {
    return { running, pid: null, uptimeSec: null }
  }
}

async function getPrimaryIp(): Promise<string> {
  try {
    const { stdout } = await execAsync(
      "hostname -I 2>/dev/null | awk '{print $1}'",
      { timeout: 2000 }
    )
    const ip = stdout.trim()
    return ip || "127.0.0.1"
  } catch {
    return "127.0.0.1"
  }
}

function getPackageVersion(name: string): string {
  try {
    const raw = fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8")
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> }
    const v = pkg.dependencies?.[name]
    return v ? v.replace(/^[\^~>=<]+/, "") : "—"
  } catch {
    return "—"
  }
}

async function getBunVersion(): Promise<string> {
  try {
    const { stdout } = await execAsync("bun --version", { timeout: 2000 })
    return stdout.trim() || "—"
  } catch {
    return "—"
  }
}

function getWorklogStats() {
  try {
    const p = path.join(PROJECT_ROOT, "worklog.md")
    const stat = fs.statSync(p)
    const content = fs.readFileSync(p, "utf8")
    return {
      worklogBytes: stat.size,
      worklogLines: content.split("\n").length,
      lastLogAt: stat.mtime.toISOString(),
    }
  } catch {
    return { worklogBytes: 0, worklogLines: 0, lastLogAt: null }
  }
}

export async function GET() {
  const startedAt = Date.now()
  try {
    const [cpu, disks, ports, processes, processCount, ip, bunVersion] = await Promise.all([
      measureCpu(),
      readDisks(),
      readPorts(),
      readProcesses(),
      countProcesses(),
      getPrimaryIp(),
      getBunVersion(),
    ])

    const serverInfo = await getDevServerInfo(ports)

    // database health
    const dbPath = path.join(PROJECT_ROOT, "db", "custom.db")
    let database: { ok: boolean; sizeBytes: number; error?: string } = {
      ok: false,
      sizeBytes: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
    }
    try {
      await db.$queryRaw`SELECT 1`
      database = { ok: true, sizeBytes: database.sizeBytes }
    } catch (err) {
      database = {
        ...database,
        ok: false,
        error: err instanceof Error ? err.message.slice(0, 120) : "خطای دیتابیس",
      }
    }

    const cpus = os.cpus()
    const memory = readMemory()
    const worklog = getWorklogStats()

    return NextResponse.json(
      {
        ok: true,
        timestamp: new Date().toISOString(),
        responseMs: Math.max(Date.now() - startedAt, 0),
        system: {
          hostname: os.hostname(),
          platform: os.platform(),
          arch: os.arch(),
          kernel: os.release(),
          osRelease: os.type(),
          cpuModel: cpus[0]?.model ?? "—",
          cpuCores: cpus.length,
          uptimeSec: Math.floor(os.uptime()),
          loadAvg: os.loadavg() as [number, number, number],
          nodeVersion: process.version.replace("v", ""),
          bunVersion,
          nextVersion: getPackageVersion("next"),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          ip,
        },
        cpu,
        memory,
        disks,
        ports,
        processes,
        processCount,
        services: {
          web: serverInfo,
          gateway: { running: ports.some((p) => p.port === 81) },
          database,
        },
        project: {
          ...worklog,
          dbBytes: fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0,
        },
      },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "خطای ناشناخته سرور",
        timestamp: new Date().toISOString(),
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    )
  }
}
