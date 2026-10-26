import { AsyncLocalStorage } from 'node:async_hooks'

interface UserContext {
  userId: string
}

const storage = new AsyncLocalStorage<UserContext>()

export function runAsUser<T>(userId: string, fn: () => T): T {
  return storage.run({ userId }, fn)
}

export function currentUserId(): string {
  const userId = storage.getStore()?.userId
  if (!userId) throw new Error('User context is not available')
  return userId
}

export function tryCurrentUserId(): string | null {
  return storage.getStore()?.userId ?? null
}
