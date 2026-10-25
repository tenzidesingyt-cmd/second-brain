import { randomUUID } from 'node:crypto'

export const nowIso = () => new Date().toISOString()
export const uid = () => randomUUID()

export function dateInTz(date: Date, tz?: string | null): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date)
    const get = (type: string) => parts.find((p) => p.type === type)?.value || ''
    return `${get('year')}-${get('month')}-${get('day')}`
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

export function todayInTz(tz?: string | null): string {
  return dateInTz(new Date(), tz)
}

export function timeInTz(tz?: string | null): string {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: tz || 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date())
  } catch {
    return new Date().toISOString().slice(11, 16)
  }
}

export function weekdayInTz(date: string, tz?: string | null): string {
  try {
    const d = new Date(`${date}T12:00:00Z`)
    return new Intl.DateTimeFormat('ru-RU', { timeZone: tz || 'UTC', weekday: 'long' }).format(d)
  } catch {
    return ''
  }
}

export function addDays(date: string, amount: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + amount)
  return d.toISOString().slice(0, 10)
}

export function startOfWeek(date: string): string {
  const d = new Date(`${date}T12:00:00Z`)
  const day = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - day)
  return d.toISOString().slice(0, 10)
}

export function validDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10) === value ? value : null
}

export function validTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.match(/^([01]\d|2[0-3]):([0-5]\d)/)
  return match ? `${match[1]}:${match[2]}` : null
}

export function normalizeDateTime(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const match = value.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/)
  if (match) {
    const date = validDate(match[1])
    const time = validTime(`${match[2]}:${match[3]}`)
    return date && time ? `${date}T${time}` : null
  }
  const date = validDate(value)
  return date ? `${date}T09:00` : null
}

export function safeJson<T>(value: unknown, fallback: T): T {
  if (value == null) return fallback
  try {
    return JSON.parse(String(value)) as T
  } catch {
    return fallback
  }
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value
}

export function localDayOf(iso: string | null | undefined, tz?: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null
  return dateInTz(date, tz)
}

export function diffDays(a: string, b: string): number {
  const first = new Date(`${a}T12:00:00Z`).getTime()
  const second = new Date(`${b}T12:00:00Z`).getTime()
  return Math.round((first - second) / 86_400_000)
}
