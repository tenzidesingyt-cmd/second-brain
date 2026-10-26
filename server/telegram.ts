import { createHash, timingSafeEqual } from 'node:crypto'
import { OWNER_USER_ID, db } from './db'
import { verifyPassword } from './auth'
import {
  bindTelegramToOwner,
  createTelegramUser,
  findUserByTelegramId,
  getUserById,
  resetTelegramPassword,
  touchLastLogin,
  updateTelegramProfile,
} from './users'
import type { PublicUser } from './users'

interface TelegramUser {
  id: number
  is_bot?: boolean
  first_name?: string
  last_name?: string
  username?: string
}

interface TelegramChat {
  id: number
  type: string
}

export interface TelegramMessage {
  message_id: number
  from?: TelegramUser
  chat?: TelegramChat
  text?: string
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

const token = () => (process.env.TELEGRAM_BOT_TOKEN || '').trim()
const apiBase = () => `https://api.telegram.org/bot${token()}/`

export function telegramSecret(): string {
  return createHash('sha256').update(`webhook:${token()}`).digest('hex').slice(0, 48)
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function isTelegramWebhookAuthorized(header: string | undefined): boolean {
  if (!token()) return false
  return Boolean(header) && safeEqual(String(header), telegramSecret())
}

export function getPublicSiteUrl(): string {
  const configured = (process.env.PUBLIC_URL || '').trim().replace(/\/+$/, '')
  if (configured) return configured
  const railway = (process.env.RAILWAY_PUBLIC_DOMAIN || '').trim()
  return railway ? `https://${railway}` : ''
}

function siteUrl(): string {
  return getPublicSiteUrl()
}

function ownerTelegramId(): string {
  return (process.env.TELEGRAM_OWNER_ID || '').trim()
}

function allowedTelegramIds(): Set<string> {
  const raw = (process.env.TELEGRAM_ALLOWED_IDS || '').trim()
  if (!raw) return new Set()
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
}

async function callApi<T = unknown>(method: string, payload?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${apiBase()}${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
    signal: AbortSignal.timeout(20_000),
  })
  const body = (await response.json().catch(() => null)) as
    | { ok?: boolean; result?: T; description?: string }
    | null
  if (!response.ok || !body?.ok) {
    throw new Error(`Telegram API ${method}: ${body?.description || response.status}`)
  }
  return body.result as T
}

export async function sendTelegramMessage(chatId: number | string, text: string): Promise<void> {
  await callApi('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  })
}

function displayName(from: TelegramUser): string {
  return [from.first_name, from.last_name].filter(Boolean).join(' ').trim() || 'Пользователь'
}

function credentialsMessage(user: PublicUser, password: string, isNew: boolean): string {
  const url = siteUrl()
  const lines = [
    isNew ? '✅ Аккаунт «Второй мозг» создан.' : '🔑 Новый пароль к вашему аккаунту.',
    '',
  ]
  if (url) lines.push(`Сайт: ${url}`, '')
  lines.push(
    `Логин: ${user.login}`,
    `Пароль: ${password}`,
    '',
    'Войдите на сайте, указав логин и пароль.',
    'Команда /password в любой момент выдаст новый пароль.',
  )
  return lines.join('\n')
}

function ownerMessage(password: string): string {
  const url = siteUrl()
  return [
    '👑 Telegram привязан к кабинету владельца.',
    '',
    ...(url ? [`Сайт: ${url}`, ''] : []),
    'Логин: owner',
    `Пароль: ${password}`,
    '',
    'Все прежние записи доступны в этом кабинете.',
    'Команда /password выдаст новый пароль владельца.',
  ].join('\n')
}

function isOwner(user: PublicUser): boolean {
  return user.role === 'owner'
}

async function issueCredentials(from: TelegramUser, existing: PublicUser | null): Promise<void> {
  const telegramId = String(from.id)
  const name = displayName(from)
  const username = from.username || null
  if (existing) {
    updateTelegramProfile(existing.id, { username, name })
    const password = resetTelegramPassword(existing.id)
    touchLastLogin(existing.id)
    const user = getUserById(existing.id) || existing
    if (isOwner(user)) {
      await sendTelegramMessage(telegramId, ownerMessage(password))
    } else {
      await sendTelegramMessage(telegramId, credentialsMessage(user, password, false))
    }
    return
  }
  const created = createTelegramUser({ telegramId, username, name })
  await sendTelegramMessage(telegramId, credentialsMessage(created.user, created.password, true))
}

async function bindOwner(from: TelegramUser, secret: string): Promise<void> {
  const expected = (process.env.APP_PASSWORD || '').trim()
  if (!expected) {
    await sendTelegramMessage(
      from.id,
      'Владелец ещё не настроил APP_PASSWORD на сервере, поэтому привязка недоступна. Используйте вход через Google.',
    )
    return
  }
  if (!verifyPassword(secret)) {
    await sendTelegramMessage(from.id, 'Неверный пароль владельца. Используйте команду /owner <пароль> в личном чате.')
    return
  }
  bindTelegramToOwner(String(from.id), { username: from.username || null, name: displayName(from) })
  const password = resetTelegramPassword(OWNER_USER_ID)
  touchLastLogin(OWNER_USER_ID)
  await sendTelegramMessage(from.id, ownerMessage(password))
}

function helpMessage(): string {
  return [
    'Второй мозг — личный кабинет.',
    '',
    '/start — получить логин и пароль',
    '/password — сбросить пароль',
    '/id — показать ваш Telegram ID',
    '/owner <пароль> — привязать кабинет владельца',
  ].join('\n')
}

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  if (!update || typeof update.update_id !== 'number') return
  const inserted = db
    .prepare('INSERT OR IGNORE INTO telegram_updates (update_id, created_at) VALUES (?, ?)')
    .run(update.update_id, new Date().toISOString())
  if (!inserted.changes) return

  db.prepare('DELETE FROM telegram_updates WHERE created_at < ?').run(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  )

  const message = update.message
  const from = message?.from
  const chat = message?.chat
  if (!message || !from || !chat || from.is_bot) return
  if (chat.type !== 'private') {
    await sendTelegramMessage(chat.id, 'Регистрация доступна только в личном чате с ботом.')
    return
  }

  const telegramId = String(from.id)
  const allowed = allowedTelegramIds()
  if (allowed.size && !allowed.has(telegramId) && telegramId !== ownerTelegramId()) {
    await sendTelegramMessage(chat.id, 'Доступ к боту ограничен. Попросите владельца добавить ваш Telegram ID.')
    return
  }

  const text = (message.text || '').trim()
  if (!text) return
  const [rawCommand, ...rest] = text.split(/\s+/)
  const command = rawCommand.startsWith('/') ? rawCommand.split('@')[0].toLowerCase() : ''
  const existing = findUserByTelegramId(telegramId)

  if (command === '/id') {
    await sendTelegramMessage(
      chat.id,
      `Ваш Telegram ID: ${telegramId}${from.username ? `\nНик: @${from.username}` : ''}`,
    )
    return
  }

  if (command === '/help') {
    await sendTelegramMessage(chat.id, helpMessage())
    return
  }

  if (command === '/owner') {
    await bindOwner(from, rest.join(' ').trim())
    return
  }

  if (telegramId === ownerTelegramId()) {
    if (existing && isOwner(existing)) {
      await issueCredentials(from, existing)
      return
    }
    bindTelegramToOwner(telegramId, { username: from.username || null, name: displayName(from) })
    const password = resetTelegramPassword(OWNER_USER_ID)
    touchLastLogin(OWNER_USER_ID)
    await sendTelegramMessage(chat.id, ownerMessage(password))
    return
  }

  if (command === '/start' || command === '/password' || command === '/login' || !command) {
    await issueCredentials(from, existing)
    return
  }

  if (existing) {
    await sendTelegramMessage(
      chat.id,
      `Вы уже зарегистрированы.\nЛогин: ${existing.login}\n\n/password — новый пароль.\n/help — список команд.`,
    )
    return
  }

  await issueCredentials(from, existing)
}

let botUsername: string | null = null

export function getCachedBotUsername(): string | null {
  return botUsername
}

function rememberBotUsername(username: string): void {
  botUsername = username
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('telegram_bot_username', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(username)
}

export async function initTelegram(): Promise<void> {
  if (!token()) return
  try {
    const me = await callApi<{ username?: string }>('getMe')
    if (me.username) rememberBotUsername(me.username)
    await callApi('setMyCommands', {
      commands: [
        { command: 'start', description: 'Получить логин и пароль' },
        { command: 'password', description: 'Сбросить пароль' },
        { command: 'id', description: 'Показать Telegram ID' },
        { command: 'help', description: 'Помощь' },
      ],
    }).catch(() => undefined)
    const url = siteUrl()
    if (!url.startsWith('https://')) {
      console.log('[telegram] PUBLIC_URL не задан — webhook не установлен, бот работает только локально.')
      return
    }
    const webhookUrl = `${url}/api/telegram/webhook`
    await callApi('setWebhook', {
      url: webhookUrl,
      secret_token: telegramSecret(),
      allowed_updates: ['message'],
      drop_pending_updates: false,
    })
    console.log(`[telegram] Бот @${me.username || '?'} подключён, webhook: ${webhookUrl}`)
  } catch (error) {
    console.error('[telegram] init:', error instanceof Error ? error.message : error)
  }
}
