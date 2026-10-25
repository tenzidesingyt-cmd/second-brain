import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addDays, format } from 'date-fns'
import {
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Flame,
  ListChecks,
  Loader2,
  Paperclip,
  Pencil,
  Plus,
  StickyNote,
  Trash2,
} from 'lucide-react'
import type { Habit, MediaFile, Task, TaskPriority } from '../../shared/types'
import { api } from '../lib/api'
import { qk, useHabits, useTasks } from '../lib/hooks'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
  formatDateShort,
  formatDueLabel,
  formatWeekdayShort,
  iso,
  parseLocal,
  pluralRu,
  todayIso,
  weekEnd,
  weekStart,
} from '../lib/date'
import { PRIORITY_META } from '../lib/meta'
import { useToast } from '../context/ToastContext'
import { useConfirm } from '../context/ConfirmContext'
import { MediaGallery } from '../components/MediaGallery'
import { Modal } from '../components/Modal'
import { EmptyState, PageHeader, Segmented, Skeleton, Toggle } from '../components/ui'

type HabitToggleInput = { habitId: string; date: string; done: boolean }

const PRIORITY_ORDER: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 }

function sortOpenTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => {
    if (a.due_date !== b.due_date) {
      if (!a.due_date) return 1
      if (!b.due_date) return -1
      return a.due_date.localeCompare(b.due_date)
    }
    if (a.due_time !== b.due_time) {
      if (!a.due_time) return 1
      if (!b.due_time) return -1
      return a.due_time.localeCompare(b.due_time)
    }
    const priority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
    if (priority !== 0) return priority
    return b.created_at.localeCompare(a.created_at)
  })
}

