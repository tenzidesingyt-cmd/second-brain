import type { Server as HttpServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { sessionUserFromCookieHeader } from './auth'
import { tryCurrentUserId } from './userContext'

type AuthedSocket = WebSocket & { isAlive?: boolean; userId?: string }

let wss: WebSocketServer | null = null

export function attachRealtime(server: HttpServer): void {
  wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost')
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    const user = sessionUserFromCookieHeader(request.headers.cookie)
    if (!user) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss?.handleUpgrade(request, socket, head, (client) => {
      ;(client as AuthedSocket).userId = user.id
      wss?.emit('connection', client, request)
    })
  })

  wss.on('connection', (client) => {
    const socket = client as AuthedSocket
    socket.isAlive = true
    socket.on('pong', () => {
      socket.isAlive = true
    })
    socket.on('error', () => {
      // Connection errors are expected when devices sleep; clients reconnect.
    })
    socket.send(JSON.stringify({ type: 'connected', payload: {}, at: new Date().toISOString() }))
  })

  const heartbeat = setInterval(() => {
    for (const client of wss?.clients || []) {
      const socket = client as AuthedSocket
      if (socket.isAlive === false) {
        socket.terminate()
        continue
      }
      socket.isAlive = false
      socket.ping()
    }
  }, 25_000)

  wss.on('close', () => clearInterval(heartbeat))
}

export function broadcast(type: string, payload: Record<string, unknown> = {}): void {
  if (!wss) return
  const userId = tryCurrentUserId()
  if (!userId) return
  const message = JSON.stringify({ type, payload, at: new Date().toISOString() })
  for (const client of wss.clients) {
    const socket = client as AuthedSocket
    if (socket.userId === userId && socket.readyState === WebSocket.OPEN) {
      socket.send(message)
    }
  }
}

export function broadcastAll(type: string, payload: Record<string, unknown> = {}): void {
  if (!wss) return
  const message = JSON.stringify({ type, payload, at: new Date().toISOString() })
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  }
}
