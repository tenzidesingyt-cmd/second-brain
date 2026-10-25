import { Router } from 'express'
import { broadcast } from '../realtime'
import {
  attachFiles,
  createEvent,
  deleteEvent,
  detachFile,
  getEvent,
  listEvents,
  updateEvent,
} from '../store'
import { cleanupUploadedFiles, storeUploadedFiles, upload } from '../upload'
import { normalizeDateTime } from '../utils'

const router = Router()

router.get('/', (_req, res) => {
  res.json(listEvents())
})

router.post('/', (req, res) => {
  const body = req.body || {}
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : ''
  if (!title) {
    res.status(400).json({ error: 'Название события не может быть пустым.' })
    return
  }
  const startsAt = normalizeDateTime(body.starts_at)
  if (!startsAt) {
    res.status(400).json({ error: 'Укажите дату и время события.' })
    return
  }
  const endsAt = body.ends_at ? normalizeDateTime(body.ends_at) : null
  const event = createEvent({
    title,
    description: typeof body.description === 'string' ? body.description : '',
    starts_at: startsAt,
    ends_at: endsAt && endsAt > startsAt ? endsAt : null,
    all_day: Boolean(body.all_day),
    location: typeof body.location === 'string' ? body.location.slice(0, 200) : null,
  })
  broadcast('events:changed', { id: event.id })
  res.status(201).json(event)
})

router.patch('/:id', (req, res) => {
  const existing = getEvent(req.params.id)
  if (!existing) {
    res.status(404).json({ error: 'Событие не найдено.' })
    return
  }
  const body = req.body || {}
  const patch: Parameters<typeof updateEvent>[1] = {}
  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 200) : ''
    if (!title) {
      res.status(400).json({ error: 'Название события не может быть пустым.' })
      return
    }
    patch.title = title
  }
  if ('description' in body && typeof body.description === 'string') patch.description = body.description
  if ('starts_at' in body) {
    const startsAt = normalizeDateTime(body.starts_at)
    if (!startsAt) {
      res.status(400).json({ error: 'Некорректная дата события.' })
      return
    }
    patch.starts_at = startsAt
  }
  if ('ends_at' in body) {
    patch.ends_at = body.ends_at ? normalizeDateTime(body.ends_at) : null
  }
  if ('all_day' in body) patch.all_day = Boolean(body.all_day)
  if ('location' in body) {
    patch.location = typeof body.location === 'string' && body.location.trim()
      ? body.location.trim().slice(0, 200)
      : null
  }
  const event = updateEvent(existing.id, patch)
  broadcast('events:changed', { id: existing.id })
  res.json(event)
})

router.delete('/:id', (req, res) => {
  const event = getEvent(req.params.id)
  if (!event) {
    res.status(404).json({ error: 'Событие не найдено.' })
    return
  }
  deleteEvent(event.id)
  broadcast('events:changed', { id: event.id, deleted: true })
  res.json({ ok: true })
})

router.post('/:id/files', upload.array('files', 10), (req, res) => {
  const event = getEvent(String(req.params.id))
  const files = (req.files as Express.Multer.File[] | undefined) || []
  if (!event) {
    cleanupUploadedFiles(files)
    res.status(404).json({ error: 'Событие не найдено.' })
    return
  }
  if (!files.length) {
    res.status(400).json({ error: 'Файлы не выбраны.' })
    return
  }
  const stored = storeUploadedFiles(files)
  attachFiles('event', event.id, stored.map((file) => file.id))
  broadcast('events:changed', { id: event.id })
  res.json(getEvent(event.id))
})

router.delete('/:id/files/:fileId', (req, res) => {
  const event = getEvent(req.params.id)
  if (!event) {
    res.status(404).json({ error: 'Событие не найдено.' })
    return
  }
  detachFile('event', event.id, req.params.fileId)
  broadcast('events:changed', { id: event.id })
  res.json(getEvent(event.id))
})

export default router