function habitStreak(logs: string[]): number {
  const set = new Set(logs)
  let cursor = new Date()
  if (!set.has(iso(cursor))) cursor = addDays(cursor, -1)
  let streak = 0
  while (set.has(iso(cursor))) {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return streak
}

function dueTone(task: Task, today: string): string {
  if (task.completed) return 'is-neutral'
  if (!task.due_date) return 'is-neutral'
  if (task.due_date < today) return 'is-overdue'
  if (task.due_date === today) return 'is-today'
  return 'is-upcoming'
}

interface TaskModalProps {
  task: Task
  onClose: () => void
}

function TaskModal({ task, onClose }: TaskModalProps) {
  const [title, setTitle] = useState(task.title)
  const [notes, setNotes] = useState(task.notes)
  const [dueDate, setDueDate] = useState(task.due_date || '')
  const [dueTime, setDueTime] = useState(task.due_time || '')
  const [priority, setPriority] = useState<TaskPriority>(task.priority)
  const [completed, setCompleted] = useState(task.completed)
  const [attachments, setAttachments] = useState<MediaFile[]>(task.attachments)
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()

  const updateMutation = useMutation({
    mutationFn: () =>
      api.tasks.update(task.id, {
        title: title.trim(),
        notes,
        due_date: dueDate || null,
        due_time: dueDate && dueTime ? dueTime : null,
        priority,
        completed,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData<Task[]>(qk.tasks, (current = []) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      )
      void queryClient.invalidateQueries({ queryKey: qk.analytics })
      showToast('Задача сохранена.', 'success')
      onClose()
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : 'Не удалось сохранить задачу.', 'error')
    },
  })

  const removeMutation = useMutation({
    mutationFn: () => api.tasks.remove(task.id),
    onSuccess: () => {
      queryClient.setQueryData<Task[]>(qk.tasks, (current = []) =>
        current.filter((entry) => entry.id !== task.id),
      )
      void queryClient.invalidateQueries({ queryKey: qk.analytics })
      showToast('Задача удалена.', 'success')
      onClose()
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : 'Не удалось удалить задачу.', 'error')
    },
  })

  const removeFileMutation = useMutation({
    mutationFn: (fileId: string) => api.tasks.removeFile(task.id, fileId),
    onSuccess: (updated) => {
      setAttachments(updated.attachments)
      queryClient.setQueryData<Task[]>(qk.tasks, (current = []) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      )
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : 'Не удалось убрать файл.', 'error')
    },
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || updateMutation.isPending) return
    updateMutation.mutate()
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Удалить задачу?',
      description: `«${task.title}» исчезнет из списка и календаря.`,
      confirmLabel: 'Удалить',
      danger: true,
    })
    if (confirmed) removeMutation.mutate()
  }

  const handleRemoveFile = async (file: MediaFile) => {
    const confirmed = await confirm({
      title: 'Убрать вложение?',
      description: `«${file.name}» больше не будет прикреплён к задаче.`,
      confirmLabel: 'Убрать',
      danger: true,
    })
    if (confirmed) removeFileMutation.mutate(file.id)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Задача"
      subtitle={`Создана ${formatDateShort(task.created_at)}`}
      footer={
        <>
          <button
            type="button"
            className="btn btn-ghost btn-small modal-delete-left"
            onClick={handleDelete}
            disabled={removeMutation.isPending}
          >
            {removeMutation.isPending ? (
              <Loader2 size={14} className="spin" />
            ) : (
              <Trash2 size={14} />
            )}
            Удалить
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            type="submit"
            form="task-edit-form"
            className="btn btn-primary"
            disabled={updateMutation.isPending || !title.trim()}
          >
            {updateMutation.isPending ? <Loader2 size={16} className="spin" /> : <Check size={16} />}
            Сохранить
          </button>
        </>
      }
    >
      <form id="task-edit-form" className="task-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Название</span>
          <input
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Что нужно сделать?"
            data-autofocus
            required
          />
        </label>

        <label className="field">
          <span className="field-label">Заметки</span>
          <textarea
            className="textarea"
            rows={4}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Детали, ссылки, что не забыть…"
          />
        </label>

        <div className="form-row">
          <label className="field">
            <span className="field-label">Дата</span>
            <input
              className="input"
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </label>
          <label className="field">
            <span className="field-label">Время</span>
            <input
              className="input"
              type="time"
              value={dueTime}
              onChange={(event) => setDueTime(event.target.value)}
              disabled={!dueDate}
            />
          </label>
        </div>

        <div className="field">
          <span className="field-label">Приоритет</span>
          <Segmented<TaskPriority>
            value={priority}
            onChange={setPriority}
            options={[
              { value: 'low', label: 'Низкий' },
              { value: 'normal', label: 'Обычный' },
              { value: 'high', label: 'Высокий' },
            ]}
            className="priority-segmented"
          />
        </div>

        <div className="task-form-toggle">
          <Toggle
            checked={completed}
            onChange={setCompleted}
            label={completed ? 'Задача выполнена' : 'Отметить выполненной'}
          />
        </div>

        {attachments.length > 0 && (
          <div className="field">
            <span className="field-label">Вложения</span>
            <MediaGallery
              files={attachments}
              limit={4}
              onRemove={removeFileMutation.isPending ? undefined : handleRemoveFile}
            />
          </div>
        )}
      </form>
    </Modal>
  )
}

