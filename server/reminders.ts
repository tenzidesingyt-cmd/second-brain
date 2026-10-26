import { timingSafeEqual } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import type { Request } from 'express'
import { db } from './db'
import { addDays, dateInTz, nowIso } from './utils'
import { getPublicSiteUrl } from './telegram'
import {
  listReminderRecipients,
  sendPushToUser,
  sendTelegramToUser,
  type ReminderRecipient,
} from './notifications'

const AT_TIME_WINDOW_MINUTES = 60
const DAY_BEFORE_HOUR = '09:00'
const DELIVERY_RETENTION_DAYS = 120
const GITHUB_ISSUER = 'https://token.actions.githubusercontent.com'
const githubJwks = createRemoteJWKSet(
  new URL('https://token.actions.githubusercontent.com/.well-known/jwks'),
)

interface TaskReminderRow {
  id: string
  title: string
  due_date: string
  due_time: string | null
}

interface EventReminderRow {
  id: string
  title: string
  starts_at: string
  all_day: number
  location: string | null
}

type ReminderKind = 'day_before' | 'at_time'
type EntityType = 'task' | 'event'

export interface ReminderSweepResult {
  checked: number
  delivered: number
  failed: number
  skipped: number
}

export interface ReminderMessage {
  kind: ReminderKind
  entityType: EntityType
  entityId: string
  dueKey: string
  pushTitle: string
  pushBody: string
  telegramText: string
  url: string
}

function timezoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date)
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value || 0)
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return asUtc - Math.floor(date.getTime() / 1000) * 1000
}

export function zonedWallClockToDate(date: string, time: string, timeZone: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  let timestamp = Date.UTC(year, month - 1, day, hour, minute)
  const offset = timezoneOffsetMs(new Date(timestamp), timeZone)
  timestamp -= offset
  const corrected = timezoneOffsetMs(new Date(timestamp), timeZone)
  if (corrected !== offset) timestamp += offset - corrected
  return new Date(timestamp)
}

function timeLabel(time: string | null): string {
  return time ? ` в ${time}` : ' (в течение дня)'
}

function taskMessage(task: TaskReminderRow, kind: ReminderKind): ReminderMessage {
  const url = '/tasks'
  const time = task.due_time
  if (kind === 'day_before') {
    return {
      kind,
      entityType: 'task',
      entityId: task.id,
      dueKey: `${task.due_date}T${task.due_time || 'any'}`,
      pushTitle: 'Задача на завтра',
      pushBody: `${task.title}${timeLabel(time)}`,
      telegramText: `📌 Завтра задача\n\n${task.title}${timeLabel(time)}\n\nДата: ${task.due_date}`,
      url,
    }
  }
  return {
    kind,
    entityType: 'task',
    entityId: task.id,
    dueKey: `${task.due_date}T${task.due_time || 'any'}`,
    pushTitle: 'Пора выполнить задачу',
    pushBody: `${task.title}${timeLabel(time)}`,
    telegramText: `⏰ Задача наступила\n\n${task.title}${timeLabel(time)}`,
    url,
  }
}

function eventMessage(event: EventReminderRow, kind: ReminderKind): ReminderMessage {
  const date = event.starts_at.slice(0, 10)
  const time = event.all_day ? null : event.starts_at.slice(11, 16)
  const when = event.all_day ? 'весь день' : timeLabel(time).trim()
  const place = event.location ? `\nМесто: ${event.location}` : ''
  const url = '/calendar'
  if (kind === 'day_before') {
    return {
      kind,
      entityType: 'event',
      entityId: event.id,
      dueKey: event.starts_at,
      pushTitle: 'Событие завтра',
      pushBody: `${event.title} · ${when}`,
      telegramText: `📅 Завтра событие\n\n${event.title}\n${when}${place}\nДата: ${date}`,
      url,
    }
  }
  return {
    kind,
    entityType: 'event',
    entityId: event.id,
    dueKey: event.starts_at,
    pushTitle: 'Событие начинается',
    pushBody: `${event.title} · ${when}`,
    telegramText: `⏰ Событие начинается\n\n${event.title}\n${when}${place}`,
    url,
  }
}

