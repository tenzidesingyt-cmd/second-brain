import webpush from 'web-push'
import { db } from './db'
import { getTelegramBotUsername, isTelegramEnabled } from './auth'
import { getUserById } from './users'
import { getSetting, setSetting } from './store'
import { nowIso } from './utils'
import { sendTelegramMessage } from './telegram'
import type {
  NotificationSettingsInfo,
  NotificationSettingsPatch,
  PushSubscriptionInput,
} from '../shared/types'

interface NotificationSettingsRow {
  user_id: string
  timezone: string
  push_enabled: number
  telegram_enabled: number
  day_before: number
  at_time: number
}

interface PushSubscriptionRow {
  endpoint: string
  user_id: string
  p256dh: string
  auth: string
  user_agent: string | null
}

export interface PushPayload {
  title: string
  body: string
  url?: string
  tag?: string
}

export interface PushSendResult {
  sent: number
  failed: number
  removed: number
}

let vapidKeys: { publicKey: string; privateKey: string } | null = null

function validTimezone(value: string): string | null {
  const raw = value.trim()
  if (!raw || raw.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(raw)) return null
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw }).format(new Date())
    return raw
  } catch {
    return null
  }
}

function ensureVapid(): { publicKey: string; privateKey: string } {
  if (vapidKeys) return vapidKeys
  const envPublic = (process.env.VAPID_PUBLIC_KEY || '').trim()
  const envPrivate = (process.env.VAPID_PRIVATE_KEY || '').trim()
  let publicKey = envPublic
  let privateKey = envPrivate
  if (!publicKey || !privateKey) {
    publicKey = getSetting('push_vapid_public') || ''
    privateKey = getSetting('push_vapid_private') || ''
    if (!publicKey || !privateKey) {
      const generated = webpush.generateVAPIDKeys()
      publicKey = generated.publicKey
      privateKey = generated.privateKey
      setSetting('push_vapid_public', publicKey)
      setSetting('push_vapid_private', privateKey)
    }
  }
  const subject =
    (process.env.VAPID_SUBJECT || '').trim() || 'mailto:notifications@second-brain.app'
  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidKeys = { publicKey, privateKey }
  return vapidKeys
}

export function getPushPublicKey(): string {
  return ensureVapid().publicKey
}

function settingsRow(userId: string): NotificationSettingsRow | null {
  return (
    (db
      .prepare(
        `SELECT user_id, timezone, push_enabled, telegram_enabled, day_before, at_time
         FROM notification_settings WHERE user_id = ?`,
      )
      .get(userId) as NotificationSettingsRow | undefined) || null
  )
}

export function pushSubscriptionCount(userId: string): number {
  const row = db
    .prepare('SELECT COUNT(*) AS count FROM push_subscriptions WHERE user_id = ?')
    .get(userId) as { count: number } | undefined
  return Number(row?.count || 0)
}

export function getNotificationSettings(userId: string): NotificationSettingsInfo {
  const row = settingsRow(userId)
  const user = getUserById(userId)
  return {
    timezone: row?.timezone || 'UTC',
    push_enabled: Boolean(row?.push_enabled),
    telegram_enabled: Boolean(row?.telegram_enabled),
    day_before: row ? Boolean(row.day_before) : true,
    at_time: row ? Boolean(row.at_time) : true,
    push_public_key: getPushPublicKey(),
    push_subscriptions: pushSubscriptionCount(userId),
    telegram_available: isTelegramEnabled(),
    telegram_linked: Boolean(user?.telegram_id),
    telegram_username: user?.telegram_username || null,
    bot_username: getTelegramBotUsername(),
  }
}