export function TasksPage() {
  useDocumentTitle('Задачи')
  const [newTitle, setNewTitle] = useState('')
  const [newDueDate, setNewDueDate] = useState(todayIso())
  const [newPriority, setNewPriority] = useState<TaskPriority>('normal')
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [showCompleted, setShowCompleted] = useState(false)
  const [habitTitle, setHabitTitle] = useState('')
  const [habitEmoji, setHabitEmoji] = useState('✦')
  const [pendingHabit, setPendingHabit] = useState<string | null>(null)

  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const tasksQuery = useTasks()
  const habitsQuery = useHabits()
  const [searchParams, setSearchParams] = useSearchParams()

  const tasks = tasksQuery.data || []
  const habits = habitsQuery.data || []
  const today = todayIso()
  const tomorrow = iso(addDays(new Date(), 1))
  const currentWeekEnd = iso(weekEnd())
  const currentWeekStart = weekStart()
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(currentWeekStart, index)),
    [currentWeekStart],
  )

  useEffect(() => {
    const taskId = searchParams.get('task')
    if (!taskId || !tasksQuery.data) return
    const found = tasksQuery.data.find((task) => task.id === taskId)
    if (found) setEditingTask(found)
  }, [searchParams, tasksQuery.data])

  const closeTaskModal = () => {
    setEditingTask(null)
    if (searchParams.has('task')) {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current)
          next.delete('task')
          return next
        },
        { replace: true },
      )
    }
  }

  const createTask = useMutation({
    mutationFn: () =>
      api.tasks.create({
        title: newTitle.trim(),
        due_date: newDueDate || null,
        priority: newPriority,
      }),
    onSuccess: (task) => {
      queryClient.setQueryData<Task[]>(qk.tasks, (current = []) => [task, ...current])
      void queryClient.invalidateQueries({ queryKey: qk.analytics })
      setNewTitle('')
      setNewPriority('normal')
      showToast('Задача добавлена.', 'success')
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : 'Не удалось добавить задачу.', 'error')
    },
  })

  const toggleTask = useMutation({
    mutationFn: ({ task, completed }: { task: Task; completed: boolean }) =>
      api.tasks.update(task.id, { completed }),
    onMutate: async ({ task, completed }) => {
      await queryClient.cancelQueries({ queryKey: qk.tasks })
      const previous = queryClient.getQueryData<Task[]>(qk.tasks)
      queryClient.setQueryData<Task[]>(qk.tasks, (current = []) =>
        current.map((entry) =>
          entry.id === task.id
            ? {
                ...entry,
                completed,
                completed_at: completed ? new Date().toISOString() : null,
              }
            : entry,
        ),
      )
      return { previous }
    },
    onError: (error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(qk.tasks, context.previous)
      showToast(error instanceof Error ? error.message : 'Не удалось обновить задачу.', 'error')
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.analytics })
    },
  })

  const deleteTask = useMutation({
    mutationFn: (task: Task) => api.tasks.remove(task.id),
    onMutate: async (task) => {
      await queryClient.cancelQueries({ queryKey: qk.tasks })
      const previous = queryClient.getQueryData<Task[]>(qk.tasks)
      queryClient.setQueryData<Task[]>(qk.tasks, (current = []) =>
        current.filter((entry) => entry.id !== task.id),
      )
      return { previous }
    },
    onError: (error, _task, context) => {
      if (context?.previous) queryClient.setQueryData(qk.tasks, context.previous)
      showToast(error instanceof Error ? error.message : 'Не удалось удалить задачу.', 'error')
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.analytics })
      showToast('Задача удалена.', 'success')
    },
  })

  const createHabit = useMutation({
    mutationFn: () =>
      api.habits.create({
        title: habitTitle.trim(),
        emoji: habitEmoji.trim() || '✦',
      }),
    onSuccess: (habit) => {
      queryClient.setQueryData<Habit[]>(qk.habits, (current = []) => [...current, habit])
      void queryClient.invalidateQueries({ queryKey: qk.analytics })
      setHabitTitle('')
      showToast('Привычка добавлена.', 'success')
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : 'Не удалось добавить привычку.', 'error')
    },
  })

  const toggleHabit = useMutation({
    mutationFn: (input: HabitToggleInput) => api.habits.toggle(input.habitId, input.date, input.done),
    onMutate: async ({ habitId, date, done }) => {
      await queryClient.cancelQueries({ queryKey: qk.habits })
      const previous = queryClient.getQueryData<Habit[]>(qk.habits)
      setPendingHabit(`${habitId}:${date}`)
      queryClient.setQueryData<Habit[]>(qk.habits, (current = []) =>
        current.map((habit) =>
          habit.id === habitId
            ? {
                ...habit,
                logs: done
                  ? Array.from(new Set([...habit.logs, date])).sort()
                  : habit.logs.filter((entry) => entry !== date),
              }
            : habit,
        ),
      )
      return { previous }
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(qk.habits, context.previous)
      showToast(error instanceof Error ? error.message : 'Не удалось отметить привычку.', 'error')
    },
    onSettled: () => {
      setPendingHabit(null)
      void queryClient.invalidateQueries({ queryKey: qk.analytics })
    },
  })

  const deleteHabit = useMutation({
    mutationFn: (habit: Habit) => api.habits.remove(habit.id),
    onSuccess: (_result, habit) => {
      queryClient.setQueryData<Habit[]>(qk.habits, (current = []) =>
        current.filter((entry) => entry.id !== habit.id),
      )
      void queryClient.invalidateQueries({ queryKey: qk.analytics })
      showToast('Привычка удалена.', 'success')
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : 'Не удалось удалить привычку.', 'error')
    },
  })

  const groups = useMemo(() => {
    const open = sortOpenTasks(tasks.filter((task) => !task.completed))
    const overdue = open.filter((task) => task.due_date && task.due_date < today)
    const dueToday = open.filter((task) => task.due_date === today)
    const dueTomorrow = open.filter((task) => task.due_date === tomorrow)
    const thisWeek = open.filter(
      (task) => task.due_date && task.due_date > tomorrow && task.due_date <= currentWeekEnd,
    )
    const later = open.filter((task) => task.due_date && task.due_date > currentWeekEnd)
    const noDate = open.filter((task) => !task.due_date)
    return [
      { key: 'overdue', title: 'Просрочено', tasks: overdue, tone: 'danger' },
      { key: 'today', title: 'Сегодня', tasks: dueToday, tone: 'accent' },
      { key: 'tomorrow', title: 'Завтра', tasks: dueTomorrow, tone: 'neutral' },
      { key: 'week', title: 'На этой неделе', tasks: thisWeek, tone: 'neutral' },
      { key: 'later', title: 'Позже', tasks: later, tone: 'neutral' },
      { key: 'none', title: 'Без срока', tasks: noDate, tone: 'neutral' },
    ].filter((group) => group.tasks.length > 0)
  }, [tasks, today, tomorrow, currentWeekEnd])

  const completed = useMemo(
    () =>
      tasks
        .filter((task) => task.completed)
        .sort((a, b) => (b.completed_at || '').localeCompare(a.completed_at || '')),
    [tasks],
  )

  const stats = useMemo(() => {
    const open = tasks.filter((task) => !task.completed)
    const dueToday = open.filter((task) => task.due_date === today).length
    const overdue = open.filter((task) => task.due_date && task.due_date < today).length
    const weekDue = open.filter(
      (task) => task.due_date && task.due_date >= today && task.due_date <= currentWeekEnd,
    ).length
    const completedThisWeek = completed.filter((task) => {
      const parsed = parseLocal(task.completed_at)
      return parsed ? parsed >= currentWeekStart : false
    }).length
    return { dueToday, overdue, weekDue, completedThisWeek }
  }, [tasks, completed, today, currentWeekEnd, currentWeekStart])

  const doneHabitsToday = habits.filter((habit) => habit.logs.includes(today)).length

  const submitNewTask = (event: FormEvent) => {
    event.preventDefault()
    if (!newTitle.trim() || createTask.isPending) return
    createTask.mutate()
  }

  const handleDeleteTask = async (task: Task) => {
    const confirmed = await confirm({
      title: 'Удалить задачу?',
      description: `«${task.title}» исчезнет из списка и календаря.`,
      confirmLabel: 'Удалить',
      danger: true,
    })
    if (confirmed) deleteTask.mutate(task)
  }

  const submitHabit = (event: FormEvent) => {
    event.preventDefault()
    if (!habitTitle.trim() || createHabit.isPending) return
    createHabit.mutate()
  }

  const handleDeleteHabit = async (habit: Habit) => {
    const confirmed = await confirm({
      title: 'Удалить привычку?',
      description: `«${habit.title}» и вся история отметок будут удалены.`,
      confirmLabel: 'Удалить',
      danger: true,
    })
    if (confirmed) deleteHabit.mutate(habit)
  }

  const renderTaskRow = (task: Task) => (
    <li className={`task-row ${task.completed ? 'is-completed' : ''}`} key={task.id}>
      <button
        type="button"
        className={`task-check ${task.completed ? 'is-checked' : ''}`}
        onClick={() => toggleTask.mutate({ task, completed: !task.completed })}
        aria-label={task.completed ? 'Вернуть в работу' : 'Отметить выполненной'}
        aria-pressed={task.completed}
      >
        {task.completed && <Check size={13} strokeWidth={3} />}
      </button>

      <button type="button" className="task-content" onClick={() => setEditingTask(task)}>
        <span className="task-title-line">
          <span className="task-title">{task.title}</span>
          {task.priority === 'high' && !task.completed && (
            <span className="task-priority-flag" title="Высокий приоритет">
              {PRIORITY_META.high.label}
            </span>
          )}
        </span>
        <span className="task-meta">
          <span className={`task-due ${dueTone(task, today)}`}>
            <CalendarDays size={12} />
            {task.due_date ? formatDueLabel(task.due_date, task.due_time) : 'Без срока'}
          </span>
          {task.notes && (
            <span className="task-meta-item" title="Есть заметка">
              <StickyNote size={12} />
            </span>
          )}
          {task.attachments.length > 0 && (
            <span className="task-meta-item" title="Вложения">
              <Paperclip size={12} /> {task.attachments.length}
            </span>
          )}
        </span>
      </button>

      <div className="task-row-actions">
        <button
          type="button"
          className="icon-btn tiny-btn"
          onClick={() => setEditingTask(task)}
          aria-label="Редактировать задачу"
        >
          <Pencil size={14} />
        </button>
        <button
          type="button"
          className="icon-btn tiny-btn task-row-delete"
          onClick={() => void handleDeleteTask(task)}
          aria-label="Удалить задачу"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </li>
  )

  return (
    <div className="tasks-page">
      <PageHeader
        eyebrow="Планы и ритм"
        title="Задачи"
        description="Короткий список того, что важно. Сроки, приоритеты и привычки — чтобы день не рассыпался."
      />

      <div className="task-stats">
        <div className="stat-tile tone-accent">
          <span className="stat-icon">
            <ListChecks size={17} />
          </span>
          <span className="stat-copy">
            <strong>{stats.dueToday}</strong>
            <small>на сегодня</small>
          </span>
        </div>
        <div className={`stat-tile tone-coral ${stats.overdue > 0 ? 'is-alert' : ''}`}>
          <span className="stat-icon">
            <CircleAlert size={17} />
          </span>
          <span className="stat-copy">
            <strong>{stats.overdue}</strong>
            <small>просрочено</small>
          </span>
        </div>
        <div className="stat-tile tone-blue">
          <span className="stat-icon">
            <CalendarDays size={17} />
          </span>
          <span className="stat-copy">
            <strong>{stats.weekDue}</strong>
            <small>на неделе</small>
          </span>
        </div>
        <div className="stat-tile tone-green">
          <span className="stat-icon">
            <CheckCircle2 size={17} />
          </span>
          <span className="stat-copy">
            <strong>{stats.completedThisWeek}</strong>
            <small>сделано за неделю</small>
          </span>
        </div>
      </div>

      <div className="tasks-layout">
        <div className="tasks-main">
          <form className="quick-add" onSubmit={submitNewTask}>
            <div className="quick-add-main">
              <span className="quick-add-icon">
                <Plus size={18} />
              </span>
              <input
                className="quick-add-input"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                placeholder="Что нужно сделать?"
                aria-label="Новая задача"
              />
              <button
                type="submit"
                className="btn btn-primary quick-add-submit"
                disabled={!newTitle.trim() || createTask.isPending}
              >
                {createTask.isPending ? <Loader2 size={16} className="spin" /> : <Plus size={16} />}
                Добавить
              </button>
            </div>
            <div className="quick-add-meta">
              <label className="quick-date">
                <CalendarDays size={15} />
                <input
                  type="date"
                  value={newDueDate}
                  onChange={(event) => setNewDueDate(event.target.value)}
                  aria-label="Срок задачи"
                />
              </label>
              <div className="quick-chips">
                <button
                  type="button"
                  className={`quick-chip ${newDueDate === today ? 'is-active' : ''}`}
                  onClick={() => setNewDueDate(today)}
                >
                  Сегодня
                </button>
                <button
                  type="button"
                  className={`quick-chip ${newDueDate === tomorrow ? 'is-active' : ''}`}
                  onClick={() => setNewDueDate(tomorrow)}
                >
                  Завтра
                </button>
                <button
                  type="button"
                  className={`quick-chip ${!newDueDate ? 'is-active' : ''}`}
                  onClick={() => setNewDueDate('')}
                >
                  Без срока
                </button>
              </div>
              <select
                className="select quick-priority"
                value={newPriority}
                onChange={(event) => setNewPriority(event.target.value as TaskPriority)}
                aria-label="Приоритет"
              >
                <option value="low">Низкий</option>
                <option value="normal">Обычный</option>
                <option value="high">Высокий</option>
              </select>
            </div>
          </form>

          {tasksQuery.isPending ? (
            <div className="task-list-skeleton">
              {[0, 1, 2, 3, 4].map((index) => (
                <Skeleton className="task-skeleton-row" key={index} />
              ))}
            </div>
          ) : tasksQuery.isError ? (
            <EmptyState
              icon={ListChecks}
              title="Задачи не загрузились"
              description={
                tasksQuery.error instanceof Error ? tasksQuery.error.message : 'Проверь соединение.'
              }
              action={
                <button className="btn btn-ghost" onClick={() => void tasksQuery.refetch()}>
                  Повторить
                </button>
              }
            />
          ) : tasks.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="Список чист"
              description="Добавь первую задачу сверху — можно сразу поставить срок и приоритет. А привычки помогут держать ритм."
            />
          ) : (
            <div className="task-groups">
              {groups.map((group) => (
                <section className={`task-group is-${group.tone}`} key={group.key}>
                  <div className="task-group-head">
                    <span className="task-group-title">{group.title}</span>
                    <span className="task-group-count">{group.tasks.length}</span>
                  </div>
                  <ul className="task-list">{group.tasks.map(renderTaskRow)}</ul>
                </section>
              ))}

              {groups.length === 0 && (
                <div className="tasks-clear">
                  <span className="tasks-clear-icon">
                    <CheckCircle2 size={22} />
                  </span>
                  <div>
                    <strong>Все открытые задачи закрыты</strong>
                    <p>Можно выдохнуть или добавить что-то новое.</p>
                  </div>
                </div>
              )}

              {completed.length > 0 && (
                <section className="task-group task-group-completed">
                  <button
                    type="button"
                    className="task-completed-toggle"
                    onClick={() => setShowCompleted((current) => !current)}
                    aria-expanded={showCompleted}
                  >
                    <span>
                      <CheckCircle2 size={14} /> Выполнено
                      <span className="task-group-count">{completed.length}</span>
                    </span>
                    <ChevronDown size={16} className={showCompleted ? 'is-open' : ''} />
                  </button>
                  {showCompleted && <ul className="task-list">{completed.map(renderTaskRow)}</ul>}
                </section>
              )}

              <p className="tasks-footnote">
                {tasks.filter((task) => !task.completed).length}{' '}
                {pluralRu(
                  tasks.filter((task) => !task.completed).length,
                  'открытая задача',
                  'открытые задачи',
                  'открытых задач',
                )}
              </p>
            </div>
          )}
        </div>

        <aside className="habits-panel">
          <div className="habits-head">
            <span className="habits-orb">
              <Flame size={18} />
            </span>
            <div>
              <h2>Привычки</h2>
              <p>Маленькие шаги каждый день</p>
            </div>
          </div>

          {habits.length > 0 && (
            <div className="habits-progress">
              <span>
                {doneHabitsToday} из {habits.length} сегодня
              </span>
              <span className="habits-progress-bar">
                <span style={{ width: `${(doneHabitsToday / habits.length) * 100}%` }} />
              </span>
            </div>
          )}

          {habitsQuery.isPending ? (
            <div className="habits-skeleton">
              <Skeleton className="habit-skeleton" />
              <Skeleton className="habit-skeleton" />
            </div>
          ) : habits.length === 0 ? (
            <div className="habits-empty">
              <span>Добавь первую привычку — и отмечай дни точками.</span>
            </div>
          ) : (
            <div className="habits-list">
              {habits.map((habit) => {
                const streak = habitStreak(habit.logs)
                return (
                  <div className="habit-row" key={habit.id}>
                    <div className="habit-row-head">
                      <span className="habit-emoji">{habit.emoji}</span>
                      <span className="habit-title">{habit.title}</span>
                      {streak > 0 && (
                        <span className="habit-streak" title="Дней подряд">
                          <Flame size={11} /> {streak}
                        </span>
                      )}
                      <button
                        type="button"
                        className="icon-btn tiny-btn habit-delete"
                        onClick={() => void handleDeleteHabit(habit)}
                        aria-label={`Удалить привычку ${habit.title}`}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                    <div className="habit-days">
                      {weekDays.map((day) => {
                        const dayIso = iso(day)
                        const done = habit.logs.includes(dayIso)
                        const future = dayIso > today
                        const key = `${habit.id}:${dayIso}`
                        return (
                          <button
                            type="button"
                            key={dayIso}
                            className={`habit-day ${done ? 'is-done' : ''} ${dayIso === today ? 'is-today' : ''}`}
                            disabled={future || pendingHabit === key}
                            onClick={() =>
                              toggleHabit.mutate({ habitId: habit.id, date: dayIso, done: !done })
                            }
                            title={`${formatWeekdayShort(day)}, ${formatDateShort(dayIso)}`}
                            aria-label={`${habit.title}: ${formatDateShort(dayIso)}`}
                            aria-pressed={done}
                          >
                            <span className="habit-day-week">{formatWeekdayShort(day)}</span>
                            <span className="habit-day-mark">
                              {done ? <Check size={11} strokeWidth={3} /> : format(day, 'd')}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          <form className="habit-add" onSubmit={submitHabit}>
            <input
              className="habit-emoji-input"
              value={habitEmoji}
              onChange={(event) => setHabitEmoji(event.target.value.slice(0, 4))}
              aria-label="Эмодзи привычки"
              maxLength={4}
            />
            <input
              className="habit-title-input"
              value={habitTitle}
              onChange={(event) => setHabitTitle(event.target.value)}
              placeholder="Новая привычка…"
              aria-label="Название привычки"
              maxLength={120}
            />
            <button
              type="submit"
              className="habit-add-btn"
              disabled={!habitTitle.trim() || createHabit.isPending}
              aria-label="Добавить привычку"
            >
              {createHabit.isPending ? <Loader2 size={15} className="spin" /> : <Plus size={16} />}
            </button>
          </form>
        </aside>
      </div>

      {editingTask && (
        <TaskModal key={editingTask.id} task={editingTask} onClose={closeTaskModal} />
      )}
    </div>
  )
}