function delivered(userId: string, message: ReminderMessage): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM reminder_deliveries
       WHERE user_id = ? AND entity_type = ? AND entity_id = ? AND reminder_kind = ? AND due_key = ?`,
    )
    .get(userId, message.entityType, message.entityId, message.kind, message.dueKey)
  return Boolean(row)
}

function rememberDelivery(userId: string, message: ReminderMessage): void {
  db.prepare(
    `INSERT OR IGNORE INTO reminder_deliveries
       (user_id, entity_type, entity_id, reminder_kind, due_key, delivered_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(userId, message.entityType, message.entityId, message.kind, message.dueKey, nowIso())
}

async function deliver(
  recipient: ReminderRecipient,
  message: ReminderMessage,
): Promise<'sent' | 'failed' | 'skipped'> {
  if (delivered(recipient.userId, message)) return 'skipped'
  let sent = 0
  let attempted = false
  if (recipient.pushEnabled) {
    attempted = true
    try {
      const result = await sendPushToUser(recipient.userId, {
        title: message.pushTitle,
        body: message.pushBody,
        url: message.url,
        tag: `${message.entityType}-${message.entityId}-${message.kind}`,
      })
      sent += result.sent
    } catch (error) {
      console.warn('[reminders] push:', error instanceof Error ? error.message : error)
    }
  }
  if (recipient.telegramEnabled) {
    attempted = true
    try {
      const site = getPublicSiteUrl()
      const suffix = site ? `\n\nОткрыть: ${site}${message.url}` : ''
      await sendTelegramToUser(recipient.userId, `${message.telegramText}${suffix}`)
      sent += 1
    } catch (error) {
      console.warn('[reminders] telegram:', error instanceof Error ? error.message : error)
    }
  }
  if (!attempted) return 'skipped'
  if (sent > 0) {
    rememberDelivery(recipient.userId, message)
    return 'sent'
  }
  return 'failed'
}

function tasksFor(userId: string, dates: string[]): TaskReminderRow[] {
  return db
    .prepare(
      `SELECT id, title, due_date, due_time FROM tasks
       WHERE user_id = ? AND completed = 0 AND due_date IN (?, ?)`,
    )
    .all(userId, dates[0], dates[1]) as unknown as TaskReminderRow[]
}

function eventsFor(userId: string, startDate: string, endDate: string): EventReminderRow[] {
  return db
    .prepare(
      `SELECT id, title, starts_at, all_day, location FROM events
       WHERE user_id = ? AND starts_at >= ? AND starts_at < ?
       ORDER BY starts_at ASC`,
    )
    .all(userId, `${startDate}T00:00`, `${endDate}T00:00`) as unknown as EventReminderRow[]
}

function taskReminders(recipient: ReminderRecipient, now: Date): ReminderMessage[] {
  const timezone = recipient.timezone
  const today = dateInTz(now, timezone)
  const tomorrow = addDays(today, 1)
  const nowMs = now.getTime()
  const messages: ReminderMessage[] = []
  for (const task of tasksFor(recipient.userId, [today, tomorrow])) {
    const dueTime = task.due_time || '23:59'
    const dueMoment = zonedWallClockToDate(task.due_date, dueTime, timezone).getTime()
    if (recipient.dayBefore && task.due_date === tomorrow) {
      const windowStart = zonedWallClockToDate(
        addDays(task.due_date, -1),
        DAY_BEFORE_HOUR,
        timezone,
      ).getTime()
      if (nowMs >= windowStart && nowMs < dueMoment) {
        messages.push(taskMessage(task, 'day_before'))
      }
    }
    if (recipient.atTime && task.due_date === today && task.due_time) {
      const dueAt = zonedWallClockToDate(task.due_date, task.due_time, timezone).getTime()
      const windowEnd = dueAt + AT_TIME_WINDOW_MINUTES * 60_000
      if (nowMs >= dueAt && nowMs < windowEnd) {
        messages.push(taskMessage(task, 'at_time'))
      }
    }
  }
  return messages
}

