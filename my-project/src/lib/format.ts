export function faNum(
  n: number | string | null | undefined,
  opts: Intl.NumberFormatOptions = {}
): string {
  if (n === null || n === undefined || n === "") return "—"
  const value = typeof n === "number" ? n : Number(n)
  if (Number.isNaN(value)) return String(n)
  return new Intl.NumberFormat("fa-IR", {
    maximumFractionDigits: 1,
    ...opts,
  }).format(value)
}

export function faInt(n: number | string | null | undefined): string {
  return faNum(n, { maximumFractionDigits: 0 })
}

const UNITS = ["بایت", "کیلوبایت", "مگابایت", "گیگابایت", "ترابایت"]

export function fmtBytes(bytes: number | null | undefined, decimals = 1): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "—"
  if (bytes <= 0) return "۰ " + UNITS[0]
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1)
  const value = bytes / Math.pow(1024, i)
  return `${faNum(value, { maximumFractionDigits: i === 0 ? 0 : decimals })} ${UNITS[i]}`
}

export function fmtUptime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds) || seconds < 0)
    return "—"
  const total = Math.floor(seconds)
  const d = Math.floor(total / 86400)
  const h = Math.floor((total % 86400) / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (d > 0) return `${faInt(d)} روز و ${faInt(h)} ساعت`
  if (h > 0) return `${faInt(h)} ساعت و ${faInt(m)} دقیقه`
  if (m > 0) return `${faInt(m)} دقیقه و ${faInt(s)} ثانیه`
  return `${faInt(s)} ثانیه`
}

export function faDateTime(d: Date | string | number | null | undefined): string {
  if (d === null || d === undefined) return "—"
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(d))
  } catch {
    return "—"
  }
}

export function faTime(
  d: Date | string | number | null | undefined,
  withSeconds = false
): string {
  if (d === null || d === undefined) return "—"
  try {
    return new Intl.DateTimeFormat("fa-IR", {
      hour: "2-digit",
      minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" as const } : {}),
      hour12: false,
    }).format(new Date(d))
  } catch {
    return "—"
  }
}

/** tailwind text class based on percentage load */
export function pctTextClass(p: number | null | undefined): string {
  if (p === null || p === undefined) return "text-muted-foreground"
  if (p < 60) return "text-emerald-500"
  if (p < 85) return "text-amber-500"
  return "text-rose-500"
}

/** tailwind bg class based on percentage load */
export function pctBarClass(p: number | null | undefined): string {
  if (p === null || p === undefined) return "bg-muted-foreground"
  if (p < 60) return "bg-emerald-500"
  if (p < 85) return "bg-amber-500"
  return "bg-rose-500"
}
