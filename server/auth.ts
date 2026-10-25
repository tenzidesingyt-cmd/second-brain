import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

export const SESSION_COOKIE = 'brain_session'
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const sessions = new Map<string, number>()

const failedAttempts = new Map<string, { count: number; resetAt: number }>()
const MAX_ATTEMPTS = 20
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000

export function isAuthRequired(): boolean {
  return Boolean((process.env.APP_PASSWORD || '').trim())
}

export function createSession(): string {
  const token = randomBytes(32).toString('hex')
  sessions.set(token, Date.now() + SESSION_TTL_MS)
  return token
}

export function isSessionValid(token: string | undefined | null): boolean {
  if (!token) return false
  const expiresAt = sessions.get(token)
  if (!expiresAt) return false
  if (expiresAt < Date.now()) {
    sessions.delete(token)
    return false
  }
  return true
}

export function destroySession(token: string | undefined | null): void {
  if (token) sessions.delete(token)
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
  if (!expected) return true
  if (typeof input !== 'string') return false
  const hash = (value: string) => createHash('sha256').update(value, 'utf8').digest()
  return timingSafeEqual(hash(input), hash(expected))
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: false,
    path: '/',
    maxAge: SESSION_TTL_MS,
  }
}