function eventReminders(recipient: ReminderRecipient, now: Date): ReminderMessage[] {
  const timezone = recipient.timezone
  const today = dateInTz(now, timezone)
  const tomorrow = addDays(today, 1)
  const nowMs = now.getTime()
  const messages: ReminderMessage[] = []
  for (const event of eventsFor(recipient.userId, today, addDays(today, 2))) {
    const date = event.starts_at.slice(0, 10)
    const time = event.all_day ? '00:00' : event.starts_at.slice(11, 16)
    const startsAt = zonedWallClockToDate(date, time, timezone).getTime()
    if (recipient.dayBefore && date === tomorrow) {
      const windowStart = zonedWallClockToDate(
        addDays(date, -1),
        DAY_BEFORE_HOUR,
        timezone,
      ).getTime()
      if (nowMs >= windowStart && nowMs < startsAt) {
        messages.push(eventMessage(event, 'day_before'))
      }
    }
    if (recipient.atTime && !event.all_day && date === today) {
      const windowEnd = startsAt + AT_TIME_WINDOW_MINUTES * 60_000
      if (nowMs >= startsAt && nowMs < windowEnd) {
        messages.push(eventMessage(event, 'at_time'))
      }
    }
  }
  return messages
}

let inFlight: Promise<ReminderSweepResult> | null = null

export function collectReminderMessages(
  recipient: ReminderRecipient,
  now = new Date(),
): ReminderMessage[] {
  return [...taskReminders(recipient, now), ...eventReminders(recipient, now)]
}

async function runSweep(): Promise<ReminderSweepResult> {
  const result: ReminderSweepResult = { checked: 0, delivered: 0, failed: 0, skipped: 0 }
  const now = new Date()
  const recipients = listReminderRecipients()
  for (const recipient of recipients) {
    result.checked += 1
    const messages = collectReminderMessages(recipient, now)
    for (const message of messages) {
      const outcome = await deliver(recipient, message)
      if (outcome === 'sent') result.delivered += 1
      else if (outcome === 'failed') result.failed += 1
      else result.skipped += 1
    }
  }
  db.prepare('DELETE FROM reminder_deliveries WHERE delivered_at < ?').run(
    new Date(Date.now() - DELIVERY_RETENTION_DAYS * 86_400_000).toISOString(),
  )
  return result
}

export function sweepReminders(): Promise<ReminderSweepResult> {
  if (!inFlight) {
    inFlight = runSweep().finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

let timer: NodeJS.Timeout | null = null

export function startReminderScheduler(): void {
  if (timer) return
  const tick = () => {
    void sweepReminders().catch((error) => {
      console.error('[reminders] sweep:', error instanceof Error ? error.message : error)
    })
  }
  timer = setInterval(tick, 60_000)
  timer.unref()
  const initial = setTimeout(tick, 10_000)
  initial.unref()
  console.log('[reminders] планировщик запущен')
}

export function stopReminderScheduler(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function matchesCronSecret(request: Request): boolean {
  const secret = (process.env.REMINDER_CRON_SECRET || '').trim()
  if (!secret) return false
  const header = String(request.headers['x-reminder-key'] || '')
  return Boolean(header) && safeEqual(header, secret)
}

async function matchesGithubOidc(request: Request): Promise<boolean> {
  const audience = (process.env.REMINDER_OIDC_AUDIENCE || '').trim()
  const repository = (process.env.REMINDER_GITHUB_REPO || '').trim()
  if (!audience || !repository) return false
  const header = String(request.headers.authorization || '')
  if (!header.toLowerCase().startsWith('bearer ')) return false
  try {
    const { payload } = await jwtVerify(header.slice(7).trim(), githubJwks, {
      issuer: GITHUB_ISSUER,
      audience,
    })
    return payload.repository === repository
  } catch {
    return false
  }
}

export async function isReminderRequestAuthorized(request: Request): Promise<boolean> {
  return matchesCronSecret(request) || matchesGithubOidc(request)
}
