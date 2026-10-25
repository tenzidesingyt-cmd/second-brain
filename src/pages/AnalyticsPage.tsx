import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addDays } from 'date-fns'
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Flame,
  Inbox,
  ListChecks,
  Loader2,
  NotebookPen,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import type { WeekAnalytics } from '../../shared/types'
import { api } from '../lib/api'
import { qk, useAiSettings, useAnalytics } from '../lib/hooks'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import {
  currentTimezone,
  formatRelative,
  formatWeekRange,
  formatWeekdayShort,
  iso,
  parseLocal,
  weekStart,
} from '../lib/date'
import { useToast } from '../context/ToastContext'
import { Markdown } from '../components/Markdown'
import { EmptyState, PageHeader, Skeleton } from '../components/ui'

export function AnalyticsPage() {
  useDocumentTitle('Аналитика')
  const [weekStartDate, setWeekStartDate] = useState(() => weekStart())
  const weekStartIso = iso(weekStartDate)
  const currentWeekIso = iso(weekStart())
  const isCurrentWeek = weekStartIso === currentWeekIso

  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const analytics = useAnalytics(weekStartIso)
  const aiSettings = useAiSettings()
  const aiReady = Boolean(aiSettings.data?.configured)
  const data = analytics.data

  const generateSummary = useMutation({
    mutationFn: (targetWeek: string) => api.analytics.summary(targetWeek, currentTimezone()),
    onSuccess: (summary, targetWeek) => {
      queryClient.setQueryData<WeekAnalytics>(qk.analyticsWeek(targetWeek), (current) =>
        current ? { ...current, summary } : current,
      )
      showToast('Итоги недели готовы.', 'success')
    },
  })

  const generating = generateSummary.isPending && generateSummary.variables === weekStartIso
  const summaryError =
    generateSummary.variables === weekStartIso && generateSummary.error
      ? generateSummary.error instanceof Error
        ? generateSummary.error.message
        : 'Не удалось собрать итоги.'
      : ''

  const shiftWeek = (direction: -1 | 1) => {
    setWeekStartDate((current) => addDays(current, direction * 7))
  }

  const bestDay = useMemo(() => {
    if (!data) return null
    const best = [...data.daily].sort((a, b) => b.completed - a.completed)[0]
    if (!best || best.completed === 0) return null
    const parsed = parseLocal(best.date)
    return parsed ? { date: parsed, count: best.completed } : null
  }, [data])

  const maxDaily = useMemo(() => {
    if (!data) return 1
    return Math.max(1, ...data.daily.flatMap((day) => [day.completed, day.created]))
  }, [data])

  const stats = data
    ? [
        {
          key: 'completed',
          label: 'Выполнено',
          value: data.tasks_completed,
          hint: 'задач за неделю',
          icon: CheckCircle2,
          tone: 'green',
        },
        {
          key: 'open',
          label: 'В работе',
          value: data.tasks_open,
          hint: 'открыто сейчас',
          icon: ListChecks,
          tone: 'accent',
        },
        {
          key: 'overdue',
          label: 'Просрочено',
          value: data.tasks_overdue,
          hint: 'требует внимания',
          icon: CircleAlert,
          tone: 'coral',
        },
        {
          key: 'notes',
          label: 'Заметок',
          value: data.notes_created,
          hint: 'создано за неделю',
          icon: NotebookPen,
          tone: 'blue',
        },
      ]
    : []

  const inboxPercent = data?.inbox_captured
    ? Math.min(100, Math.round((data.inbox_processed / data.inbox_captured) * 100))
    : 0

  return (
    <div className="analytics-page">
      <PageHeader
        eyebrow="Взгляд сверху"
        title="Аналитика"
        description="Неделя без догадок: сколько сделано, где перегруз и что стоит поправить в ритме."
        actions={
          <div className="week-switcher">
            <button
              type="button"
              className="icon-btn week-nav-btn"
              onClick={() => shiftWeek(-1)}
              aria-label="Предыдущая неделя"
            >
              <ChevronLeft size={18} />
            </button>
            <div className="week-switcher-copy">
              <span>{data ? formatWeekRange(data.week_start, data.week_end) : formatWeekRange(weekStartIso, iso(addDays(weekStartDate, 6)))}</span>
              <small>{isCurrentWeek ? 'Текущая неделя' : 'Прошедшая неделя'}</small>
            </div>
            <button
              type="button"
              className="icon-btn week-nav-btn"
              onClick={() => shiftWeek(1)}
              disabled={isCurrentWeek}
              aria-label="Следующая неделя"
            >
              <ChevronRight size={18} />
            </button>
            {!isCurrentWeek && (
              <button
                type="button"
                className="week-today-btn"
                onClick={() => setWeekStartDate(weekStart())}
              >
                К текущей
              </button>
            )}
          </div>
        }
      />

      {analytics.isPending ? (
        <div className="analytics-skeleton">
          <div className="analytics-stats">
            {Array.from({ length: 4 }).map((_, index) => (
              <Skeleton className="analytics-stat-skeleton" key={index} />
            ))}
          </div>
          <div className="analytics-layout">
            <div className="analytics-main">
              <Skeleton className="analytics-card-skeleton" />
              <Skeleton className="analytics-chart-skeleton" />
            </div>
            <div className="analytics-aside">
              <Skeleton className="analytics-aside-skeleton" />
              <Skeleton className="analytics-aside-skeleton" />
            </div>
          </div>
        </div>
      ) : analytics.isError || !data ? (
        <EmptyState
          icon={BarChart3}
          title="Аналитика не загрузилась"
          description={
            analytics.error instanceof Error ? analytics.error.message : 'Проверь соединение.'
          }
          action={
            <button className="btn btn-ghost" onClick={() => void analytics.refetch()}>
              Повторить
            </button>
          }
        />
      ) : (
        <>
          <div className="analytics-stats">
            {stats.map((stat) => {
              const Icon = stat.icon
              return (
                <div className={`analytics-stat tone-${stat.tone}`} key={stat.key}>
                  <span className="analytics-stat-icon">
                    <Icon size={18} />
                  </span>
                  <span className="analytics-stat-copy">
                    <strong>{stat.value}</strong>
                    <span className="analytics-stat-label">{stat.label}</span>
                    <small>{stat.hint}</small>
                  </span>
                </div>
              )
            })}
          </div>

          <div className="analytics-layout">
            <div className="analytics-main">
              <section className={`summary-card ${data.summary ? 'has-summary' : ''}`}>
                <div className="summary-head">
                  <span className="summary-orb">
                    <Sparkles size={18} />
                  </span>
                  <div className="summary-head-copy">
                    <h2>Итоги недели</h2>
                    <p>ИИ читает задачи, заметки и привычки этой недели.</p>
                  </div>
                  {data.summary && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small summary-refresh"
                      onClick={() => generateSummary.mutate(weekStartIso)}
                      disabled={!aiReady || generateSummary.isPending}
                    >
                      {generating ? (
                        <Loader2 size={14} className="spin" />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                      Обновить
                    </button>
                  )}
                </div>

                {generating ? (
                  <div className="summary-loading">
                    <div className="summary-loading-head">
                      <Loader2 size={18} className="spin" />
                      <span>ИИ собирает картину недели…</span>
                    </div>
                    <Skeleton className="summary-loading-line" />
                    <Skeleton className="summary-loading-line medium" />
                    <Skeleton className="summary-loading-line short" />
                  </div>
                ) : data.summary ? (
                  <>
                    <div className="summary-content">
                      <Markdown>{data.summary.content}</Markdown>
                    </div>
                    <div className="summary-foot">
                      <span>Собрано {formatRelative(data.summary.created_at)}</span>
                      {!aiReady && <span>Подключи ИИ, чтобы обновлять сводку</span>}
                    </div>
                  </>
                ) : (
                  <div className="summary-empty">
                    <div className="summary-empty-copy">
                      <h3>Собрать картину недели?</h3>
                      <p>
                        ИИ посмотрит, что получилось, где накопилась нагрузка и на что
                        обратить внимание на следующей неделе.
                      </p>
                    </div>
                    {aiReady ? (
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => generateSummary.mutate(weekStartIso)}
                        disabled={generateSummary.isPending}
                      >
                        <Sparkles size={16} /> Собрать итоги
                      </button>
                    ) : (
                      <Link to="/settings" className="btn btn-soft">
                        <Sparkles size={16} /> Подключить ИИ
                      </Link>
                    )}
                  </div>
                )}

                {summaryError && <div className="form-error summary-error">{summaryError}</div>}
              </section>

              <section className="chart-card">
                <div className="chart-head">
                  <div>
                    <h2>Ритм недели</h2>
                    <p>Задачи по дням: созданные и выполненные.</p>
                  </div>
                  <div className="chart-legend">
                    <span className="chart-legend-item is-created">
                      <span /> Создано
                    </span>
                    <span className="chart-legend-item is-completed">
                      <span /> Выполнено
                    </span>
                  </div>
                </div>

                <div className="week-chart">
                  {data.daily.map((day) => {
                    const date = parseLocal(day.date)
                    return (
                      <div className="chart-day" key={day.date}>
                        <div className="chart-bars">
                          <span
                            className="chart-bar is-created"
                            style={{
                              height: day.created
                                ? `${Math.max(7, (day.created / maxDaily) * 100)}%`
                                : '0%',
                            }}
                            title={`Создано задач: ${day.created}`}
                          />
                          <span
                            className="chart-bar is-completed"
                            style={{
                              height: day.completed
                                ? `${Math.max(7, (day.completed / maxDaily) * 100)}%`
                                : '0%',
                            }}
                            title={`Выполнено задач: ${day.completed}`}
                          />
                        </div>
                        <span className="chart-day-week">{date ? formatWeekdayShort(date) : ''}</span>
                        <span className="chart-day-num">{date ? date.getDate() : ''}</span>
                      </div>
                    )
                  })}
                </div>

                <div className="chart-foot">
                  {bestDay ? (
                    <span>
                      Лучший день — <strong>{formatWeekdayShort(bestDay.date)}</strong>,{' '}
                      {bestDay.count} {bestDay.count === 1 ? 'задача' : 'задачи'}
                    </span>
                  ) : (
                    <span>На этой неделе ещё нет выполненных задач.</span>
                  )}
                  <span>К сроку: {data.tasks_due_in_week}</span>
                </div>
              </section>
            </div>

            <aside className="analytics-aside">
              <section className="inbox-pulse-card">
                <div className="pulse-head">
                  <span className="pulse-orb">
                    <Inbox size={18} />
                  </span>
                  <div>
                    <h2>Инбокс недели</h2>
                    <p>Что попало в голову и как это разобрано</p>
                  </div>
                </div>
                <div className="pulse-numbers">
                  <strong>{data.inbox_captured}</strong>
                  <span>{data.inbox_captured === 1 ? 'запись' : 'записей'} поймано</span>
                </div>
                <div className="pulse-bar">
                  <span style={{ width: `${inboxPercent}%` }} />
                </div>
                <div className="pulse-meta">
                  <span>{data.inbox_processed} разобрано</span>
                  <span>{inboxPercent}%</span>
                </div>
                <Link to="/inbox" className="pulse-link">
                  Открыть инбокс <ArrowRight size={14} />
                </Link>
              </section>

              <section className="habits-week-card">
                <div className="habits-week-head">
                  <span className="habits-week-orb">
                    <Flame size={17} />
                  </span>
                  <div>
                    <h2>Привычки</h2>
                    <p>Ритм важнее идеальности</p>
                  </div>
                  <Link to="/tasks" className="habits-week-link">
                    Настроить
                  </Link>
                </div>

                {data.habits.length === 0 ? (
                  <p className="habits-week-empty">
                    Привычек пока нет. Добавь пару маленьких шагов в разделе задач.
                  </p>
                ) : (
                  <div className="habits-week-list">
                    {data.habits.map((habit) => {
                      const percent = Math.min(
                        100,
                        Math.round((habit.week_done / habit.week_target) * 100),
                      )
                      return (
                        <div className="habit-week" key={habit.id}>
                          <div className="habit-week-top">
                            <span className="habit-week-emoji">{habit.emoji}</span>
                            <span className="habit-week-title">{habit.title}</span>
                            {habit.streak > 0 && (
                              <span className="habit-week-streak">
                                <Flame size={11} /> {habit.streak}
                              </span>
                            )}
                            <span className="habit-week-count">
                              {habit.week_done}/{habit.week_target}
                            </span>
                          </div>
                          <div className="habit-week-bar">
                            <span style={{ width: `${percent}%` }} />
                          </div>
                          <div className="habit-week-dots">
                            {data.daily.map((day) => {
                              const done = habit.logs.includes(day.date)
                              return (
                                <span
                                  key={day.date}
                                  className={`habit-week-dot ${done ? 'is-done' : ''}`}
                                  title={day.date}
                                />
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
            </aside>
          </div>
        </>
      )}
    </div>
  )
}
