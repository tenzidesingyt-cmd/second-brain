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