export function updateNotificationSettings(
  userId: string,
  patch: NotificationSettingsPatch,
): NotificationSettingsInfo {
  const current = settingsRow(userId)
  const next = {
    timezone: current?.timezone || 'UTC',
    push_enabled: Boolean(current?.push_enabled),
    telegram_enabled: Boolean(current?.telegram_enabled),
    day_before: current ? Boolean(current.day_before) : true,
    at_time: current ? Boolean(current.at_time) : true,
  }

  if (patch.timezone !== undefined) {
    const timezone = validTimezone(patch.timezone)
    if (!timezone) throw new Error('Некорректный часовой пояс.')
    next.timezone = timezone
  }
  if (patch.push_enabled !== undefined) next.push_enabled = Boolean(patch.push_enabled)
  if (patch.telegram_enabled !== undefined) {
    next.telegram_enabled = Boolean(patch.telegram_enabled)
  }
  if (patch.day_before !== undefined) next.day_before = Boolean(patch.day_before)
  if (patch.at_time !== undefined) next.at_time = Boolean(patch.at_time)

  if (next.telegram_enabled) {
    const user = getUserById(userId)
    if (!user?.telegram_id) {
      throw new Error('Сначала привяжите Telegram: без него бот не сможет отправить сообщение.')
    }
    if (!isTelegramEnabled()) {
      throw new Error('Telegram-бот не настроен на сервере.')
    }
  }

  const timestamp = nowIso()
  if (current) {
    db.prepare(
      `UPDATE notification_settings
       SET timezone = ?, push_enabled = ?, telegram_enabled = ?, day_before = ?, at_time = ?, updated_at = ?
       WHERE user_id = ?`,
    ).run(
      next.timezone,
      next.push_enabled ? 1 : 0,
      next.telegram_enabled ? 1 : 0,
      next.day_before ? 1 : 0,
      next.at_time ? 1 : 0,
      timestamp,
      userId,
    )
  } else {
    db.prepare(
      `INSERT INTO notification_settings
         (user_id, timezone, push_enabled, telegram_enabled, day_before, at_time, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userId,
      next.timezone,
      next.push_enabled ? 1 : 0,
      next.telegram_enabled ? 1 : 0,
      next.day_before ? 1 : 0,
      next.at_time ? 1 : 0,
      timestamp,
      timestamp,
    )
  }

  return getNotificationSettings(userId)
}

function normalizeSubscription(input: PushSubscriptionInput): {
  endpoint: string
  p256dh: string
  auth: string
} {
  const endpoint = typeof input?.endpoint === 'string' ? input.endpoint.trim() : ''
  const p256dh = typeof input?.keys?.p256dh === 'string' ? input.keys.p256dh.trim() : ''
  const auth = typeof input?.keys?.auth === 'string' ? input.keys.auth.trim() : ''
  if (!endpoint || endpoint.length > 2048) throw new Error('Некорректная push-подписка.')
  let parsed: URL
  try {
    parsed = new URL(endpoint)
  } catch {
    throw new Error('Некорректный адрес push-сервиса.')
  }
  const localHttp =
    parsed.protocol === 'http:' &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1')
  if (parsed.protocol !== 'https:' && !localHttp) {
    throw new Error('Push-подписка должна использовать HTTPS.')
  }
  if (!p256dh || p256dh.length > 512 || !auth || auth.length > 256) {
    throw new Error('Некорректные ключи push-подписки.')
  }
  return { endpoint, p256dh, auth }
}

export function savePushSubscription(
  userId: string,
  input: PushSubscriptionInput,
  userAgent: string | null,
): number {
  const subscription = normalizeSubscription(input)
  const timestamp = nowIso()
  db.prepare(
    `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent, created_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET
       user_id = excluded.user_id,
       p256dh = excluded.p256dh,
       auth = excluded.auth,
       user_agent = excluded.user_agent,
       last_seen_at = excluded.last_seen_at`,
  ).run(
    subscription.endpoint,
    userId,
    subscription.p256dh,
    subscription.auth,
    userAgent,
    timestamp,
    timestamp,
  )
  return pushSubscriptionCount(userId)
}

export function removePushSubscription(userId: string, endpoint: string): number {
  if (endpoint) {
    db.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').run(
      userId,
      endpoint,
    )
  }
  return pushSubscriptionCount(userId)
}

export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<PushSendResult> {
  const subscriptions = db
    .prepare('SELECT endpoint, user_id, p256dh, auth, user_agent FROM push_subscriptions WHERE user_id = ?')
    .all(userId) as unknown as PushSubscriptionRow[]
  const result: PushSendResult = { sent: 0, failed: 0, removed: 0 }
  if (!subscriptions.length) return result
  ensureVapid()
  const body = JSON.stringify(payload)
  const timestamp = nowIso()
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        body,
        { TTL: 24 * 60 * 60, urgency: 'high' },
      )
      result.sent += 1
      db.prepare('UPDATE push_subscriptions SET last_seen_at = ? WHERE endpoint = ?').run(
        timestamp,
        subscription.endpoint,
      )
    } catch (error) {
      const status = Number((error as { statusCode?: number }).statusCode || 0)
      if (status === 404 || status === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(subscription.endpoint)
        result.removed += 1
      } else {
        result.failed += 1
        console.warn(`[push] не удалось отправить уведомление${status ? ` (${status})` : ''}`)
      }
    }
  }
  return result
}

export async function sendTelegramToUser(userId: string, text: string): Promise<boolean> {
  if (!isTelegramEnabled()) throw new Error('Telegram-бот не настроен на сервере.')
  const user = getUserById(userId)
  if (!user?.telegram_id) throw new Error('Telegram не привязан к кабинету.')
  await sendTelegramMessage(user.telegram_id, text)
  return true
}

export async function sendTestNotification(
  userId: string,
  channel: 'push' | 'telegram',
): Promise<{ sent: number; message: string }> {
  if (channel === 'push') {
    const result = await sendPushToUser(userId, {
      title: 'Второй мозг',
      body: 'Push-уведомления работают. Напоминания придут вовремя.',
      url: '/settings',
      tag: 'test-push',
    })
    if (!result.sent) {
      if (result.removed) {
        throw new Error('Подписка устарела. Включите push на этом устройстве заново.')
      }
      throw new Error('На этом устройстве нет активной push-подписки.')
    }
    return { sent: result.sent, message: 'Тестовое push-уведомление отправлено.' }
  }
  await sendTelegramToUser(
    userId,
    '🔔 Второй мозг\n\nTelegram-уведомления работают. Напоминания о задачах и событиях придут сюда.',
  )
  return { sent: 1, message: 'Тестовое сообщение отправлено в Telegram.' }
}

export interface ReminderRecipient {
  userId: string
  timezone: string
  pushEnabled: boolean
  telegramEnabled: boolean
  dayBefore: boolean
  atTime: boolean
  pushSubscriptions: number
  telegramLinked: boolean
}

export function listReminderRecipients(): ReminderRecipient[] {
  const rows = db
    .prepare(
      `SELECT ns.user_id, ns.timezone, ns.push_enabled, ns.telegram_enabled,
              ns.day_before, ns.at_time,
              (SELECT COUNT(*) FROM push_subscriptions p WHERE p.user_id = ns.user_id) AS push_count,
              u.telegram_id
       FROM notification_settings ns
       JOIN users u ON u.id = ns.user_id
       WHERE u.disabled = 0`,
    )
    .all() as unknown as {
    user_id: string
    timezone: string
    push_enabled: number
    telegram_enabled: number
    day_before: number
    at_time: number
    push_count: number
    telegram_id: string | null
  }[]

  return rows
    .map((row) => ({
      userId: row.user_id,
      timezone: validTimezone(row.timezone) || 'UTC',
      pushEnabled: Boolean(row.push_enabled) && Number(row.push_count) > 0,
      telegramEnabled:
        Boolean(row.telegram_enabled) && Boolean(row.telegram_id) && isTelegramEnabled(),
      dayBefore: Boolean(row.day_before),
      atTime: Boolean(row.at_time),
      pushSubscriptions: Number(row.push_count),
      telegramLinked: Boolean(row.telegram_id),
    }))
    .filter((row) => row.pushEnabled || row.telegramEnabled)
}
