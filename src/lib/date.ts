import {
  addDays,
  addMonths,
  format,
  formatDistanceToNowStrict,
  isSameDay,
  isSameMonth,
  isToday,
  isTomorrow,
  isYesterday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { ru } from 'date-fns/locale'

export const WEEK_STARTS_ON = 1 as const

export function parseLocal(value: string | Date | null | undefined): Date | null {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return parseISO(`${value}T00:00:00`)
  const parsed = parseISO(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function todayIso(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function currentTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function capitalize(value: string): string {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value
}

export function formatDateLabel(value: string): string {
  const date = parseLocal(value)
  if (!date) return ''
  if (isToday(date)) return 'Сегодня'
  if (isYesterday(date)) return 'Вчера'
  return format(date, 'd MMMM', { locale: ru })
}

export function formatDateShort(value: string | Date | null | undefined): string {
  const date = parseLocal(value)
  return date ? format(date, 'd MMM', { locale: ru }).replace('.', '') : ''
}

export function formatDayMonth(date: Date): string {
  return format(date, 'd MMMM', { locale: ru })
}

export function formatMonthTitle(date: Date): string {
  return capitalize(format(date, 'LLLL yyyy', { locale: ru }))
}

export function formatFullDate(value: string | Date | null | undefined): string {
  const date = parseLocal(value)
  return date ? capitalize(format(date, 'd MMMM, EEEE', { locale: ru })) : ''
}

export function formatWeekdayShort(date: Date): string {
  return format(date, 'EEEEEE', { locale: ru }).replace('.', '')
}

export function formatWeekdayLong(date: Date): string {
  return format(date, 'EEEE', { locale: ru })
}

export function formatTime(value: string | null | undefined): string {
  const date = parseLocal(value)
  return date ? format(date, 'HH:mm') : ''
}

export function formatWeekRange(start: string | Date, end: string | Date): string {
  const first = parseLocal(start)
  const last = parseLocal(end)
  if (!first || !last) return ''
  if (isSameMonth(first, last)) {
    return `${format(first, 'd', { locale: ru })}–${format(last, 'd MMMM', { locale: ru })}`
  }
  return `${formatDateShort(first)} – ${formatDateShort(last)}`
}

export function formatDueLabel(dueDate: string | null, dueTime: string | null): string {
  if (!dueDate) return ''
  const date = parseLocal(dueDate)
  if (!date) return ''
  const base = isToday(date)
    ? 'Сегодня'
    : isTomorrow(date)
      ? 'Завтра'
      : isYesterday(date)
        ? 'Вчера'
        : format(date, 'd MMM', { locale: ru }).replace('.', '')
  return dueTime ? `${base}, ${dueTime}` : base
}

export function formatRelative(value: string): string {
  const date = parseLocal(value)
  if (!date) return ''
  return formatDistanceToNowStrict(date, { addSuffix: true, locale: ru })
}

export function weekStart(date: Date = new Date()): Date {
  return startOfWeek(date, { weekStartsOn: WEEK_STARTS_ON })
}

export function weekEnd(date: Date = new Date()): Date {
  return addDays(weekStart(date), 6)
}

export function iso(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

export function monthGridStart(month: Date): Date {
  return startOfWeek(startOfMonth(month), { weekStartsOn: WEEK_STARTS_ON })
}

export function nextMonth(date: Date): Date {
  return addMonths(date, 1)
}

export function previousMonth(date: Date): Date {
  return subMonths(date, 1)
}

export function isSameDayValue(a: string | Date, b: string | Date): boolean {
  const first = parseLocal(a)
  const second = parseLocal(b)
  return Boolean(first && second && isSameDay(first, second))
}

export function weekdayDate(base: Date, weekdayIndex: number): Date {
  return addDays(weekStart(base), weekdayIndex)
}

export function pluralRu(count: number, one: string, few: string, many: string): string {
  const abs = Math.abs(count) % 100
  const last = abs % 10
  if (abs > 10 && abs < 20) return many
  if (last > 1 && last < 5) return few
  if (last === 1) return one
  return many
}

export function tasksWord(count: number): string {
  return pluralRu(count, 'задача', 'задачи', 'задач')
}

export function notesWord(count: number): string {
  return pluralRu(count, 'заметка', 'заметки', 'заметок')
}

export function entriesWord(count: number): string {
  return pluralRu(count, 'запись', 'записи', 'записей')
}

export function humanFileSize(bytes: number): string {
  if (!bytes) return '0 Б'
  const units = ['Б', 'КБ', 'МБ', 'ГБ']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

export function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_~\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
