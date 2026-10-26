import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { db } from './db'

export const SESSION_COOKIE = 'brain_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000

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

export function isAuthRequired(): boolean {
  return isPasswordEnabled() || isGoogleEnabled()
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

export function createSession(): string {
  const token = randomBytes(32).toString('hex')
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now())
  db.prepare('INSERT INTO sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)').run(
    hashToken(token),
    Date.now() + SESSION_TTL_MS,
    new Date().toISOString(),
  )
  return token
}

export function isSessionValid(token: string | undefined | null): boolean {
  if (!token) return false
  const tokenHash = hashToken(token)
  const found = db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(tokenHash) as
    | { expires_at: number }
    | undefined
  if (!found) return false
  if (Number(found.expires_at) < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
    return false
  }
  return true
}

export function destroySession(token: string | undefined | null): void {
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
}

export function isAuthenticated(req: Request): boolean {
  if (!isAuthRequired()) return true
  return isSessionValid(req.cookies?.[SESSION_COOKIE])
}

export function isAuthorizedCookieHeader(cookieHeader: string | undefined): boolean {
  if (!isAuthRequired()) return true
  if (!cookieHeader) return false
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))
  return isSessionValid(match?.[1])
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthenticated(req)) {
    res.status(401).json({ error: 'Требуется вход в приложение.' })
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
