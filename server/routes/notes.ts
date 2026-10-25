import { Router } from 'express'
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
import type { NoteKind } from '../../shared/types'

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
