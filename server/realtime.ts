import type { Server as HttpServer } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { isAuthorizedCookieHeader } from './auth'

let wss: WebSocketServer | null = null

export function attachRealtime(server: HttpServer): void {
  wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '/', 'http://localhost')
    if (url.pathname !== '/ws') {
      socket.destroy()
      return
    }
    if (!isAuthorizedCookieHeader(request.headers.cookie)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    wss?.handleUpgrade(request, socket, head, (client) => {
      wss?.emit('connection', client, request)
    })
  })

  wss.on('connection', (client) => {
    const socket = client as WebSocket & { isAlive?: boolean }
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
      const socket = client as WebSocket & { isAlive?: boolean }
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
  const message = JSON.stringify({ type, payload, at: new Date().toISOString() })
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message)
    }
  }
}
