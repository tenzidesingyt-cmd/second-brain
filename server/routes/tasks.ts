import { Router } from 'express'
import { broadcast } from '../realtime'
import {
  attachFiles,
  createTask,
  deleteTask,
  detachFile,
  getTask,
  listTasks,
  updateTask,
} from '../store'
import { cleanupUploadedFiles, storeUploadedFiles, upload } from '../upload'
import { validDate, validTime } from '../utils'
import type { TaskPriority } from '../../shared/types'

const router = Router()
const PRIORITIES = new Set<TaskPriority>(['low', 'normal', 'high'])

router.get('/', (_req, res) => {
  res.json(listTasks())
})

router.post('/', (req, res) => {
  const body = req.body || {}
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : ''
  if (!title) {
    res.status(400).json({ error: 'Название задачи не может быть пустым.' })
    return
  }
  const dueDate = validDate(body.due_date)
  const dueTime = validTime(body.due_time)
  const priority = typeof body.priority === 'string' && PRIORITIES.has(body.priority as TaskPriority)
    ? (body.priority as TaskPriority)
    : 'normal'
  const task = createTask({
    title,
    notes: typeof body.notes === 'string' ? body.notes : '',
    due_date: dueDate,
    due_time: dueDate ? dueTime : null,
    priority,
  })
  broadcast('tasks:changed', { id: task.id })
  res.status(201).json(task)
})

router.patch('/:id', (req, res) => {
  const existing = getTask(req.params.id)
  if (!existing) {
    res.status(404).json({ error: 'Задача не найдена.' })
    return
  }
  const body = req.body || {}
  const patch: Parameters<typeof updateTask>[1] = {}

  if ('title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 300) : ''
    if (!title) {
      res.status(400).json({ error: 'Название задачи не может быть пустым.' })
      return
    }
    patch.title = title
  }
  if ('notes' in body && typeof body.notes === 'string') patch.notes = body.notes
  if ('priority' in body) {
    if (typeof body.priority !== 'string' || !PRIORITIES.has(body.priority as TaskPriority)) {
      res.status(400).json({ error: 'Некорректный приоритет.' })
      return
    }
    patch.priority = body.priority as TaskPriority
  }
  if ('completed' in body) patch.completed = Boolean(body.completed)
  if ('due_date' in body) {
    if (body.due_date === null || body.due_date === '') {
      patch.due_date = null
      patch.due_time = null
    } else {
      const date = validDate(body.due_date)
      if (!date) {
        res.status(400).json({ error: 'Некорректная дата.' })
        return
      }
      patch.due_date = date
    }
  }
  if ('due_time' in body && !('due_date' in body && !body.due_date)) {
    if (body.due_time === null || body.due_time === '') {
      patch.due_time = null
    } else {
      const time = validTime(body.due_time)
      if (!time) {
        res.status(400).json({ error: 'Некорректное время.' })
        return
      }
      patch.due_time = time
    }
  }

  const task = updateTask(existing.id, patch)
  broadcast('tasks:changed', { id: existing.id })
  res.json(task)
})

router.delete('/:id', (req, res) => {
  const task = getTask(req.params.id)
  if (!task) {
    res.status(404).json({ error: 'Задача не найдена.' })
    return
  }
  deleteTask(task.id)
  broadcast('tasks:changed', { id: task.id, deleted: true })
  res.json({ ok: true })
})

router.post('/:id/files', upload.array('files', 10), (req, res) => {
  const task = getTask(String(req.params.id))
  const files = (req.files as Express.Multer.File[] | undefined) || []
  if (!task) {
    cleanupUploadedFiles(files)
    res.status(404).json({ error: 'Задача не найдена.' })
    return
  }
  if (!files.length) {
    res.status(400).json({ error: 'Файлы не выбраны.' })
    return
  }
  const stored = storeUploadedFiles(files)
  attachFiles('task', task.id, stored.map((file) => file.id))
  broadcast('tasks:changed', { id: task.id })
  res.json(getTask(task.id))
})

router.delete('/:id/files/:fileId', (req, res) => {
  const task = getTask(req.params.id)
  if (!task) {
    res.status(404).json({ error: 'Задача не найдена.' })
    return
  }
  detachFile('task', task.id, req.params.fileId)
  broadcast('tasks:changed', { id: task.id })
  res.json(getTask(task.id))
})

export default router
