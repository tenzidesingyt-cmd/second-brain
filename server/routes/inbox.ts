import { Router } from 'express'
import { transaction } from '../db'
import { broadcast } from '../realtime'
import {
  attachFiles,
  createInboxItem,
  createNote,
  createTask,
  deleteInboxItem,
  getInboxItem,
  listInbox,
  updateInboxItem,
} from '../store'
import { enqueueInbox, getAiSettingsInfo } from '../ai'
import { cleanupUploadedFiles, storeUploadedFiles, upload } from '../upload'
import { nowIso, truncate } from '../utils'
import type { AIResult, InboxType } from '../../shared/types'

const router = Router()

const STATUSES = new Set(['new', 'processing', 'done', 'failed'])

router.get('/', (req, res) => {
  const status = typeof req.query.status === 'string' && STATUSES.has(req.query.status)
    ? req.query.status
    : undefined
  res.json(listInbox(status))
})

router.post('/', upload.array('files', 10), (req, res) => {
  const text = typeof req.body?.text === 'string' ? req.body.text.trim().slice(0, 40_000) : ''
  const files = (req.files as Express.Multer.File[] | undefined) || []
  if (!text && !files.length) {
    cleanupUploadedFiles(files)
    res.status(400).json({ error: 'Добавьте текст или прикрепите файл.' })
    return
  }

  const timezoneRaw = typeof req.body?.tz === 'string' ? req.body.tz.trim() : ''
  const tz = /^[A-Za-z0-9_+\-/]{1,64}$/.test(timezoneRaw) ? timezoneRaw : 'UTC'
  const autoProcess = String(req.body?.autoProcess ?? 'true') !== 'false'
  const aiConfigured = getAiSettingsInfo().configured
  const shouldProcess = autoProcess && aiConfigured

  const stored = storeUploadedFiles(files)
  const has = (prefix: string) => stored.some((file) => file.mime.startsWith(prefix))
  const type: InboxType = has('video/')
    ? 'video'
    : has('audio/')
      ? 'audio'
      : has('image/')
        ? 'photo'
        : stored.length
          ? 'file'
          : 'text'

  const item = createInboxItem({
    text,
    type,
    tz,
    status: shouldProcess ? 'processing' : 'new',
    ai_error:
      autoProcess && !aiConfigured
        ? 'ИИ не подключён. Добавьте ключ OpenRouter в настройках, чтобы разбирать записи автоматически.'
        : null,
  })
  attachFiles('inbox', item.id, stored.map((file) => file.id))
  broadcast('inbox:created', { id: item.id })
  const fresh = getInboxItem(item.id)!
  res.status(201).json(fresh)
  if (shouldProcess) enqueueInbox(item.id)
})

router.post('/:id/process', (req, res) => {
  const item = getInboxItem(req.params.id)
  if (!item) {
    res.status(404).json({ error: 'Запись не найдена.' })
    return
  }
  if (!getAiSettingsInfo().configured) {
    res.status(400).json({ error: 'Сначала подключите ИИ в настройках.' })
    return
  }
  updateInboxItem(item.id, { status: 'processing', ai_error: null, processed_at: null })
  broadcast('inbox:updated', { id: item.id })
  res.json(getInboxItem(item.id))
  enqueueInbox(item.id)
})

router.post('/:id/convert', (req, res) => {
  const item = getInboxItem(req.params.id)
  if (!item) {
    res.status(404).json({ error: 'Запись не найдена.' })
    return
  }
  const target = req.body?.target === 'task' ? 'task' : 'note'
  const transcript = item.ai_result?.transcript || ''
  const sourceText = [item.text, transcript].filter(Boolean).join('\n\n').trim()
  const fileNames = item.files.map((file) => file.name).join(', ')
  const content = sourceText || (fileNames ? `Файлы: ${fileNames}` : 'Запись из инбокса')
  const firstLine = content.split('\n').find((line) => line.trim()) || 'Запись из инбокса'
  const title = truncate(firstLine.replace(/^[#>*\-\s]+/, ''), 90) || 'Запись из инбокса'
  const fileIds = item.files.map((file) => file.id)
  let createdNoteId: string | null = null
  let createdTaskId: string | null = null

  transaction(() => {
    if (target === 'task') {
      const task = createTask({
        title: truncate(firstLine, 200),
        notes: content,
        source_inbox_id: item.id,
        fileIds,
      })
      createdTaskId = task.id
    } else {
      const note = createNote({
        title,
        body: content,
        kind: 'note',
        source_inbox_id: item.id,
        fileIds,
      })
      createdNoteId = note.id
    }
    const result: AIResult = {
      title,
      summary: 'Сохранено вручную из инбокса.',
      category: target === 'task' ? 'task' : 'note',
      transcript: transcript || null,
      note:
        target === 'note'
          ? { title, markdown: content, kind: 'note', tags: [] }
          : null,
      tasks: target === 'task' ? [{ title: truncate(firstLine, 200) }] : [],
      event: null,
      created_note_id: createdNoteId,
      created_task_ids: createdTaskId ? [createdTaskId] : [],
      created_event_id: null,
    }
    updateInboxItem(item.id, {
      status: 'done',
      ai_result: result,
      ai_error: null,
      processed_at: nowIso(),
    })
  })

  broadcast('inbox:updated', { id: item.id })
  broadcast('notes:changed', { source: 'manual' })
  broadcast('tasks:changed', { source: 'manual' })
  res.json({
    inbox: getInboxItem(item.id),
    note_id: createdNoteId,
    task_id: createdTaskId,
  })
})

router.delete('/:id', (req, res) => {
  const item = getInboxItem(req.params.id)
  if (!item) {
    res.status(404).json({ error: 'Запись не найдена.' })
    return
  }
  deleteInboxItem(item.id)
  broadcast('inbox:deleted', { id: item.id })
  res.json({ ok: true })
})

export default router
