import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircle,
  ArrowLeft,
  Bold,
  Check,
  Code2,
  Eye,
  FileQuestion,
  Heading2,
  Italic,
  Link2,
  List,
  ListChecks,
  Loader2,
  Paperclip,
  PencilLine,
  Pin,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { MediaFile, Note, NoteKind } from '../../shared/types'
import { api } from '../lib/api'
import { qk, useNote } from '../lib/hooks'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { formatFullDate, formatRelative, pluralRu } from '../lib/date'
import { NOTE_KIND_META } from '../lib/meta'
import { useToast } from '../context/ToastContext'
import { useConfirm } from '../context/ConfirmContext'
import { Markdown } from '../components/Markdown'
import { MediaGallery } from '../components/MediaGallery'
import { EmptyState, SectionLabel, Skeleton } from '../components/ui'

interface NoteDraft {
  title: string
  body: string
  kind: NoteKind
  tags: string[]
  pinned: boolean
}

type SaveState = 'saved' | 'pending' | 'error'
type EditorPane = 'edit' | 'preview'

const KIND_OPTIONS: NoteKind[] = ['note', 'lesson', 'idea']
const MAX_TAGS = 8
const MAX_FILE_BYTES = 200 * 1024 * 1024

const TOOLBAR = [
  { icon: Bold, title: 'Жирный', before: '**', after: '**', placeholder: 'текст' },
  { icon: Italic, title: 'Курсив', before: '*', after: '*', placeholder: 'текст' },
  { icon: Heading2, title: 'Заголовок', before: '## ', after: '', placeholder: 'Заголовок' },
  { icon: List, title: 'Список', before: '- ', after: '', placeholder: 'пункт' },
  { icon: ListChecks, title: 'Чек-лист', before: '- [ ] ', after: '', placeholder: 'пункт' },
  { icon: Code2, title: 'Код', before: '`', after: '`', placeholder: 'код' },
  { icon: Link2, title: 'Ссылка', before: '[', after: '](https://)', placeholder: 'текст ссылки' },
]

