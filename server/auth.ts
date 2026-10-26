import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { OWNER_USER_ID, db } from './db'
import { getUserById, type PublicUser } from './users'
import { runAsUser } from './userContext'

export const SESSION_COOKIE = 'brain_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

declare global {
  namespace Express {
    interface Request {
      user?: PublicUser
    }
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

const failedAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 20
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000

export function isPasswordEnabled(): boolean {
  return Boolean((process.env.APP_PASSWORD || '').trim())
}

export function isGoogleEnabled(): boolean {
  return Boolean(
    (process.env.GOOGLE_CLIENT_ID || '').trim() && (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
  )
}

export function isTelegramEnabled(): boolean {
  return Boolean((process.env.TELEGRAM_BOT_TOKEN || '').trim())
}

export function isAuthRequired(): boolean {
  return isPasswordEnabled() || isGoogleEnabled() || isTelegramEnabled()
}

export function getGoogleConfig() {
  return {
    clientId: (process.env.GOOGLE_CLIENT_ID || '').trim(),
    clientSecret: (process.env.GOOGLE_CLIENT_SECRET || '').trim(),
    ownerEmail: (process.env.OWNER_EMAIL || '').trim(),
  }
}

export function isOwnerEmail(email: string): boolean {
  const owner = getGoogleConfig().ownerEmail.toLowerCase()
  return Boolean(owner) && email.trim().toLowerCase() === owner
}

export function getTelegramBotUsername(): string | null {
  const configured = (process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, '')
  if (configured) return configured
  const found = db.prepare(`SELECT value FROM settings WHERE key = 'telegram_bot_username'`).get() as
    | { value: string }
    | undefined
  return found?.value?.replace(/^@/, '') || null
}

interface SessionUserRow {
  user_id: string
  expires_at: number
  role: string
  disabled: number
}

export function createSession(userId: string): string {
  const token = randomBytes(32).toString('hex')
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    Date.now() + SESSION_TTL_MS,
    new Date().toISOString(),
  )
  return token
}

export function getSessionUser(token: string | undefined | null): PublicUser | null {
  if (!token) return null
  const tokenHash = hashToken(token)
  const found = db
    .prepare(
      `SELECT s.user_id, s.expires_at, u.role, u.disabled
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as SessionUserRow | undefined
  if (!found) return null
  if (Number(found.expires_at) < Date.now() || Number(found.disabled) === 1) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
    return null
  }
  return getUserById(found.user_id)
}

export function isSessionValid(token: string | undefined | null): boolean {
  return Boolean(getSessionUser(token))
}

export function destroySession(token: string | undefined | null): void {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
}

export function sessionUserFromCookieHeader(cookieHeader: string | undefined): PublicUser | null {
  if (!isAuthRequired()) return getUserById(OWNER_USER_ID)
  if (!cookieHeader) return null
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))
  return getSessionUser(match?.[1])
}

export function isAuthenticated(req: Request): boolean {
  if (!isAuthRequired()) return true
  return Boolean(req.user)
}

export function attachUserContext(req: Request, res: Response, next: NextFunction): void {
  const user = sessionUserFromCookieHeader(req.headers.cookie)
  if (!user) {
    next()
    return
  }
  req.user = user
  runAsUser(user.id, next)
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthRequired()) {
    next()
    return
  }
  if (!req.user) {
    res.status(401).json({ error: 'Требуется вход в приложение.' })
    return
  }
  next()
}

export function requireOwner(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'owner') {
    res.status(403).json({ error: 'Это действие доступно только владельцу кабинета.' })
    return
  }
  next()
}

export function checkLoginAllowed(ip: string): boolean {
  const entry = failedAttempts.get(ip)
  if (!entry) return true
  if (entry.resetAt < Date.now()) {
    failedAttempts.delete(ip)
    return true
  }
  return entry.count < MAX_ATTEMPTS
}

export function registerFailedLogin(ip: string): void {
  const entry = failedAttempts.get(ip)
  if (!entry || entry.resetAt < Date.now()) {
    failedAttempts.set(ip, { count: 1, resetAt: Date.now() + ATTEMPT_WINDOW_MS })
    return
  }
  entry.count += 1
}

export function clearFailedLogins(ip: string): void {
  failedAttempts.delete(ip)
}

export function verifyPassword(input: string): boolean {
  const expected = (process.env.APP_PASSWORD || '').trim()
  if (!expected) return false
  if (typeof input !== 'string') return false
  const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest()
  return timingSafeEqual(hash(input), hash(expected))
}

export function sessionCookieOptions(req?: Request) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: Boolean(req?.secure),
    path: '/',
    maxAge: SESSION_TTL_MS,
  }
}
