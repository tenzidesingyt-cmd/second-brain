import { useEffect, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { qk } from '../lib/hooks'

const invalidateMap: Record<string, readonly (readonly string[])[]> = {
  'inbox:created': [qk.inbox, qk.analytics],
  'inbox:updated': [qk.inbox, qk.notes, qk.tasks, qk.events, qk.analytics],
  'inbox:deleted': [qk.inbox],
  'notes:changed': [qk.notes, qk.analytics],
  'tasks:changed': [qk.tasks, qk.analytics],
  'events:changed': [qk.events],
  'habits:changed': [qk.habits, qk.analytics],
  'analytics:changed': [qk.analytics],
  'ai:settings-changed': [qk.aiSettings],
}

function applyRealtimeMessage(queryClient: QueryClient, type: string) {
  const keys = invalidateMap[type]
  if (!keys) return
  for (const key of keys) {
    void queryClient.invalidateQueries({ queryKey: key })
  }
}

export function useRealtime(enabled = true): boolean {
  const queryClient = useQueryClient()
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    if (!enabled) return
    let socket: WebSocket | null = null
    let disposed = false
    let attempts = 0
    let reconnectTimer: number | undefined

    const scheduleReconnect = () => {
      if (disposed) return
      attempts += 1
      const delay = Math.min(15_000, 800 * 1.8 ** Math.min(attempts, 8))
      window.clearTimeout(reconnectTimer)
      reconnectTimer = window.setTimeout(connect, delay)
    }

    const connect = () => {
      if (disposed) return
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      socket = new WebSocket(`${protocol}//${window.location.host}/ws`)
      socket.onopen = () => {
        attempts = 0
        setConnected(true)
      }
      socket.onmessage = (event) => {
        try {
          const message = JSON.parse(String(event.data)) as { type?: string }
          if (message.type) applyRealtimeMessage(queryClient, message.type)
        } catch {
          // ignore malformed messages
        }
      }
      socket.onclose = () => {
        setConnected(false)
        if (!disposed) scheduleReconnect()
      }
      socket.onerror = () => {
        socket?.close()
      }
    }

    const onVisibility = () => {
      if (
        document.visibilityState === 'visible' &&
        (!socket || socket.readyState === WebSocket.CLOSED)
      ) {
        window.clearTimeout(reconnectTimer)
        connect()
      }
    }

    connect()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearTimeout(reconnectTimer)
      socket?.close()
    }
  }, [enabled, queryClient])

  return connected
}
