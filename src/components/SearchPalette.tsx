import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  CheckSquare,
  CornerDownLeft,
  Inbox,
  Loader2,
  NotebookText,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { api } from '../lib/api'
import { useAiSettings, useSearch } from '../lib/hooks'
import { useDebounce } from '../hooks/useDebounce'
import {
  formatDueLabel,
  formatRelative,
  stripMarkdown,
  tasksWord,
  notesWord,
} from '../lib/date'
import type { AISearchResponse, InboxItem, Note, Task } from '../../shared/types'
import { Markdown } from './Markdown'

interface SearchPaletteProps {
  open: boolean
  onClose: () => void
}

const SUGGESTIONS = ['Что я записывал про учёбу?', 'Идеи для проекта', 'Задачи на неделю']

export function SearchPalette({ open, onClose }: SearchPaletteProps) {
  const [query, setQuery] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState('')
  const [aiResult, setAiResult] = useState<AISearchResponse | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const debounced = useDebounce(query, 220)
  const search = useSearch(debounced, open)
  const aiSettings = useAiSettings()
  const aiReady = Boolean(aiSettings.data?.configured)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setAiResult(null)
    setAiError('')
    const timer = window.setTimeout(() => inputRef.current?.focus(), 80)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.clearTimeout(timer)
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  useEffect(() => {
    setAiResult(null)
    setAiError('')
  }, [debounced])

  const results = search.data
  const totalResults = useMemo(
    () => (results ? results.notes.length + results.tasks.length + results.inbox.length : 0),
    [results],
  )

  if (!open) return null

  const go = (path: string) => {
    onClose()
    navigate(path)
  }

  const askAi = async () => {
    const text = query.trim()
    if (!text || aiLoading || !aiReady) return
    setAiLoading(true)
    setAiError('')
    setAiResult(null)
    try {
      setAiResult(await api.ai.search(text))
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'ИИ не смог ответить.')
    } finally {
      setAiLoading(false)
    }
  }

  const renderNote = (note: Note) => (
    <button key={note.id} className="palette-result" onClick={() => go(`/notes/${note.id}`)}>
      <span className="palette-result-icon tone-blue">
        <NotebookText size={17} />
      </span>
      <span className="palette-result-copy">
        <span className="palette-result-title">{note.title || 'Без названия'}</span>
        <span className="palette-result-meta">
          {formatRelative(note.updated_at)} · {note.kind === 'lesson' ? 'Урок' : note.kind === 'idea' ? 'Идея' : 'Заметка'}
        </span>
      </span>
      <ArrowRight size={15} className="palette-arrow" />
    </button>
  )

  const renderTask = (task: Task) => (
    <button key={task.id} className="palette-result" onClick={() => go(`/tasks?task=${task.id}`)}>
      <span className={`palette-result-icon tone-green ${task.completed ? 'is-completed' : ''}`}>
        <CheckSquare size={17} />
      </span>
      <span className="palette-result-copy">
        <span className={`palette-result-title ${task.completed ? 'is-done' : ''}`}>{task.title}</span>
        <span className="palette-result-meta">
          {task.completed
            ? 'Выполнено'
            : task.due_date
              ? formatDueLabel(task.due_date, task.due_time)
              : 'Без срока'}
        </span>
      </span>
      <ArrowRight size={15} className="palette-arrow" />
    </button>
  )

  const renderInbox = (item: InboxItem) => (
    <button key={item.id} className="palette-result" onClick={() => go('/inbox')}>
      <span className="palette-result-icon tone-amber">
        <Inbox size={17} />
      </span>
      <span className="palette-result-copy">
        <span className="palette-result-title">
          {item.text || item.files[0]?.name || 'Запись из инбокса'}
        </span>
        <span className="palette-result-meta">В инбоксе · {formatRelative(item.created_at)}</span>
      </span>
      <ArrowRight size={15} className="palette-arrow" />
    </button>
  )

  return createPortal(
    <div
      className="palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Поиск">
        <div className="palette-input-row">
          <Search size={20} className="palette-search-icon" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Поиск по заметкам, задачам и инбоксу…"
            className="palette-input"
            aria-label="Поисковый запрос"
          />
          {search.isFetching && <Loader2 size={17} className="spin palette-loader" />}
          <button className="icon-btn palette-close" onClick={onClose} aria-label="Закрыть поиск">
            <X size={17} />
          </button>
        </div>

        <div className="palette-body">
          {!query.trim() && (
            <div className="palette-idle">
              <div className="palette-idle-title">Найти что угодно</div>
              <p className="palette-idle-copy">
                Ищи по заголовкам, тексту заметок и задачам. А если не помнишь формулировку —
                спроси у ИИ.
              </p>
              <div className="palette-suggestions">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    className="suggestion-chip"
                    onClick={() => {
                      setQuery(suggestion)
                      inputRef.current?.focus()
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          {query.trim() && (
            <>
              <div className={`ai-ask-row ${!aiReady ? 'is-disabled' : ''}`}>
                <div className="ai-ask-copy">
                  <span className="ai-ask-icon">
                    <Sparkles size={16} />
                  </span>
                  <span>
                    <strong>Спросить ИИ</strong>
                    <small>
                      {aiReady
                        ? 'Найдёт по смыслу, даже если слова другие'
                        : 'Нужен ключ OpenRouter'}
                    </small>
                  </span>
                </div>
                {aiReady ? (
                  <button
                    className="btn btn-soft btn-small"
                    onClick={askAi}
                    disabled={aiLoading || query.trim().length < 2}
                  >
                    {aiLoading ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
                    {aiLoading ? 'Думаю…' : 'Спросить'}
                  </button>
                ) : (
                  <button className="btn btn-ghost btn-small" onClick={() => go('/settings')}>
                    Подключить
                  </button>
                )}
              </div>

              {aiError && <div className="palette-error">{aiError}</div>}

              {aiResult && (
                <div className="palette-ai-result">
                  <div className="palette-ai-label">
                    <Sparkles size={14} /> Ответ ИИ
                  </div>
                  <Markdown>{aiResult.answer}</Markdown>
                  {aiResult.notes.length > 0 && (
                    <div className="palette-ai-notes">
                      {aiResult.notes.map(renderNote)}
                    </div>
                  )}
                </div>
              )}

              <div className="palette-results">
                {search.isPending && query.trim() ? (
                  <div className="palette-loading-row">
                    <Loader2 size={18} className="spin" /> Ищу в твоём мозге…
                  </div>
                ) : totalResults === 0 ? (
                  <div className="palette-empty">
                    Ничего не нашлось. Попробуй другое слово{aiReady ? ' или спроси у ИИ' : ''}.
                  </div>
                ) : (
                  <>
                    {results && results.notes.length > 0 && (
                      <div className="palette-group">
                        <div className="palette-group-title">
                          Заметки <span>{results.notes.length}</span>
                        </div>
                        {results.notes.slice(0, 4).map(renderNote)}
                      </div>
                    )}
                    {results && results.tasks.length > 0 && (
                      <div className="palette-group">
                        <div className="palette-group-title">
                          Задачи <span>{results.tasks.length}</span>
                        </div>
                        {results.tasks.slice(0, 4).map(renderTask)}
                      </div>
                    )}
                    {results && results.inbox.length > 0 && (
                      <div className="palette-group">
                        <div className="palette-group-title">
                          Инбокс <span>{results.inbox.length}</span>
                        </div>
                        {results.inbox.slice(0, 3).map(renderInbox)}
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        <div className="palette-footer">
          <span className="palette-hints">
            <kbd>Esc</kbd> закрыть
          </span>
          <span className="palette-hints">
            <CornerDownLeft size={13} /> выбрать
          </span>
          <span className="palette-hints palette-hints-right">
            {notesWord(results?.notes.length || 0)} · {tasksWord(results?.tasks.length || 0)}
          </span>
        </div>
      </div>
    </div>,
    document.body,
  )
}
