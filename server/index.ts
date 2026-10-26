import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import os from 'node:os'
import express from 'express'
import cookieParser from 'cookie-parser'
import multer from 'multer'
import { projectRoot } from './db'
import {
  SESSION_COOKIE,
  checkLoginAllowed,
  clearFailedLogins,
  createSession,
  destroySession,
  isAuthRequired,
  isAuthenticated,
  isGoogleEnabled,
  isPasswordEnabled,
  registerFailedLogin,
  requireAuth,
  sessionCookieOptions,
  verifyPassword,
} from './auth'
import authRouter from './routes/auth'
import { attachRealtime } from './realtime'
import { resetStuckInbox } from './ai'
import inboxRouter from './routes/inbox'
import notesRouter from './routes/notes'
import tasksRouter from './routes/tasks'
import habitsRouter from './routes/habits'
import eventsRouter from './routes/events'
import systemRouter from './routes/system'
import filesRouter from './routes/files'

const app = express()
const server = http.createServer(app)
const port = Number(process.env.PORT) || 8787

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(cookieParser())
app.use(express.json({ limit: '2mb' }))

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() })
})

app.get('/api/auth/me', (req, res) => {
  res.json({
    auth_required: isAuthRequired(),
    authenticated: isAuthenticated(req),
    google_enabled: isGoogleEnabled(),
    password_enabled: isPasswordEnabled(),
  })
})

app.post('/api/auth/login', (req, res) => {
  if (!isPasswordEnabled()) {
    res.status(400).json({ error: 'Вход по паролю отключён. Используйте вход через Google.' })
    return
  }
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  if (!checkLoginAllowed(ip)) {
    res.status(429).json({ error: 'Слишком много попыток. Подождите 10 минут.' })
    return
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : ''
  if (!verifyPassword(password)) {
    registerFailedLogin(ip)
    res.status(401).json({ error: 'Неверный пароль.' })
    return
  }
  clearFailedLogins(ip)
  const token = createSession()
  res.cookie(SESSION_COOKIE, token, sessionCookieOptions(req))
  res.json({ ok: true })
})

app.post('/api/auth/logout', (req, res) => {
  destroySession(req.cookies?.[SESSION_COOKIE])
  res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax' })
  res.json({ ok: true })
})

app.use('/api/auth', authRouter)

app.use('/api', requireAuth)
app.use('/api/inbox', inboxRouter)
app.use('/api/notes', notesRouter)
app.use('/api/tasks', tasksRouter)
app.use('/api/habits', habitsRouter)
app.use('/api/events', eventsRouter)
app.use('/api', filesRouter)
app.use('/api', systemRouter)

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'API-метод не найден.' })
})

const distDir = path.join(projectRoot, 'dist')
if (fs.existsSync(distDir)) {
  app.use(
    express.static(distDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (/sw\.js$|manifest\.webmanifest$/.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache')
        }
      },
    }),
  )
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/ws')) {
      next()
      return
    }
    if (!req.accepts('html')) {
      next()
      return
    }
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.use(
  (
    error: Error & { code?: string; name?: string },
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (error instanceof multer.MulterError) {
      const message =
        error.code === 'LIMIT_FILE_SIZE'
          ? 'Файл слишком большой. Лимит — 200 МБ.'
          : error.code === 'LIMIT_FILE_COUNT'
            ? 'Слишком много файлов за один раз (максимум 10).'
            : 'Не удалось загрузить файл.'
      res.status(400).json({ error: message })
      return
    }
    if (error && (error as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Некорректный JSON в запросе.' })
      return
    }
    console.error('[server]', error)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Внутренняя ошибка сервера.' })
    }
  },
)

attachRealtime(server)
resetStuckInbox()

function localAddresses(): string[] {
  const addresses: string[] = []
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push(entry.address)
    }
  }
  return addresses
}

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`\nПорт ${port} уже занят. Измените PORT в .env или закройте другой процесс.\n`)
    process.exit(1)
  }
  throw error
})

server.listen(port, '0.0.0.0', () => {
  const webPort = fs.existsSync(distDir) ? port : 5173
  console.log('')
  console.log('  Второй мозг — сервер запущен')
  console.log(`  Приложение:  http://localhost:${webPort}`)
  for (const address of localAddresses()) {
    console.log(`  С телефона:  http://${address}:${webPort}`)
  }
  console.log(`  API:         http://localhost:${port}/api`)
  if (isPasswordEnabled()) console.log('  Вход по паролю включён (APP_PASSWORD).')
  if (isGoogleEnabled()) {
    console.log('  Вход через Google включён.')
  } else if (isAuthRequired()) {
    console.log('  Google-вход не настроен: задайте GOOGLE_CLIENT_ID и GOOGLE_CLIENT_SECRET.')
  }
  console.log('')
})
