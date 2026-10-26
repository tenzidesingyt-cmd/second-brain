import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowUpRight,
  Check,
  CheckCircle2,
  Lightbulb,
  ListChecks,
  Loader2,
  NotebookPen,
  NotebookText,
  Paperclip,
  Pin,
  Plus,
  Search,
  SearchX,
  Undo2,
  X,
} from 'lucide-react'
import { AI_EDIT_MAX_NOTES } from '../../shared/types'
import type { Note, NoteKind, NotesAiEditResponse } from '../../shared/types'
import { api } from '../lib/api'
import { qk, useAiSettings, useNotes } from '../lib/hooks'
import { useDebounce } from '../hooks/useDebounce'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatRelative, notesWord, pluralRu, stripMarkdown } from '../lib/date'
import { NOTE_KIND_META } from '../lib/meta'
import { useToast } from '../context/ToastContext'
import { EmptyState, PageHeader } from '../components/ui'
import { AiEditComposer } from '../components/AiEditComposer'

type NotesFilter = 'all' | NoteKind

const FILTERS: { value: NotesFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'note', label: 'Заметки' },
  { value: 'lesson', label: 'Уроки' },
  { value: 'idea', label: 'Идеи' },
]

function NoteCard({
  note,
  selecting,
  selected,
  onToggle,
}: {
  note: Note
  selecting?: boolean
  selected?: boolean
  onToggle?: (id: string) => void
}) {
  const meta = NOTE_KIND_META[note.kind]
  const Icon = meta.icon
  const excerpt = stripMarkdown(note.body).slice(0, 190)
  const className = [
    'note-card',
    `tone-${meta.tone}`,
    `is-${note.kind}`,
    selecting ? 'is-selecting' : '',
    selected ? 'is-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const content = (
    <>
      <div className="note-card-top">
        <span className="note-kind">
          <Icon size={13} strokeWidth={2} />
          {meta.label}
        </span>
        <span className="note-card-top-right">
          {note.pinned && (
            <span className="note-pin" title="Закреплена">
              <Pin size={13} />
            </span>
          )}
          {selecting && (
            <span className={`note-select ${selected ? 'is-on' : ''}`} aria-hidden="true">
              {selected && <Check size={12} strokeWidth={3} />}
            </span>
          )}
        </span>
      </div>
      <h3 className="note-card-title">{note.title || 'Без названия'}</h3>
      <p className={`note-card-excerpt ${excerpt ? '' : 'is-empty'}`}>
        {excerpt || 'Пустая заметка — открой и добавь мысли.'}
      </p>
      <div className="note-card-foot">
        <span className="note-card-time">{formatRelative(note.updated_at)}</span>
        <span className="note-card-foot-right">
          {note.attachments.length > 0 && (
            <span className="note-attach-count" title="Вложения">
              <Paperclip size={12} /> {note.attachments.length}
            </span>
          )}
          {note.tags.slice(0, 2).map((tag) => (
            <span className="note-tag" key={tag}>
              #{tag}
            </span>
          ))}
          {note.tags.length > 2 && <span className="note-tag">+{note.tags.length - 2}</span>}
        </span>
      </div>
      {!selecting && (
        <span className="note-card-arrow">
          <ArrowUpRight size={15} />
        </span>
      )}
    </>
  )

  if (selecting) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => onToggle?.(note.id)}
        aria-pressed={Boolean(selected)}
      >
        {content}
      </button>
    )
  }

  return (
    <Link to={`/notes/${note.id}`} className={className}>
      {content}
    </Link>
  )
}

function NotesSkeleton() {
  return (
    <div className="notes-grid">
      {Array.from({ length: 6 }).map((_, index) => (
        <div className="note-card-skeleton" key={index}>
          <span className="skeleton note-skeleton-badge" />
          <span className="skeleton note-skeleton-title" />
          <span className="skeleton note-skeleton-line" />
          <span className="skeleton note-skeleton-line short" />
        </div>
      ))}
    </div>
  )
}

