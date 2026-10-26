import { useCallback, useEffect, useState } from 'react'

interface InstallPromptEvent extends Event {
  readonly platforms: string[]
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  prompt: () => Promise<void>
}

let deferredPrompt: InstallPromptEvent | null = null
const listeners = new Set<(available: boolean) => void>()

function notifyListeners() {
  const available = Boolean(deferredPrompt)
  for (const listener of listeners) listener(available)
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault()
    deferredPrompt = event as InstallPromptEvent
    notifyListeners()
  })
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null
    notifyListeners()
  })
}

export function useInstallPrompt() {
  const [available, setAvailable] = useState(Boolean(deferredPrompt))

  useEffect(() => {
    listeners.add(setAvailable)
    setAvailable(Boolean(deferredPrompt))
    return () => {
      listeners.delete(setAvailable)
    }
  }, [])

  const promptInstall = useCallback(async () => {
    const event = deferredPrompt
    if (!event) return false
    deferredPrompt = null
    notifyListeners()
    await event.prompt()
    const choice = await event.userChoice
    return choice.outcome === 'accepted'
  }, [])

  return { available, promptInstall }
}

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean }
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    navigatorWithStandalone.standalone === true
  )
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // offline support is optional
    })
  })
}

export interface PushSubscriptionPayload {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (!pushSupported()) return 'unsupported'
  return Notification.permission
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index)
  }
  return bytes
}

async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Этот браузер не поддерживает фоновые уведомления.')
  }
  const existing = await navigator.serviceWorker.getRegistration('/')
  if (!existing) await navigator.serviceWorker.register('/sw.js')
  return navigator.serviceWorker.ready
}

export async function subscribeToPush(publicKey: string): Promise<PushSubscriptionPayload> {
  if (!pushSupported()) {
    throw new Error('Этот браузер не поддерживает push-уведомления.')
  }
  if (!publicKey) throw new Error('Сервер не выдал ключ push-уведомлений.')
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Уведомления заблокированы в настройках браузера. Разрешите их для сайта и попробуйте снова.'
        : 'Без разрешения на уведомления push не включить.',
    )
  }
  const registration = await activeRegistration()
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }
  const json = subscription.toJSON() as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  }
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
    throw new Error('Браузер вернул неполную push-подписку.')
  }
  return { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }
}

export async function unsubscribeFromPush(): Promise<string | null> {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration('/')
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return null
  const endpoint = subscription.endpoint
  await subscription.unsubscribe()
  return endpoint
}

export async function currentPushEndpoint(): Promise<string | null> {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration('/')
  const subscription = await registration?.pushManager.getSubscription()
  return subscription?.endpoint || null
}
