import { Router } from 'express'
import {
  generateWeeklySummary,
  getAiSettingsInfo,
  runAiSearch,
  saveAiSettings,
  testAiConnection,
} from '../ai'
import {
  getWeekAnalytics,
  listEvents,
  listHabits,
  listInbox,
  listNotes,
  listTasks,
  searchAll,
} from '../store'
import { startOfWeek, todayInTz, validDate } from '../utils'
import { broadcast } from '../realtime'

const router = Router()

function sanitizeTz(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9_+\-/]{1,64}$/.test(raw) ? raw : 'UTC'
}

router.get('/settings/ai', (_req, res) => {
  res.json(getAiSettingsInfo())
})

router.put('/settings/ai', (req, res) => {
  const body = req.body || {}
  const info = saveAiSettings({
    apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
    textModel: typeof body.textModel === 'string' ? body.textModel : undefined,
    visionModel: typeof body.visionModel === 'string' ? body.visionModel : undefined,
    sttModel: typeof body.sttModel === 'string' ? body.sttModel : undefined,
    clearKey: Boolean(body.clearKey),
  })
  res.json(info)
})

router.post('/settings/ai/test', async (_req, res) => {
  try {
    res.json(await testAiConnection())
  } catch (error) {
    res.json({
      ok: false,
      message: error instanceof Error ? error.message : 'Не удалось подключиться к ИИ.',
      model: getAiSettingsInfo().text_model,
    })
  }
})

router.get('/export', (_req, res) => {
  const stamp = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="second-brain-${stamp}.json"`)
  res.send(
    JSON.stringify(
      {
        app: 'second-brain',
        version: 1,
        exported_at: new Date().toISOString(),
        notes: listNotes(),
        tasks: listTasks(),
        habits: listHabits(),
        events: listEvents(),
        inbox: listInbox(),
      },
      null,
      2,
    ),
  )
})

router.get('/search', (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : ''
  res.json(searchAll(query))
})

router.post('/search/ai', async (req, res) => {
  const query = typeof req.body?.query === 'string' ? req.body.query.trim().slice(0, 500) : ''
  if (!query) {
    res.status(400).json({ error: 'Введите поисковый запрос.' })
    return
  }
  try {
    res.json(await runAiSearch(query))
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'ИИ не смог выполнить поиск.',
    })
  }
})

router.get('/analytics/week', (req, res) => {
  const tz = sanitizeTz(req.query.tz)
  const requested = validDate(req.query.weekStart)
  const weekStart = requested ? startOfWeek(requested) : startOfWeek(todayInTz(tz))
  res.json(getWeekAnalytics(weekStart, tz))
})

router.post('/analytics/summary', async (req, res) => {
  const tz = sanitizeTz(req.body?.tz)
  const requested = validDate(req.body?.weekStart)
  const weekStart = requested ? startOfWeek(requested) : startOfWeek(todayInTz(tz))
  try {
    const summary = await generateWeeklySummary(weekStart, tz)
    broadcast('analytics:changed', { weekStart })
    res.json(summary)
  } catch (error) {
    res.status(502).json({
      error: error instanceof Error ? error.message : 'Не удалось собрать сводку.',
    })
  }
})

export default router
