import { Router } from 'express'
import { broadcast } from '../realtime'
import { createHabit, deleteHabit, getHabit, listHabits, toggleHabit, updateHabit } from '../store'
import { validDate } from '../utils'

const router = Router()

router.get('/', (_req, res) => {
  res.json(listHabits())
})

router.post('/', (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : ''
  if (!title) {
    res.status(400).json({ error: 'Название привычки не может быть пустым.' })
    return
  }
  const emoji = typeof req.body?.emoji === 'string' && req.body.emoji.trim()
    ? req.body.emoji.trim().slice(0, 8)
    : '✦'
  const habit = createHabit({ title, emoji })
  broadcast('habits:changed', { id: habit.id })
  res.status(201).json(habit)
})

router.patch('/:id', (req, res) => {
  const habit = getHabit(req.params.id)
  if (!habit) {
    res.status(404).json({ error: 'Привычка не найдена.' })
    return
  }
  const title = typeof req.body?.title === 'string' ? req.body.title.trim().slice(0, 120) : undefined
  if (title === '') {
    res.status(400).json({ error: 'Название привычки не может быть пустым.' })
    return
  }
  const emoji = typeof req.body?.emoji === 'string' ? req.body.emoji.trim().slice(0, 8) : undefined
  const updated = updateHabit(habit.id, { title, emoji })
  broadcast('habits:changed', { id: habit.id })
  res.json(updated)
})

router.delete('/:id', (req, res) => {
  const habit = getHabit(req.params.id)
  if (!habit) {
    res.status(404).json({ error: 'Привычка не найдена.' })
    return
  }
  deleteHabit(habit.id)
  broadcast('habits:changed', { id: habit.id, deleted: true })
  res.json({ ok: true })
})

router.post('/:id/toggle', (req, res) => {
  const habit = getHabit(req.params.id)
  if (!habit) {
    res.status(404).json({ error: 'Привычка не найдена.' })
    return
  }
  const date = validDate(req.body?.date)
  if (!date) {
    res.status(400).json({ error: 'Некорректная дата.' })
    return
  }
  const done = Boolean(req.body?.done)
  const updated = toggleHabit(habit.id, date, done)
  broadcast('habits:changed', { id: habit.id })
  res.json(updated)
})

export default router
