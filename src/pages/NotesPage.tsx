import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRight,
  Lightbulb,
  NotebookPen,
  NotebookText,
  Paperclip,
  Pin,
  Plus,
  Search,
  SearchX,
  X,
} from 'lucide-react'
import type { Note, NoteKind } from '../../shared/types'
import { api } from '../lib/api'
import { qk, useNotes } from '../lib/hooks'
import { useDebounce } from '../hooks/useDebounce'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatRelative, notesWord, stripMarkdown } from '../lib/date'
import { NOTE_KIND_META } from '../lib/meta'
import { useToast } from '../context/ToastContext'
import { EmptyState, PageHeader } from '../components/ui'

type NotesFilter = 'all' | NoteKind

const FILTERS: { value: NotesFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'note', label: 'Заметки' },
  { value: 'lesson', label: 'Уроки' },
  { value: 'idea', label: 'Идеи' },
]

function NoteCard({ note }: { note: Note }) {
  const meta = NOTE_KIND_META[note.kind]
  const Icon = meta.icon
  const excerpt = stripMarkdown(note.body).slice(0, 190)
  return (
    <Link to={`/notes/${note.id}`} className={`note-card tone-${meta.tone} is-${note.kind}`}>
      <div className="note-card-top">
        <span className="note-kind">
          <Icon size={13} strokeWidth={2} />
          {meta.label}
        </span>
        {note.pinned && (
          <span className="note-pin" title="Закреплена">
            <Pin size={13} />
          </span>
        )}
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
      <span className="note-card-arrow">
        <ArrowUpRight size={15} />
      </span>
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

  const notesQuery = useNotes({
    kind: filter === 'all' ? undefined : filter,
    q: debouncedSearch.trim() || undefined,
  })
  const notes = notesQuery.data || []

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

  return (
    <div className="notes-page">
      <PageHeader
        eyebrow="Мысли и знания"
        title="Заметки"
        description="Конспекты, идеи и всё, что стоит сохранить. Markdown, вложения и поиск по смыслу — под рукой."
        actions={
          <button
            className="btn btn-primary"
            onClick={() => createNote.mutate()}
            disabled={createNote.isPending}
          >
            <Plus size={17} /> Новая заметка
          </button>
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
                    <NoteCard key={note.id} note={note} />
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
                    <NoteCard key={note.id} note={note} />
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
                  <NoteCard key={note.id} note={note} />
                ))}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}