export function NoteEditorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()

  const noteQuery = useNote(id)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [kind, setKind] = useState<NoteKind>('note')
  const [tags, setTags] = useState<string[]>([])
  const [pinned, setPinned] = useState(false)
  const [tagInput, setTagInput] = useState('')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [pane, setPane] = useState<EditorPane>('edit')
  const [uploadDragging, setUploadDragging] = useState(false)

  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const initializedFor = useRef<string | null>(null)
  const savedKey = useRef<string | null>(null)
  const failedKey = useRef<string | null>(null)

  useDocumentTitle(title.trim() || 'Заметка')

  const draft = useMemo<NoteDraft>(
    () => ({ title, body, kind, tags, pinned }),
    [title, body, kind, tags, pinned],
  )
  const draftKey = useMemo(() => JSON.stringify(draft), [draft])
  const dirty = savedKey.current !== null && savedKey.current !== draftKey

  useEffect(() => {
    const note = noteQuery.data
    if (!note || note.id !== id || initializedFor.current === note.id) return
    initializedFor.current = note.id
    setTitle(note.title)
    setBody(note.body)
    setKind(note.kind)
    setTags(note.tags)
    setPinned(note.pinned)
    savedKey.current = JSON.stringify({
      title: note.title,
      body: note.body,
      kind: note.kind,
      tags: note.tags,
      pinned: note.pinned,
    })
    setSaveState('saved')
  }, [noteQuery.data, id])

  const saveMutation = useMutation({
    mutationFn: (payload: NoteDraft) => api.notes.update(id!, payload),
    onSuccess: (note, payload) => {
      savedKey.current = JSON.stringify(payload)
      failedKey.current = null
      queryClient.setQueryData(qk.note(id!), note)
      void queryClient.invalidateQueries({ queryKey: ['notes', 'list'] })
      setSaveState('saved')
    },
    onError: (error, payload) => {
      failedKey.current = JSON.stringify(payload)
      setSaveState('error')
      showToast(error instanceof Error ? error.message : 'Не удалось сохранить заметку.', 'error')
    },
  })

  useEffect(() => {
    if (!id || !noteQuery.data || !dirty) return
    if (saveMutation.isPending) return
    if (saveState === 'error' && failedKey.current === draftKey) return
    setSaveState('pending')
    const timer = window.setTimeout(() => {
      saveMutation.mutate(draft)
    }, 900)
    return () => window.clearTimeout(timer)
  }, [
    id,
    noteQuery.data,
    dirty,
    draftKey,
    draft,
    saveState,
    saveMutation.isPending,
    saveMutation.mutate,
  ])

  const saveNow = useCallback(() => {
    if (!id || !noteQuery.data || saveMutation.isPending) return
    if (!dirty) {
      showToast('Всё уже сохранено.', 'info')
      return
    }
    failedKey.current = null
    setSaveState('pending')
    saveMutation.mutate(draft)
  }, [id, noteQuery.data, saveMutation, dirty, draft, showToast])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        saveNow()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [saveNow])

  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  const uploadMutation = useMutation({
    mutationFn: (files: File[]) => api.notes.upload(id!, files),
    onSuccess: (note) => {
      queryClient.setQueryData(qk.note(id!), note)
      void queryClient.invalidateQueries({ queryKey: ['notes', 'list'] })
      showToast('Вложения добавлены.', 'success')
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : 'Не удалось загрузить файлы.', 'error')
    },
  })

  const removeFileMutation = useMutation({
    mutationFn: (fileId: string) => api.notes.removeFile(id!, fileId),
    onSuccess: (note) => {
      queryClient.setQueryData(qk.note(id!), note)
      void queryClient.invalidateQueries({ queryKey: ['notes', 'list'] })
      showToast('Файл убран из заметки.', 'success')
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : 'Не удалось убрать файл.', 'error')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.notes.remove(id!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.notes })
      navigate('/notes', { replace: true })
      showToast('Заметка удалена.', 'success')
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : 'Не удалось удалить заметку.', 'error')
    },
  })

  const addFiles = (incoming: File[]) => {
    if (!incoming.length) return
    const oversized = incoming.filter((file) => file.size > MAX_FILE_BYTES)
    const accepted = incoming.filter((file) => file.size <= MAX_FILE_BYTES).slice(0, 10)
    if (oversized.length) {
      showToast('Файл больше 200 МБ прикрепить нельзя.', 'error')
    }
    if (accepted.length) uploadMutation.mutate(accepted)
  }

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files || [])
    event.target.value = ''
    addFiles(chosen)
  }

  const onUploadDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setUploadDragging(false)
    addFiles(Array.from(event.dataTransfer.files || []))
  }

  const insertMarkdown = (before: string, after: string, placeholder: string) => {
    const el = bodyRef.current
    if (!el) return
    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = body.slice(start, end) || placeholder
    const next = body.slice(0, start) + before + selected + after + body.slice(end)
    setBody(next)
    setPane('edit')
    window.requestAnimationFrame(() => {
      el.focus()
      const selectionStart = start + before.length
      el.setSelectionRange(selectionStart, selectionStart + selected.length)
    })
  }

  const addTag = () => {
    const value = tagInput.trim().replace(/^#/, '').slice(0, 40)
    if (!value) return
    if (tags.includes(value)) {
      setTagInput('')
      return
    }
    if (tags.length >= MAX_TAGS) {
      showToast(`Можно добавить не больше ${MAX_TAGS} тегов.`, 'info')
      return
    }
    setTags((current) => [...current, value])
    setTagInput('')
  }

  const onTagKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault()
      addTag()
      return
    }
    if (event.key === 'Backspace' && !tagInput && tags.length) {
      setTags((current) => current.slice(0, -1))
    }
  }

  const goBack = () => {
    if (dirty && !saveMutation.isPending) saveMutation.mutate(draft)
    navigate('/notes')
  }

  const handleRemoveFile = async (file: MediaFile) => {
    const confirmed = await confirm({
      title: 'Убрать файл?',
      description: `«${file.name}» больше не будет прикреплён к заметке.`,
      confirmLabel: 'Убрать',
      danger: true,
    })
    if (confirmed) removeFileMutation.mutate(file.id)
  }

  const handleDelete = async () => {
    const confirmed = await confirm({
      title: 'Удалить заметку?',
      description: 'Текст и вложения будут удалены без возможности восстановления.',
      confirmLabel: 'Удалить заметку',
      danger: true,
    })
    if (confirmed) deleteMutation.mutate()
  }

  const words = useMemo(() => {
    const trimmed = body.trim()
    if (!trimmed) return 0
    return trimmed.split(/\s+/).length
  }, [body])

  if (noteQuery.isPending) {
    return (
      <div className="editor-page">
        <div className="editor-loading">
          <Skeleton className="editor-skeleton-top" />
          <Skeleton className="editor-skeleton-title" />
          <Skeleton className="editor-skeleton-body" />
        </div>
      </div>
    )
  }

  if (noteQuery.isError || !noteQuery.data) {
    return (
      <div className="editor-page editor-page-message">
        <EmptyState
          icon={FileQuestion}
          title="Заметка не найдена"
          description={
            noteQuery.error instanceof Error
              ? noteQuery.error.message
              : 'Возможно, она была удалена на другом устройстве.'
          }
          action={
            <button className="btn btn-primary" onClick={() => navigate('/notes')}>
              <ArrowLeft size={16} /> К заметкам
            </button>
          }
        />
      </div>
    )
  }

  const note = noteQuery.data
  const attachments = note.attachments
  const saveLabel = saveMutation.isPending
    ? 'Сохраняю…'
    : saveState === 'error'
      ? 'Не сохранилось'
      : dirty
        ? 'Есть изменения'
        : 'Сохранено'

  return (
    <div className="editor-page">
      <div className="editor-topbar">
        <button className="editor-back" onClick={goBack}>
          <ArrowLeft size={17} />
          <span>Заметки</span>
        </button>
        <div className="editor-top-actions">
          <span
            className={`save-indicator is-${saveState} ${dirty ? 'is-dirty' : ''}`}
            title={saveState === 'error' ? 'Попробуй сохранить ещё раз' : undefined}
          >
            {saveMutation.isPending ? (
              <Loader2 size={13} className="spin" />
            ) : saveState === 'error' ? (
              <AlertCircle size={13} />
            ) : dirty ? (
              <PencilLine size={13} />
            ) : (
              <Check size={13} />
            )}
            {saveLabel}
          </span>
          <button
            className={`icon-btn editor-pin ${pinned ? 'is-active' : ''}`}
            onClick={() => setPinned((current) => !current)}
            title={pinned ? 'Открепить' : 'Закрепить'}
            aria-label={pinned ? 'Открепить заметку' : 'Закрепить заметку'}
          >
            <Pin size={17} />
          </button>
          <button className="btn btn-ghost btn-small editor-done" onClick={goBack}>
            Готово
          </button>
        </div>
      </div>

      <div className="editor-layout">
        <div className="editor-main">
          <input
            className="editor-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Заголовок заметки"
            aria-label="Заголовок заметки"
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                bodyRef.current?.focus()
              }
            }}
          />

          <div className="editor-toolbar">
            <div className="editor-pane-switch">
              <button
                type="button"
                className={pane === 'edit' ? 'is-active' : ''}
                onClick={() => setPane('edit')}
              >
                <PencilLine size={14} /> Текст
              </button>
              <button
                type="button"
                className={pane === 'preview' ? 'is-active' : ''}
                onClick={() => setPane('preview')}
              >
                <Eye size={14} /> Превью
              </button>
            </div>
            <div className="md-toolbar" role="toolbar" aria-label="Форматирование">
              {TOOLBAR.map((item) => {
                const Icon = item.icon
                return (
                  <button
                    key={item.title}
                    type="button"
                    className="md-tool"
                    title={item.title}
                    aria-label={item.title}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => insertMarkdown(item.before, item.after, item.placeholder)}
                  >
                    <Icon size={15} />
                  </button>
                )
              })}
            </div>
          </div>

          <div className={`editor-split is-${pane}`}>
            <textarea
              ref={bodyRef}
              className="editor-textarea"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={'Пиши свободно. Поддерживается Markdown:\n\n## Заголовок\n- список\n- [ ] чек-лист\n**жирный** и `код`'}
              aria-label="Текст заметки"
              spellCheck
            />
            <div className="editor-preview markdown" aria-label="Предпросмотр заметки">
              {body.trim() ? (
                <Markdown>{body}</Markdown>
              ) : (
                <div className="editor-preview-empty">
                  <Eye size={20} />
                  <span>Превью появится, когда начнёшь писать.</span>
                </div>
              )}
            </div>
          </div>

          <div className="editor-footer">
            <span>
              {words} {pluralRu(words, 'слово', 'слова', 'слов')} ·{' '}
              {Math.max(1, Math.ceil(words / 180))} мин чтения
            </span>
            <span>Обновлено {formatRelative(note.updated_at)}</span>
          </div>
        </div>

        <aside className="editor-aside">
          <section className="editor-panel">
            <SectionLabel>Тип заметки</SectionLabel>
            <div className="kind-choices">
              {KIND_OPTIONS.map((option) => {
                const meta = NOTE_KIND_META[option]
                const Icon = meta.icon
                return (
                  <button
                    key={option}
                    type="button"
                    className={`kind-choice tone-${meta.tone} ${kind === option ? 'is-active' : ''}`}
                    onClick={() => setKind(option)}
                  >
                    <span className="kind-choice-icon">
                      <Icon size={15} />
                    </span>
                    <span>{meta.label}</span>
                    {kind === option && <Check size={14} className="kind-choice-check" />}
                  </button>
                )
              })}
            </div>
          </section>

          <section className="editor-panel">
            <SectionLabel>Теги</SectionLabel>
            <div className="tag-editor">
              {tags.map((tag) => (
                <span className="tag-pill" key={tag}>
                  #{tag}
                  <button
                    type="button"
                    onClick={() => setTags((current) => current.filter((item) => item !== tag))}
                    aria-label={`Убрать тег ${tag}`}
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              <input
                className="tag-input"
                value={tagInput}
                onChange={(event) => setTagInput(event.target.value)}
                onKeyDown={onTagKeyDown}
                onBlur={addTag}
                placeholder={tags.length ? 'Ещё тег…' : 'Добавь тег'}
                aria-label="Добавить тег"
              />
            </div>
            <p className="editor-panel-hint">Enter или запятая — добавить. До {MAX_TAGS} тегов.</p>
          </section>

          <section className="editor-panel">
            <SectionLabel
              action={
                attachments.length > 0 ? (
                  <button
                    type="button"
                    className="tiny-link"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadMutation.isPending}
                  >
                    <Paperclip size={12} /> Добавить
                  </button>
                ) : undefined
              }
            >
              Вложения
            </SectionLabel>

            {attachments.length > 0 ? (
              <>
                <MediaGallery files={attachments} limit={4} onRemove={handleRemoveFile} />
                {uploadMutation.isPending && (
                  <span className="editor-uploading">
                    <Loader2 size={14} className="spin" /> Загружаю…
                  </span>
                )}
              </>
            ) : (
              <div
                className={`editor-attach-drop ${uploadDragging ? 'is-dragging' : ''}`}
                onDragOver={(event) => {
                  event.preventDefault()
                  setUploadDragging(true)
                }}
                onDragLeave={() => setUploadDragging(false)}
                onDrop={onUploadDrop}
              >
                <button
                  type="button"
                  className="editor-attach-button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadMutation.isPending}
                >
                  {uploadMutation.isPending ? (
                    <Loader2 size={20} className="spin" />
                  ) : (
                    <Upload size={20} />
                  )}
                  <span>{uploadMutation.isPending ? 'Загружаю…' : 'Прикрепить файлы'}</span>
                  <small>Фото, видео, документы · до 200 МБ</small>
                </button>
              </div>
            )}

            <input ref={fileInputRef} type="file" multiple hidden onChange={onPickFiles} />
          </section>

          <section className="editor-panel editor-meta">
            <div className="editor-meta-row">
              <span>Создана</span>
              <strong>{formatFullDate(note.created_at)}</strong>
            </div>
            <div className="editor-meta-row">
              <span>Изменена</span>
              <strong>{formatFullDate(note.updated_at)}</strong>
            </div>
            <button
              className="editor-delete"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Trash2 size={15} />
              )}
              Удалить заметку
            </button>
          </section>
        </aside>
      </div>
    </div>
  )
}