export function NotesPage() {
  useDocumentTitle('Заметки')
  const [filter, setFilter] = useState<NotesFilter>('all')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 260)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [aiPending, setAiPending] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiResult, setAiResult] = useState<NotesAiEditResponse | null>(null)
  const [undoPending, setUndoPending] = useState(false)

  const notesQuery = useNotes({
    kind: filter === 'all' ? undefined : filter,
    q: debouncedSearch.trim() || undefined,
  })
  const notes = notesQuery.data || []
  const aiSettings = useAiSettings()
  const aiReady = Boolean(aiSettings.data?.configured)

  useEffect(() => {
    setSelectedIds([])
    setAiResult(null)
    setAiError(null)
  }, [filter, debouncedSearch])

  const createNote = useMutation({
    mutationFn: () =>
      api.notes.create({
        title: '',
        body: '',
        kind: filter === 'all' ? 'note' : filter,
        tags: [],
      }),
    onSuccess: (note) => {
      void queryClient.invalidateQueries({ queryKey: qk.notes })
      navigate(`/notes/${note.id}`)
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : 'Не удалось создать заметку.', 'error')
    },
  })

  const pinned = useMemo(() => notes.filter((note) => note.pinned), [notes])
  const regular = useMemo(() => notes.filter((note) => !note.pinned), [notes])
  const isSearching = Boolean(debouncedSearch.trim())
  const showSections = !isSearching && filter === 'all' && pinned.length > 0

  const aiContexts = useMemo(() => {
    const byId = new Map(notes.map((note) => [note.id, note]))
    for (const note of aiResult?.notes || []) {
      if (!byId.has(note.id)) byId.set(note.id, note)
    }
    return selectedIds.map((id) => ({
      id,
      title: byId.get(id)?.title || 'Заметка',
    }))
  }, [notes, selectedIds, aiResult])

  const aiChangedCount = aiResult?.changes.filter((change) => change.changed).length ?? 0

  const closeSelection = () => {
    setSelecting(false)
    setSelectedIds([])
    setAiResult(null)
    setAiError(null)
  }

  const toggleSelection = (id: string) => {
    setAiError(null)
    setAiResult(null)
    if (selectedIds.includes(id)) {
      setSelectedIds(selectedIds.filter((item) => item !== id))
      return
    }
    if (selectedIds.length >= AI_EDIT_MAX_NOTES) {
      showToast(`Можно выбрать не больше ${AI_EDIT_MAX_NOTES} заметок.`, 'info')
      return
    }
    setSelectedIds([...selectedIds, id])
  }

  const removeFromSelection = (id: string) => {
    setSelectedIds((current) => current.filter((item) => item !== id))
    setAiResult(null)
    setAiError(null)
  }

  const submitAiEdit = async (instruction: string) => {
    if (!selectedIds.length) {
      showToast('Сначала выбери заметки.', 'info')
      return false
    }
    setAiPending(true)
    setAiError(null)
    try {
      const response = await api.notes.aiEdit(selectedIds, instruction)
      for (const note of response.notes) {
        queryClient.setQueryData(qk.note(note.id), note)
      }
      await queryClient.invalidateQueries({ queryKey: ['notes', 'list'] })
      setAiResult(response)
      const changed = response.changes.filter((change) => change.changed).length
      if (response.errors.length) {
        setAiError(response.errors[0].error)
        showToast(`ИИ обновил ${changed} из ${selectedIds.length}.`, 'info')
      } else if (changed) {
        showToast(
          `ИИ обновил ${changed} ${pluralRu(changed, 'заметку', 'заметки', 'заметок')}.`,
          'success',
        )
      } else {
        showToast('ИИ не нашёл, что изменить.', 'info')
      }
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось изменить заметки.'
      setAiError(message)
      showToast(message, 'error')
      return false
    } finally {
      setAiPending(false)
    }
  }

  const undoAiEdit = async () => {
    if (!aiResult) return
    const changed = aiResult.changes.filter((change) => change.changed)
    if (!changed.length) return
    setUndoPending(true)
    setAiError(null)
    try {
      const restored = await Promise.all(
        changed.map((change) => api.notes.update(change.id, change.before)),
      )
      for (const note of restored) {
        queryClient.setQueryData(qk.note(note.id), note)
      }
      await queryClient.invalidateQueries({ queryKey: ['notes', 'list'] })
      setAiResult(null)
      showToast('Изменения ИИ отменены.', 'success')
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Не удалось вернуть прежний текст заметок.'
      setAiError(message)
      showToast(message, 'error')
    } finally {
      setUndoPending(false)
    }
  }

  return (
    <div className={`notes-page ${selecting ? 'is-selecting' : ''}`}>
      <PageHeader
        eyebrow="Мысли и знания"
        title="Заметки"
        description="Конспекты, идеи и всё, что стоит сохранить. Markdown, вложения и поиск по смыслу — под рукой."
        actions={
          <div className="notes-head-actions">
            <button
              type="button"
              className={`btn ${selecting ? 'btn-soft' : 'btn-ghost'}`}
              onClick={() => (selecting ? closeSelection() : setSelecting(true))}
            >
              {selecting ? <X size={16} /> : <ListChecks size={16} />}
              {selecting ? 'Отмена' : 'Выбрать'}
            </button>
            {!selecting && (
              <button
                className="btn btn-primary"
                onClick={() => createNote.mutate()}
                disabled={createNote.isPending}
              >
                <Plus size={17} /> Новая заметка
              </button>
            )}
          </div>
        }
      />

      <div className="notes-toolbar">
        <div className="notes-filters" role="tablist" aria-label="Тип заметок">
          {FILTERS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              role="tab"
              aria-selected={filter === entry.value}
              className={`chip ${filter === entry.value ? 'is-active' : ''}`}
              onClick={() => setFilter(entry.value)}
            >
              {entry.label}
            </button>
          ))}
        </div>

        <div className="notes-search">
          <Search size={16} className="notes-search-icon" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Найти заметку…"
            className="notes-search-input"
            aria-label="Поиск по заметкам"
          />
          {search && (
            <button
              type="button"
              className="icon-btn tiny-btn notes-search-clear"
              onClick={() => setSearch('')}
              aria-label="Очистить поиск"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {selecting && (
        <div className="notes-select-bar">
          <span className="notes-select-summary">
            <span className={`notes-select-badge ${selectedIds.length ? 'is-on' : ''}`}>
              <Check size={13} strokeWidth={3} />
            </span>
            <span>
              {selectedIds.length
                ? `Выбрано: ${selectedIds.length} из ${AI_EDIT_MAX_NOTES}`
                : 'Отметь заметки, с которыми должен работать ИИ'}
            </span>
          </span>
          <span className="notes-select-actions">
            {selectedIds.length > 0 && (
              <button
                type="button"
                className="tiny-link"
                onClick={() => {
                  setSelectedIds([])
                  setAiResult(null)
                  setAiError(null)
                }}
              >
                Снять выбор
              </button>
            )}
            <span className="notes-select-hint">Остальные заметки ИИ не тронет</span>
          </span>
        </div>
      )}

      {notesQuery.isPending ? (
        <NotesSkeleton />
      ) : notesQuery.isError ? (
        <EmptyState
          icon={NotebookPen}
          title="Заметки не загрузились"
          description={
            notesQuery.error instanceof Error ? notesQuery.error.message : 'Проверь соединение.'
          }
          action={
            <button className="btn btn-ghost" onClick={() => void notesQuery.refetch()}>
              Повторить
            </button>
          }
        />
      ) : notes.length === 0 ? (
        isSearching ? (
          <EmptyState
            icon={SearchX}
            title="Ничего не нашлось"
            description={`По запросу «${debouncedSearch.trim()}» нет заметок. Попробуй другие слова или спроси у ИИ через поиск.`}
            action={
              <button className="btn btn-ghost btn-small" onClick={() => setSearch('')}>
                Очистить поиск
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={filter === 'idea' ? Lightbulb : NotebookText}
            title={filter === 'all' ? 'Пока ни одной заметки' : 'В этом разделе пусто'}
            description="Сохраняй конспекты, идеи и наблюдения. Всё в Markdown, с фото и файлами — и всегда под рукой на любом устройстве."
            action={
              <button
                className="btn btn-soft"
                onClick={() => createNote.mutate()}
                disabled={createNote.isPending}
              >
                <Plus size={16} /> Создать заметку
              </button>
            }
          />
        )
      ) : (
        <>
          {showSections ? (
            <>
              <div className="notes-section">
                <div className="notes-section-head">
                  <span>
                    <Pin size={13} /> Закреплённые
                  </span>
                  <span>{notesWord(pinned.length)}</span>
                </div>
                <div className="notes-grid">
                  {pinned.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      selecting={selecting}
                      selected={selectedIds.includes(note.id)}
                      onToggle={toggleSelection}
                    />
                  ))}
                </div>
              </div>
              <div className="notes-section">
                <div className="notes-section-head">
                  <span>Все заметки</span>
                  <span>{notesWord(regular.length)}</span>
                </div>
                <div className="notes-grid">
                  {regular.map((note) => (
                    <NoteCard
                      key={note.id}
                      note={note}
                      selecting={selecting}
                      selected={selectedIds.includes(note.id)}
                      onToggle={toggleSelection}
                    />
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              {isSearching && (
                <p className="notes-result-line">
                  {notesWord(notes.length)} по запросу «{debouncedSearch.trim()}»
                </p>
              )}
              <div className="notes-grid">
                {notes.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    selecting={selecting}
                    selected={selectedIds.includes(note.id)}
                    onToggle={toggleSelection}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {selecting && (
        <div className="notes-ai-dock">
          <AiEditComposer
            contexts={aiContexts}
            onSubmit={submitAiEdit}
            pending={aiPending}
            aiReady={aiReady}
            onRemove={removeFromSelection}
            hint="Опиши изменение — ИИ перепишет только выбранные заметки."
            error={aiError}
          >
            {aiResult && (
              <div className="ai-edit-result">
                <div className="ai-edit-result-head">
                  <span className={`ai-edit-result-icon ${aiChangedCount ? 'is-success' : 'is-idle'}`}>
                    <CheckCircle2 size={15} />
                  </span>
                  <strong>
                    {aiChangedCount
                      ? `ИИ обновил ${aiChangedCount} ${pluralRu(aiChangedCount, 'заметку', 'заметки', 'заметок')}`
                      : 'ИИ не нашёл, что изменить'}
                  </strong>
                  {aiChangedCount > 0 && (
                    <button
                      type="button"
                      className="ai-edit-undo"
                      onClick={() => void undoAiEdit()}
                      disabled={undoPending}
                    >
                      {undoPending ? (
                        <Loader2 size={12} className="spin" />
                      ) : (
                        <Undo2 size={12} />
                      )}
                      Вернуть
                    </button>
                  )}
                </div>

                <ul className="ai-edit-result-list">
                  {aiResult.changes.map((change) => {
                    const note = aiResult.notes.find((item) => item.id === change.id)
                    return (
                      <li key={change.id}>
                        <span className="ai-edit-result-title">
                          {note?.title || 'Без названия'}
                        </span>
                        <span
                          className={`ai-edit-result-summary ${change.changed ? '' : 'is-muted'}`}
                        >
                          {change.summary}
                        </span>
                      </li>
                    )
                  })}
                </ul>

                {aiResult.errors.map((entry) => (
                  <p className="ai-edit-result-error" key={entry.id}>
                    <AlertCircle size={12} /> «{entry.title}»: {entry.error}
                  </p>
                ))}
              </div>
            )}
          </AiEditComposer>
        </div>
      )}
    </div>
  )
}
