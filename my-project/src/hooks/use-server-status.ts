"use client"

import { useQuery } from "@tanstack/react-query"

export interface DiskInfo {
  fs: string
  type: string
  mount: string
  totalBytes: number
  usedBytes: number
  availBytes: number
  usedPct: number
}

export interface PortInfo {
  proto: string
  state: string
  addr: string
  port: number
  process: string
}

export interface ProcessInfo {
  user: string
  pid: number
  cpu: number
  mem: number
  command: string
}

export interface SystemStatus {
  ok: boolean
  timestamp: string
  responseMs: number
  system: {
    hostname: string
    platform: string
    arch: string
    kernel: string
    osRelease: string
    cpuModel: string
    cpuCores: number
    uptimeSec: number
    loadAvg: [number, number, number]
    nodeVersion: string
    bunVersion: string
    nextVersion: string
    timezone: string
    ip: string
  }
  cpu: {
    usagePct: number
    userPct: number
    sysPct: number
    iowaitPct: number
  }
  memory: {
    total: number
    used: number
    available: number
    cached: number
    usedPct: number
    swapTotal: number
    swapUsed: number
    swapPct: number
  }
  disks: DiskInfo[]
  ports: PortInfo[]
  processes: ProcessInfo[]
  processCount: number
  services: {
    web: { running: boolean; pid: number | null; uptimeSec: number | null }
    gateway: { running: boolean }
    database: { ok: boolean; sizeBytes: number; error?: string }
  }
  project: {
    worklogBytes: number
    worklogLines: number
    dbBytes: number
    lastLogAt: string | null
  }
}

export interface LogsResponse {
  ok: boolean
  lines: string[]
  totalBytes: number
  updatedAt: string | null
}

/** rolling window of cpu/mem percentages kept outside react state (appended in queryFn) */
const MAX_HISTORY = 90
const statusHistory: { cpu: number[]; mem: number[]; lastTs: string | null } = {
  cpu: [],
  mem: [],
  lastTs: null,
}

export function getStatusHistory(): { cpuHistory: number[]; memHistory: number[] } {
  return { cpuHistory: statusHistory.cpu, memHistory: statusHistory.mem }
}

function appendHistory(snap: SystemStatus) {
  if (!snap?.timestamp || snap.timestamp === statusHistory.lastTs) return
  statusHistory.lastTs = snap.timestamp
  const clamp = (v: number) => Math.max(0, Math.min(100, v || 0))
  statusHistory.cpu = [...statusHistory.cpu, clamp(snap.cpu?.usagePct)].slice(-MAX_HISTORY)
  statusHistory.mem = [...statusHistory.mem, clamp(snap.memory?.usedPct)].slice(-MAX_HISTORY)
}

export function useSystemStatus() {
  return useQuery<SystemStatus>({
    queryKey: ["system-status"],
    queryFn: async () => {
      const res = await fetch("/api/system", { cache: "no-store" })
      if (!res.ok) throw new Error("خطا در دریافت وضعیت سرور")
      const json = (await res.json()) as SystemStatus
      appendHistory(json)
      return json
    },
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    retry: 1,
  })
}

export function useServerLogs(lines = 120) {
  return useQuery<LogsResponse>({
    queryKey: ["server-logs", lines],
    queryFn: async () => {
      const res = await fetch(`/api/logs?lines=${lines}`, { cache: "no-store" })
      if (!res.ok) throw new Error("خطا در دریافت لاگ‌ها")
      return (await res.json()) as LogsResponse
    },
    refetchInterval: 8000,
    retry: 1,
  })
}
