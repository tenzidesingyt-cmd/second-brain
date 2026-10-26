import { Router } from 'express'
import { editNoteWithAi } from '../ai'
import { broadcast } from '../realtime'
import {
  attachFiles,
  createNote,
  deleteNote,
  detachFile,
  getNote,
  listNotes,
  updateNote,
} from '../store'
import { cleanupUploadedFiles, storeUploadedFiles, upload } from '../upload'
import { AI_EDIT_MAX_INSTRUCTION, AI_EDIT_MAX_NOTES } from '../../shared/types'
import type {
  NoteEditChange,
  NoteEditError,
  NoteEditSnapshot,
  NoteKind,
  NotesAiEditResponse,
} from '../../shared/types'

const router = Router()

const KINDS = new Set<NoteKind>(['note', 'lesson', 'idea'])

function parseTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().slice(0, 40))
        .filter(Boolean),
    ),
  ].slice(0, 12)
}

router.get('/', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : undefined
  const kindRaw = req.query.kind
  const kind = typeof kindRaw === 'string' && KINDS.has(kindRaw as NoteKind)
    ? (kindRaw as NoteKind)
    : undefined
  res.json(listNotes({ q, kind }))
})

router.post('/', (req, res) => {
  const body = req.body || {}
  const kind = typeof body.kind === 'string' && KINDS.has(body.kind as NoteKind)
    ? (body.kind as NoteKind)
    : 'note'
  const note = createNote({
    title: typeof body.title === 'string' ? body.title.slice(0, 200) : '',
    body: typeof body.body === 'string' ? body.body : '',
    kind,
    tags: parseTags(body.tags) || [],
    pinned: Boolean(body.pinned),
  })
  broadcast('notes:changed', { id: note.id })
  res.status(201).json(note)
})

router.post('/ai-edit', async (req, res) => {
  const body = (req.body || {}) as Record<string, unknown>
  const rawIds: unknown[] = Array.isArray(body.noteIds) ? body.noteIds : []
  const noteIds: string[] = [
    ...new Set(
      rawIds
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ]
  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : ''

  if (!noteIds.length) {
    res.status(400).json({ error: 'Выберите хотя бы одну заметку.' })
    return
  }
  if (noteIds.length > AI_EDIT_MAX_NOTES) {
    res.status(400).json({ error: `Можно изменить не больше ${AI_EDIT_MAX_NOTES} заметок за раз.` })
    return
  }
  if (!instruction) {
    res.status(400).json({ error: 'Напишите, что изменить.' })
    return
  }
  if (instruction.length > AI_EDIT_MAX_INSTRUCTION) {
    res.status(400).json({
      error: `Инструкция слишком длинная: максимум ${AI_EDIT_MAX_INSTRUCTION} символов.`,
    })
    return
  }

  const prepared = noteIds.map((id) => ({ id, note: getNote(id) }))
  const results = await Promise.all(
    prepared.map(async ({ id, note }) => {
      if (!note) {
        const error: NoteEditError = { id, title: 'Заметка', error: 'Заметка не найдена.' }
        return { error }
      }
      const before: NoteEditSnapshot = {
        title: note.title,
        body: note.body,
        kind: note.kind,
        tags: note.tags,
        pinned: note.pinned,
      }
      try {
        const result = await editNoteWithAi(note, instruction)
        let updated = note
        if (result.changed) {
          const saved = updateNote(note.id, {
            title: result.title,
            body: result.body,
            kind: result.kind,
            tags: result.tags,
          })
          if (!saved) throw new Error('Не удалось сохранить изменённую заметку.')
          updated = saved
          broadcast('notes:changed', { id: note.id })
        }
        const change: NoteEditChange = {
          id: note.id,
          summary: result.summary,
          changed: result.changed,
          before,
        }
        return { note: updated, change }
      } catch (error) {
        const failure: NoteEditError = {
          id,
          title: note.title || 'Без названия',
          error: error instanceof Error ? error.message : 'Не удалось изменить заметку.',
        }
        return { error: failure }
      }
    }),
  )

  const notes: NotesAiEditResponse['notes'] = []
  const changes: NoteEditChange[] = []
  const errors: NoteEditError[] = []
  for (const result of results) {
    if ('note' in result && result.note && result.change) {
      notes.push(result.note)
      changes.push(result.change)
    } else if ('error' in result && result.error) {
      errors.push(result.error)
    }
  }

  if (!notes.length) {
    res.status(502).json({
      error: errors[0]?.error || 'ИИ не смог изменить заметки. Попробуйте ещё раз.',
      errors,
    })
    return
  }

  const payload: NotesAiEditResponse = { notes, changes, errors }
  res.json(payload)
})

router.get('/:id', (req, res) => {
  const note = getNote(req.params.id)
  if (!note) {
    res.status(404).json({ error: 'Заметка не найдена.' })
    return
  }
  res.json(note)
})

router.patch('/:id', (req, res) => {
  const existing = getNote(req.params.id)
  if (!existing) {
    res.status(404).json({ error: 'Заметка не найдена.' })
    return
  }
  const body = req.body || {}
  const note = updateNote(req.params.id, {
    title: typeof body.title === 'string' ? body.title.slice(0, 200) : undefined,
    body: typeof body.body === 'string' ? body.body : undefined,
    kind:
      typeof body.kind === 'string' && KINDS.has(body.kind as NoteKind)
        ? (body.kind as NoteKind)
        : undefined,
    tags: parseTags(body.tags),
    pinned: typeof body.pinned === 'boolean' ? body.pinned : undefined,
  })
  broadcast('notes:changed', { id: req.params.id })
  res.json(note)
})

router.delete('/:id', (req, res) => {
  const note = getNote(req.params.id)
  if (!note) {
    res.status(404).json({ error: 'Заметка не найдена.' })
    return
  }
  deleteNote(note.id)
  broadcast('notes:changed', { id: note.id, deleted: true })
  res.json({ ok: true })
})

router.post('/:id/files', upload.array('files', 10), (req, res) => {
  const note = getNote(String(req.params.id))
  const files = (req.files as Express.Multer.File[] | undefined) || []
  if (!note) {
    cleanupUploadedFiles(files)
    res.status(404).json({ error: 'Заметка не найдена.' })
    return
  }
  if (!files.length) {
    res.status(400).json({ error: 'Файлы не выбраны.' })
    return
  }
  const stored = storeUploadedFiles(files)
  attachFiles('note', note.id, stored.map((file) => file.id))
  broadcast('notes:changed', { id: note.id })
  res.json(getNote(note.id))
})

router.delete('/:id/files/:fileId', (req, res) => {
  const note = getNote(req.params.id)
  if (!note) {
    res.status(404).json({ error: 'Заметка не найдена.' })
    return
  }
  detachFile('note', note.id, req.params.fileId)
  broadcast('notes:changed', { id: note.id })
  res.json(getNote(note.id))
})

export default router
