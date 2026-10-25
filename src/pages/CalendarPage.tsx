import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addDays, format, startOfMonth } from 'date-fns'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  Paperclip,
  Plus,
  Trash2,
} from 'lucide-react'
import type { CalendarEvent, Task } from '../../shared/types'
import { api } from '../lib/api'
import { qk, useEvents, useTasks } from '../lib/hooks'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
  formatDayMonth,
  formatFullDate,
  formatMonthTitle,
  formatTime,
  formatWeekdayLong,
  iso,
  monthGridStart,
  nextMonth,
  parseLocal,
  previousMonth,
  todayIso,
} from '../lib/date'
import { useToast } from '../context/ToastContext'
import { useConfirm } from '../context/ConfirmContext'
import { MediaGallery } from '../components/MediaGallery'
import { Modal } from '../components/Modal'
import { EmptyState, PageHeader, Skeleton, Toggle } from '../components/ui'

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function eventTimeLabel(event: CalendarEvent): string {
  if (event.all_day) return 'Весь день'
  const start = formatTime(event.starts_at)
  if (event.ends_at && event.ends_at.slice(0, 10) === event.starts_at.slice(0, 10)) {
    return `${start}–${formatTime(event.ends_at)}`
  }
  return start
}

interface EventModalProps {
  event: CalendarEvent | null
  initialDate: string
  onClose: () => void
}

function EventModal({ event, initialDate, onClose }: EventModalProps) {
  const [title, setTitle] = useState(event?.title || '')
  const [date, setDate] = useState(event?.starts_at.slice(0, 10) || initialDate)
  const [startTime, setStartTime] = useState(
    event && !event.all_day ? formatTime(event.starts_at) : '10:00',
  )
  const [endTime, setEndTime] = useState(
    event?.ends_at && !event.all_day ? formatTime(event.ends_at) : '',
  )
  const [allDay, setAllDay] = useState(event?.all_day || false)
  const [location, setLocation] = useState(event?.location || '')
  const [description, setDescription] = useState(event?.description || '')
  const [error, setError] = useState('')

  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()

  const saveMutation = useMutation({
    mutationFn: () => {
      const startsAt = `${date}T${allDay ? '00:00' : startTime || '10:00'}`
      const endsAt = !allDay && endTime ? `${date}T${endTime}` : null
      const payload = {
        title: title.trim(),
        description,
        starts_at: startsAt,
        ends_at: endsAt,
        all_day: allDay,
        location: location.trim() || null,
      }
      return event ? api.events.update(event.id, payload) : api.events.create(payload)
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.events })
      showToast(event ? 'Событие обновлено.' : 'Событие добавлено.', 'success')
      onClose()
    },
    onError: (mutationError) => {
      showToast(
        mutationError instanceof Error ? mutationError.message : 'Не удалось сохранить событие.',
        'error',
      )
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.events.remove(event!.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.events })
      showToast('Событие удалено.', 'success')
      onClose()
    },
    onError: (mutationError) => {
      showToast(
        mutationError instanceof Error ? mutationError.message : 'Не удалось удалить событие.',
        'error',
      )
    },
  })

  const submit = (submitEvent: FormEvent) => {
    submitEvent.preventDefault()
    setError('')
    if (!title.trim()) {
      setError('Название события не может быть пустым.')
      return
    }
    if (!date) {
      setError('Выбери дату события.')
      return
    }
    if (!allDay && endTime && endTime <= startTime) {
      setError('Время окончания должно быть позже начала.')
      return
    }
    saveMutation.mutate()
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Удалить событие?',
      description: `«${event?.title}» исчезнет из календаря.`,
      confirmLabel: 'Удалить',
      danger: true,
    })
    if (confirmed) deleteMutation.mutate()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={event ? 'Событие' : 'Новое событие'}
      subtitle={event ? 'Поменяй детали или удали из календаря' : 'Встреча, дедлайн или важная дата'}
      footer={
        <>
          {event && (
            <button
              type="button"
              className="btn btn-ghost btn-small modal-delete-left"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <Trash2 size={14} />
              )}
              Удалить
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Отмена
          </button>
          <button
            type="submit"
            form="event-form"
            className="btn btn-primary"
            disabled={saveMutation.isPending || !title.trim()}
          >
            {saveMutation.isPending ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Check size={16} />
            )}
            {event ? 'Сохранить' : 'Добавить'}
          </button>
        </>
      }
    >
      <form id="event-form" className="event-form" onSubmit={submit}>
        <label className="field">
          <span className="field-label">Название</span>
          <input
            className="input"
            value={title}
            onChange={(inputEvent) => setTitle(inputEvent.target.value)}
            placeholder="Например, встреча с командой"
            data-autofocus
            required
          />
        </label>

        <div className="event-date-row">
          <label className="field">
            <span className="field-label">Дата</span>
            <input
              className="input"
              type="date"
              value={date}
              onChange={(inputEvent) => setDate(inputEvent.target.value)}
              required
            />
          </label>
          <div className="event-allday">
            <Toggle checked={allDay} onChange={setAllDay} label="Весь день" />
          </div>
        </div>

        {!allDay && (
          <div className="form-row">
            <label className="field">
              <span className="field-label">Начало</span>
              <input
                className="input"
                type="time"
                value={startTime}
                onChange={(inputEvent) => setStartTime(inputEvent.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Окончание</span>
              <input
                className="input"
                type="time"
                value={endTime}
                onChange={(inputEvent) => setEndTime(inputEvent.target.value)}
              />
            </label>
          </div>
        )}

        <label className="field">
          <span className="field-label">Место</span>
          <input
            className="input"
            value={location}
            onChange={(inputEvent) => setLocation(inputEvent.target.value)}
            placeholder="Школа, созвон, адрес…"
          />
        </label>

        <label className="field">
          <span className="field-label">Описание</span>
          <textarea
            className="textarea"
            rows={3}
            value={description}
            onChange={(inputEvent) => setDescription(inputEvent.target.value)}
            placeholder="Что важно помнить о событии"
          />
        </label>

        {error && <div className="form-error">{error}</div>}

        {event && event.attachments.length > 0 && (
          <div className="field">
            <span className="field-label">Вложения</span>
            <MediaGallery files={event.attachments} limit={3} />
          </div>
        )}
      </form>
    </Modal>
  )
}

