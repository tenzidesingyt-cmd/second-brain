import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { OWNER_USER_ID, db } from './db'
import { nowIso, uid } from './utils'

export type UserRole = 'owner' | 'user'

export interface PublicUser {
  id: string
  login: string
  name: string
  role: UserRole
  telegram_id: string | null
  telegram_username: string | null
  created_at: string
}

export interface UserRecord extends PublicUser {
  password_hash: string
  disabled: number
}

interface UserRow {
  id: string
  login: string
  name: string
  password_hash: string
  role: string
  telegram_id: string | null
  telegram_username: string | null
  disabled: number
  created_at: string
  last_login_at: string | null
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const RESERVED_LOGINS = new Set(['owner', 'admin', 'root', 'support', 'system', 'telegram'])
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 }

function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    login: row.login,
    name: row.name,
    role: row.role === 'owner' ? 'owner' : 'user',
    telegram_id: row.telegram_id,
    telegram_username: row.telegram_username,
    created_at: row.created_at,
  }
}

function toUserRecord(row: UserRow): UserRecord {
  return {
    ...toPublicUser(row),
    password_hash: row.password_hash,
    disabled: Number(row.disabled),
  }
}

export function normalizePassword(value: string): string {
  return value.replace(/[\s-]/g, '').toUpperCase()
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(normalizePassword(password), salt, 64, SCRYPT_OPTIONS).toString('hex')
  return `scrypt$${salt}$${hash}`
}

export function verifyUserPassword(stored: string, password: string): boolean {
  if (!stored.startsWith('scrypt$')) return false
  const [, salt, expectedHex] = stored.split('$')
  if (!salt || !expectedHex) return false
  try {
    const expected = Buffer.from(expectedHex, 'hex')
    const actual = scryptSync(normalizePassword(password), salt, expected.length, SCRYPT_OPTIONS)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

export function generatePassword(): string {
  const bytes = randomBytes(12)
  const chars = Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length])
  return [chars.slice(0, 4).join(''), chars.slice(4, 8).join(''), chars.slice(8, 12).join('')].join('-')
}

function normalizeLoginBase(username: string | null, telegramId: string): string {
  const cleaned = (username || '')
    .replace(/^@/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
  let base = cleaned.length >= 3 ? cleaned : `tg${telegramId}`
  if (RESERVED_LOGINS.has(base)) base = `${base}_${telegramId.slice(-4)}`
  return base
}

function loginTaken(login: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM users WHERE login = ?').get(login))
}

function uniqueLogin(base: string): string {
  if (!loginTaken(base)) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}_${suffix}`.slice(0, 40)
    if (!loginTaken(candidate)) return candidate
  }
  return `${base}_${randomBytes(3).toString('hex')}`
}

function getUserRowByLogin(login: string): UserRow | null {
  const found = db.prepare('SELECT * FROM users WHERE login = ?').get(login.trim()) as UserRow | undefined
  return found || null
}

export function findUserForLogin(login: string): UserRecord | null {
  const row = getUserRowByLogin(login)
  return row ? toUserRecord(row) : null
}

export function getUserById(id: string): PublicUser | null {
  const found = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  return found ? toPublicUser(found) : null
}

export function findUserRecordById(id: string): UserRecord | null {
  const found = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
  return found ? toUserRecord(found) : null
}

export function findUserByTelegramId(telegramId: string): UserRecord | null {
  const found = db.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegramId) as
    | UserRow
    | undefined
  return found ? toUserRecord(found) : null
}

export function listUsers(): PublicUser[] {
  return (
    db
      .prepare(
        `SELECT * FROM users
         ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at ASC`,
      )
      .all() as unknown as UserRow[]
  ).map(toPublicUser)
}

export function countUsers(): number {
  const found = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
  return Number(found?.count || 0)
}

export function touchLastLogin(userId: string): void {
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(nowIso(), userId)
}

export function createTelegramUser(input: {
  telegramId: string
  username: string | null
  name: string
}): { user: PublicUser; password: string } {
  const login = uniqueLogin(normalizeLoginBase(input.username, input.telegramId))
  const password = generatePassword()
  const id = uid()
  db.prepare(
    `INSERT INTO users (
       id, login, name, password_hash, role, telegram_id, telegram_username, disabled, created_at
     ) VALUES (?, ?, ?, ?, 'user', ?, ?, 0, ?)`,
  ).run(
    id,
    login,
    input.name.trim().slice(0, 120) || login,
    hashPassword(password),
    input.telegramId,
    input.username,
    nowIso(),
  )
  return { user: getUserById(id)!, password }
}

export function resetTelegramPassword(userId: string): string {
  const password = generatePassword()
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId)
  return password
}

export function updateTelegramProfile(
  userId: string,
  input: { username: string | null; name: string },
): void {
  db.prepare(
    `UPDATE users
     SET telegram_username = ?,
         name = CASE WHEN TRIM(name) = '' THEN ? ELSE name END
     WHERE id = ?`,
  ).run(input.username, input.name.trim().slice(0, 120), userId)
}

export function bindTelegramToOwner(telegramId: string, input: { username: string | null; name: string }): void {
  db.prepare('UPDATE users SET telegram_id = NULL WHERE telegram_id = ? AND id <> ?').run(
    telegramId,
    OWNER_USER_ID,
  )
  db.prepare(
    `UPDATE users
     SET telegram_id = ?, telegram_username = ?
     WHERE id = ?`,
  ).run(telegramId, input.username, OWNER_USER_ID)
  updateTelegramProfile(OWNER_USER_ID, input)
}