export function CalendarPage() {
  useDocumentTitle('Календарь')
  const today = todayIso()
  const { showToast } = useToast()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [viewMonth, setViewMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState(today)
  const [modalState, setModalState] = useState<{ event: CalendarEvent | null; date: string } | null>(
    null,
  )
  const [quickTask, setQuickTask] = useState('')

  const eventsQuery = useEvents()
  const tasksQuery = useTasks()
  const events = eventsQuery.data || []
  const tasks = tasksQuery.data || []

  useEffect(() => {
    const raw = searchParams.get('date')
    if (!raw) return
    const parsed = parseLocal(raw)
    if (!parsed) return
    setSelected(raw)
    setViewMonth(startOfMonth(parsed))
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.delete('date')
        return next
      },
      { replace: true },
    )
  }, [searchParams, setSearchParams])

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      const key = event.starts_at.slice(0, 10)
      const bucket = map.get(key) || []
      bucket.push(event)
      map.set(key, bucket)
    }
    return map
  }, [events])

  const openTasksByDate = useMemo(() => {
    const map = new Map<string, Task[]>()
    for (const task of tasks) {
      if (task.completed || !task.due_date) continue
      const bucket = map.get(task.due_date) || []
      bucket.push(task)
      map.set(task.due_date, bucket)
    }
    return map
  }, [tasks])

  const gridStart = monthGridStart(viewMonth)
  const days = useMemo(
    () => Array.from({ length: 42 }, (_, index) => addDays(gridStart, index)),
    [gridStart],
  )

  const selectedDate = parseLocal(selected) || new Date()
  const selectedEvents = eventsByDate.get(selected) || []
  const selectedTasks = useMemo(
    () =>
      tasks
        .filter((task) => task.due_date === selected)
        .sort((a, b) => Number(a.completed) - Number(b.completed)),
    [tasks, selected],
  )

  const monthEventsCount = useMemo(() => {
    const prefix = format(viewMonth, 'yyyy-MM')
    return events.filter((event) => event.starts_at.slice(0, 7) === prefix).length
  }, [events, viewMonth])

  const toggleTask = useMutation({
    mutationFn: ({ task, completed }: { task: Task; completed: boolean }) =>
      api.tasks.update(task.id, { completed }),
    onMutate: async ({ task, completed }) => {
      await queryClient.cancelQueries({ queryKey: qk.tasks })
      const previous = queryClient.getQueryData<Task[]>(qk.tasks)
      queryClient.setQueryData<Task[]>(qk.tasks, (current = []) =>
        current.map((entry) =>
          entry.id === task.id
            ? { ...entry, completed, completed_at: completed ? new Date().toISOString() : null }
            : entry,
        ),
      )
      return { previous }
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(qk.tasks, context.previous)
      showToast(error instanceof Error ? error.message : 'Не удалось обновить задачу.', 'error')
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: qk.analytics })
    },
  })

  const createTask = useMutation({
    mutationFn: () =>
      api.tasks.create({
        title: quickTask.trim(),
        due_date: selected,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.tasks })
      void queryClient.invalidateQueries({ queryKey: qk.analytics })
      setQuickTask('')
      showToast('Задача добавлена на этот день.', 'success')
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : 'Не удалось добавить задачу.', 'error')
    },
  })

  const selectDay = (date: Date) => {
    const value = iso(date)
    setSelected(value)
    if (format(date, 'yyyy-MM') !== format(viewMonth, 'yyyy-MM')) {
      setViewMonth(startOfMonth(date))
    }
  }

  const shiftDay = (delta: number) => {
    const next = addDays(selectedDate, delta)
    setSelected(iso(next))
    if (format(next, 'yyyy-MM') !== format(viewMonth, 'yyyy-MM')) {
      setViewMonth(startOfMonth(next))
    }
  }

  const changeMonth = (direction: -1 | 1) => {
    const next = direction === -1 ? previousMonth(viewMonth) : nextMonth(viewMonth)
    setViewMonth(startOfMonth(next))
    if (format(next, 'yyyy-MM') !== selected.slice(0, 7)) {
      setSelected(iso(startOfMonth(next)))
    }
  }

  const goToday = () => {
    setSelected(today)
    setViewMonth(startOfMonth(new Date()))
  }

  const openCreateEvent = (date: string) => setModalState({ event: null, date })

  const submitQuickTask = (event: FormEvent) => {
    event.preventDefault()
    if (!quickTask.trim() || createTask.isPending) return
    createTask.mutate()
  }

  const loading = eventsQuery.isPending || tasksQuery.isPending
  const failed = eventsQuery.isError || tasksQuery.isError

  return (
    <div className="calendar-page">
      <PageHeader
        eyebrow="Время и встречи"
        title="Календарь"
        description="События, дедлайны и задачи в одном ритме. Выбери день, чтобы увидеть детали или добавить новое."
        actions={
          <>
            <button className="btn btn-ghost" onClick={goToday}>
              Сегодня
            </button>
            <button className="btn btn-primary" onClick={() => openCreateEvent(selected)}>
              <Plus size={16} /> Новое событие
            </button>
          </>
        }
      />

      <div className="calendar-layout">
        <section className="calendar-card">
          <div className="calendar-toolbar">
            <div>
              <h2 className="calendar-month">{formatMonthTitle(viewMonth)}</h2>
              <span className="calendar-month-meta">
                {monthEventsCount} {monthEventsCount === 1 ? 'событие' : monthEventsCount < 5 ? 'события' : 'событий'} в этом месяце
              </span>
            </div>
            <div className="calendar-nav">
              <button
                type="button"
                className="icon-btn calendar-nav-btn"
                onClick={() => changeMonth(-1)}
                aria-label="Предыдущий месяц"
              >
                <ChevronLeft size={18} />
              </button>
              <button type="button" className="calendar-today-btn" onClick={goToday}>
                Сегодня
              </button>
              <button
                type="button"
                className="icon-btn calendar-nav-btn"
                onClick={() => changeMonth(1)}
                aria-label="Следующий месяц"
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>

          {loading ? (
            <div className="calendar-skeleton">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton className="calendar-skeleton-row" key={index} />
              ))}
            </div>
          ) : failed ? (
            <EmptyState
              icon={CalendarDays}
              title="Календарь не загрузился"
              description="Не удалось получить события или задачи. Проверь соединение и попробуй ещё раз."
              action={
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    void eventsQuery.refetch()
                    void tasksQuery.refetch()
                  }}
                >
                  Повторить
                </button>
              }
            />
          ) : (
            <>
              <div className="calendar-weekdays">
                {WEEKDAYS.map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className="calendar-grid">
                {days.map((day) => {
                  const dayIso = iso(day)
                  const dayEvents = eventsByDate.get(dayIso) || []
                  const dayTasks = openTasksByDate.get(dayIso) || []
                  const total = dayEvents.length + dayTasks.length
                  const visibleEvents = dayEvents.slice(0, 2)
                  const remainingSlots = Math.max(0, 2 - visibleEvents.length)
                  const visibleTasks = dayTasks.slice(0, remainingSlots)
                  const hidden = total - visibleEvents.length - visibleTasks.length
                  const cellClass = [
                    'cal-cell',
                    format(day, 'MM') !== format(viewMonth, 'MM') ? 'is-other-month' : '',
                    dayIso === today ? 'is-today' : '',
                    dayIso === selected ? 'is-selected' : '',
                    total > 0 ? 'has-items' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')
                  return (
                    <div
                      key={dayIso}
                      className={cellClass}
                      role="button"
                      tabIndex={0}
                      aria-pressed={dayIso === selected}
                      aria-label={formatFullDate(day)}
                      onClick={() => selectDay(day)}
                      onDoubleClick={() => openCreateEvent(dayIso)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          selectDay(day)
                        }
                      }}
                    >
                      <div className="cal-day-top">
                        <span className="cal-day-num">{format(day, 'd')}</span>
                        {dayIso === today && <span className="cal-today-label">сегодня</span>}
                      </div>
                      <div className="cal-items">
                        {visibleEvents.map((event) => (
                          <span className="cal-item is-event" key={event.id}>
                            <span className="cal-dot" />
                            <span className="cal-item-label">{event.title}</span>
                          </span>
                        ))}
                        {visibleTasks.map((task) => (
                          <span className="cal-item is-task" key={task.id}>
                            <span className="cal-dot" />
                            <span className="cal-item-label">{task.title}</span>
                          </span>
                        ))}
                        {hidden > 0 && <span className="cal-more">+{hidden}</span>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </section>

        <aside className="day-panel">
          <div className="day-panel-head">
            <div>
              <span className="day-panel-weekday">{formatWeekdayLong(selectedDate)}</span>
              <h2 className="day-panel-date">{formatDayMonth(selectedDate)}</h2>
            </div>
            <div className="day-panel-controls">
              <button
                type="button"
                className="icon-btn tiny-btn"
                onClick={() => shiftDay(-1)}
                aria-label="Предыдущий день"
              >
                <ChevronLeft size={16} />
              </button>
              <button
                type="button"
                className="icon-btn tiny-btn"
                onClick={() => shiftDay(1)}
                aria-label="Следующий день"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>

          <button
            type="button"
            className="day-add-event"
            onClick={() => openCreateEvent(selected)}
          >
            <Plus size={16} /> Событие на этот день
          </button>

          <div className="day-section">
            <div className="day-section-head">
              <span>События</span>
              <span className="day-section-count">{selectedEvents.length}</span>
            </div>
            {selectedEvents.length === 0 ? (
              <p className="day-empty-line">Событий нет.</p>
            ) : (
              <div className="day-events">
                {selectedEvents.map((event) => (
                  <button
                    type="button"
                    className="day-event"
                    key={event.id}
                    onClick={() => setModalState({ event, date: selected })}
                  >
                    <span className={`day-event-time ${event.all_day ? 'is-allday' : ''}`}>
                      {eventTimeLabel(event)}
                    </span>
                    <span className="day-event-copy">
                      <strong>{event.title}</strong>
                      {event.location && (
                        <small>
                          <MapPin size={11} /> {event.location}
                        </small>
                      )}
                    </span>
                    {event.attachments.length > 0 && (
                      <span className="day-event-attach">
                        <Paperclip size={12} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="day-section">
            <div className="day-section-head">
              <span>Задачи</span>
              <span className="day-section-count">{selectedTasks.length}</span>
            </div>
            {selectedTasks.length === 0 ? (
              <p className="day-empty-line">На этот день задач нет.</p>
            ) : (
              <ul className="day-tasks">
                {selectedTasks.map((task) => (
                  <li className={task.completed ? 'is-completed' : ''} key={task.id}>
                    <button
                      type="button"
                      className={`task-check ${task.completed ? 'is-checked' : ''}`}
                      onClick={() =>
                        toggleTask.mutate({ task, completed: !task.completed })
                      }
                      aria-label={
                        task.completed ? 'Вернуть в работу' : 'Отметить выполненной'
                      }
                      aria-pressed={task.completed}
                    >
                      {task.completed && <Check size={12} strokeWidth={3} />}
                    </button>
                    <Link to={`/tasks?task=${task.id}`} className="day-task-link">
                      <span>{task.title}</span>
                      {task.due_time && <small>{task.due_time}</small>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <form className="day-task-add" onSubmit={submitQuickTask}>
              <Plus size={15} />
              <input
                value={quickTask}
                onChange={(event) => setQuickTask(event.target.value)}
                placeholder="Задача на этот день…"
                aria-label="Новая задача на выбранный день"
              />
              <button type="submit" disabled={!quickTask.trim() || createTask.isPending}>
                {createTask.isPending ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <ChevronRight size={15} />
                )}
                <span className="sr-only">Добавить</span>
              </button>
            </form>
          </div>
        </aside>
      </div>

      {modalState && (
        <EventModal
          event={modalState.event}
          initialDate={modalState.date}
          onClose={() => setModalState(null)}
        />
      )}
    </div>
  )
}
