import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Camera,
  CornerDownLeft,
  FileText,
  Inbox,
  Loader2,
  Mic,
  Paperclip,
  Settings2,
  Sparkles,
  Square,
  Video,
  X,
} from 'lucide-react'
import type { InboxItem, InboxStatus } from '../../shared/types'
import { api } from '../lib/api'
import { useAiSettings, useInbox, qk } from '../lib/hooks'
import { currentTimezone, formatDateLabel, humanFileSize } from '../lib/date'
import { useToast } from '../context/ToastContext'
import { useConfirm } from '../context/ConfirmContext'
import { InboxCard } from '../components/InboxCard'
import { EmptyState, PageHeader, Toggle } from '../components/ui'

const MAX_FILES = 10
const MAX_FILE_BYTES = 200 * 1024 * 1024

type InboxFilter = 'all' | InboxStatus

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'new', label: 'Новые' },
  { value: 'processing', label: 'В работе' },
  { value: 'done', label: 'Разобрано' },
  { value: 'failed', label: 'Ошибки' },
]

const EXAMPLES = [
  'Сдать проект по кодингу до пятницы',
  'Фото домашнего задания по физике',
  'Идея: приложение для учёта привычек',
]

function AttachmentTile({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [preview, setPreview] = useState<string | null>(null)
  const isImage = file.type.startsWith('image/')
  const isVideo = file.type.startsWith('video/')
  const isAudio = file.type.startsWith('audio/')
  const Icon = isVideo ? Video : isAudio ? Mic : FileText

  useEffect(() => {
    if (!isImage) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file, isImage])

  return (
    <div className="attachment-tile" title={`${file.name} · ${humanFileSize(file.size)}`}>
      <div className="attachment-preview">
        {preview ? <img src={preview} alt={file.name} /> : <Icon size={18} />}
      </div>
      <span className="attachment-name">{file.name}</span>
      <button
        type="button"
        className="attachment-remove"
        onClick={onRemove}
        aria-label={`Убрать ${file.name}`}
      >
        <X size={12} />
      </button>
    </div>
  )
}

function formatRecordTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function InboxPage() {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [aiOn, setAiOn] = useState(true)
  const [filter, setFilter] = useState<InboxFilter>('all')
  const [dragging, setDragging] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordSeconds, setRecordSeconds] = useState(0)
  const [actingId, setActingId] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordChunks = useRef<Blob[]>([])
  const recordTimer = useRef<number | null>(null)

  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const inbox = useInbox()
  const aiSettings = useAiSettings()
  const aiReady = Boolean(aiSettings.data?.configured)
  const items = inbox.data || []

  useEffect(() => {
    if (!aiSettings.data) return
    setAiOn(Boolean(aiSettings.data.configured))
  }, [aiSettings.data])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 300)}px`
  }, [text])

  useEffect(() => {
    if (params.get('new') !== '1') return
    const timer = window.setTimeout(() => {
      textareaRef.current?.focus()
      setParams(
        (current) => {
          const next = new URLSearchParams(current)
          next.delete('new')
          return next
        },
        { replace: true },
      )
    }, 120)
    return () => window.clearTimeout(timer)
  }, [params, setParams])

  const waiting = items.some((item) => item.status === 'processing')
  useEffect(() => {
    if (!waiting) return
    const timer = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: qk.inbox })
    }, 4000)
    return () => window.clearInterval(timer)
  }, [waiting, queryClient])

  useEffect(() => {
    return () => {
      if (recordTimer.current) window.clearInterval(recordTimer.current)
      const recorder = recorderRef.current
      if (recorder && recorder.state !== 'inactive') recorder.stop()
      recorder?.stream.getTracks().forEach((track) => track.stop())
    }
  }, [])

  const addFiles = (incoming: File[]) => {
    if (!incoming.length) return
    const accepted = incoming.filter((file) => {
      if (file.size > MAX_FILE_BYTES) {
        showToast(`«${file.name}» больше 200 МБ.`, 'error')
        return false
      }
      return true
    })
    const room = MAX_FILES - files.length
    if (room <= 0) {
      showToast('К одной записи можно прикрепить до 10 файлов.', 'info')
      return
    }
    if (accepted.length > room) {
      showToast(`Можно добавить ещё ${room} — лимит 10 файлов на запись.`, 'info')
    }
    const next = accepted.slice(0, room)
    if (next.length) setFiles((current) => [...current, ...next])
  }

  const pickFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = Array.from(event.target.files || [])
    event.target.value = ''
    addFiles(chosen)
  }

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    addFiles(Array.from(event.dataTransfer.files || []))
  }

  const onDragEnter = (event: DragEvent<HTMLElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return
    event.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  const onDragLeave = (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const startRecording = async () => {
    if (recording) return
    if (files.length >= MAX_FILES) {
      showToast('Достигнут лимит файлов для одной записи.', 'info')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      showToast(
        'Браузер не поддерживает запись. Запиши голос в диктофоне и прикрепи файл.',
        'error',
      )
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find(
        (type) => MediaRecorder.isTypeSupported(type),
      )
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)
      recorderRef.current = recorder
      recordChunks.current = []
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recordChunks.current.push(event.data)
      }
      recorder.onstop = () => {
        const type = recorder.mimeType || 'audio/webm'
        const extension = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm'
        const blob = new Blob(recordChunks.current, { type })
        if (blob.size > 0) {
          addFiles([new File([blob], `Голосовая заметка.${extension}`, { type })])
        }
        stream.getTracks().forEach((track) => track.stop())
        recorderRef.current = null
        setRecording(false)
        setRecordSeconds(0)
        if (recordTimer.current) {
          window.clearInterval(recordTimer.current)
          recordTimer.current = null
        }
      }
      recorder.start(500)
      setRecording(true)
      setRecordSeconds(0)
      recordTimer.current = window.setInterval(() => {
        setRecordSeconds((current) => current + 1)
      }, 1000)
    } catch {
      showToast('Не удалось получить доступ к микрофону.', 'error')
    }
  }

  const stopRecording = () => {
    const recorder = recorderRef.current
    if (recorder && recorder.state !== 'inactive') recorder.stop()
    if (recordTimer.current) {
      window.clearInterval(recordTimer.current)
      recordTimer.current = null
    }
  }

  const createMutation = useMutation({
    mutationFn: api.inbox.create,
    onSuccess: (item, variables) => {
      queryClient.setQueryData<InboxItem[]>(qk.inbox, (current = []) => [
        item,
        ...current.filter((entry) => entry.id !== item.id),
      ])
      void queryClient.invalidateQueries({ queryKey: qk.analytics })
      setText('')
      setFiles([])
      setFilter('all')
      showToast(
        variables.autoProcess
          ? 'Записал. ИИ уже читает и раскладывает.'
          : 'Запись сохранена в инбокс.',
        'success',
      )
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : 'Не удалось сохранить запись.', 'error')
    },
  })

  const processMutation = useMutation({
    mutationFn: (id: string) => api.inbox.process(id),
    onMutate: (id) => {
      setActingId(id)
      void queryClient.cancelQueries({ queryKey: qk.inbox })
      const previous = queryClient.getQueryData<InboxItem[]>(qk.inbox)
      queryClient.setQueryData<InboxItem[]>(qk.inbox, (current = []) =>
        current.map((item) =>
          item.id === id ? { ...item, status: 'processing' as InboxStatus, ai_error: null } : item,
        ),
      )
      return { previous }
    },
    onError: (error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(qk.inbox, context.previous)
      showToast(error instanceof Error ? error.message : 'ИИ не смог разобрать запись.', 'error')
    },
    onSettled: () => {
      setActingId(null)
      void queryClient.invalidateQueries({ queryKey: qk.inbox })
    },
  })

  const convertMutation = useMutation({
    mutationFn: ({ item, target }: { item: InboxItem; target: 'note' | 'task' }) =>
      api.inbox.convert(item.id, target),
    onMutate: ({ item }) => setActingId(item.id),
    onSuccess: (data) => {
      queryClient.setQueryData<InboxItem[]>(qk.inbox, (current = []) =>
        current.map((item) => (item.id === data.inbox.id ? data.inbox : item)),
      )
      void queryClient.invalidateQueries({ queryKey: qk.notes })
      void queryClient.invalidateQueries({ queryKey: qk.tasks })
      void queryClient.invalidateQueries({ queryKey: qk.analytics })
      showToast(data.note_id ? 'Заметка создана и ждёт в «Заметках».' : 'Задача создана.', 'success')
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : 'Не удалось создать запись.', 'error')
    },
    onSettled: () => setActingId(null),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.inbox.remove(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: qk.inbox })
      const previous = queryClient.getQueryData<InboxItem[]>(qk.inbox)
      queryClient.setQueryData<InboxItem[]>(qk.inbox, (current = []) =>
        current.filter((item) => item.id !== id),
      )
      return { previous }
    },
    onError: (error, _id, context) => {
      if (context?.previous) queryClient.setQueryData(qk.inbox, context.previous)
      showToast(error instanceof Error ? error.message : 'Не удалось удалить запись.', 'error')
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.analytics })
      showToast('Запись удалена.', 'success')
    },
  })

  const counts = useMemo(() => {
    const base: Record<InboxFilter, number> = {
      all: items.length,
      new: 0,
      processing: 0,
      done: 0,
      failed: 0,
    }
    for (const item of items) base[item.status] += 1
    return base
  }, [items])

  const filtered = useMemo(
    () => (filter === 'all' ? items : items.filter((item) => item.status === filter)),
    [items, filter],
  )

  const groups = useMemo(() => {
    const map = new Map<string, InboxItem[]>()
    for (const item of filtered) {
      const label = formatDateLabel(item.created_at) || 'Ранее'
      const bucket = map.get(label) || []
      bucket.push(item)
      map.set(label, bucket)
    }
    return Array.from(map.entries())
  }, [filtered])

  const submit = () => {
    if (createMutation.isPending) return
    const trimmed = text.trim()
    if (!trimmed && files.length === 0) {
      showToast('Напиши мысль или прикрепи файл.', 'error')
      textareaRef.current?.focus()
      return
    }
    if (recording) {
      showToast('Сначала останови запись голоса.', 'info')
      return
    }
    createMutation.mutate({
      text: trimmed,
      files,
      tz: currentTimezone(),
      autoProcess: aiOn && aiReady,
    })
  }

  const onComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  const handleDelete = async (item: InboxItem) => {
    const confirmed = await confirm({
      title: 'Удалить запись из инбокса?',
      description:
        'Исходная запись и её вложения исчезнут. Заметки и задачи, уже созданные из неё, останутся.',
      confirmLabel: 'Удалить',
      danger: true,
    })
    if (confirmed) deleteMutation.mutate(item.id)
  }

  const focusComposer = () => {
    textareaRef.current?.focus()
    textareaRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  return (
    <div className="inbox-page">
      <PageHeader
        eyebrow="Входящий поток"
        title="Инбокс"
        description="Сбрось сюда всё, что не хочется держать в голове. ИИ превратит записи в заметки, задачи и события."
        actions={
          <>
            <span className={`ai-status-pill ${aiReady ? 'is-ready' : ''}`}>
              <Sparkles size={14} />
              <span>{aiReady ? aiSettings.data?.text_model : 'ИИ не подключён'}</span>
            </span>
            <Link to="/settings" className="btn btn-ghost btn-small">
              <Settings2 size={15} />
              {aiReady ? 'Настроить' : 'Подключить'}
            </Link>
          </>
        }
      />

      <div className="inbox-layout">
        <div className="inbox-composer-col">
          <section
            className={`composer-card ${dragging ? 'is-dragging' : ''}`}
            onDragEnter={onDragEnter}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {dragging && (
              <div className="composer-drop">
                <Paperclip size={26} />
                <strong>Отпускай — прикреплю</strong>
                <span>Фото, видео, документы · до 200 МБ</span>
              </div>
            )}

            <div className="composer-top">
              <span className="composer-orb">
                <Sparkles size={18} />
              </span>
              <div>
                <h2>Что у тебя в голове?</h2>
                <p>Одна строка, фото доски или голосовая мысль — дальше разберётся ИИ.</p>
              </div>
            </div>

            <textarea
              ref={textareaRef}
              className="composer-textarea"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={onComposerKeyDown}
              onPaste={(event) => {
                const pasted = Array.from(event.clipboardData.files || [])
                if (pasted.length) {
                  event.preventDefault()
                  addFiles(pasted)
                }
              }}
              placeholder="Например: сдать проект по кодингу до пятницы, а завтра спросить у друга про код…"
              rows={3}
              aria-label="Новая запись"
            />

            {files.length > 0 && (
              <div className="composer-attachments">
                {files.map((file, index) => (
                  <AttachmentTile
                    key={`${file.name}-${file.lastModified}-${index}`}
                    file={file}
                    onRemove={() =>
                      setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index))
                    }
                  />
                ))}
                <span className="composer-attachment-count">
                  {files.length}/{MAX_FILES}
                </span>
              </div>
            )}

            {recording && (
              <div className="recording-bar">
                <span className="recording-dot" />
                <span className="recording-time">{formatRecordTime(recordSeconds)}</span>
                <span className="recording-wave" aria-hidden="true">
                  {Array.from({ length: 14 }).map((_, index) => (
                    <span key={index} style={{ animationDelay: `${index * 90}ms` }} />
                  ))}
                </span>
                <button type="button" className="btn btn-danger btn-small" onClick={stopRecording}>
                  <Square size={13} /> Остановить
                </button>
              </div>
            )}

            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={pickFiles}
            />
            <input
              ref={videoInputRef}
              type="file"
              accept="video/*"
              multiple
              hidden
              onChange={pickFiles}
            />
            <input ref={fileInputRef} type="file" multiple hidden onChange={pickFiles} />

            <div className="composer-toolbar">
              <div className="composer-tools">
                <button
                  type="button"
                  className="tool-btn"
                  onClick={() => photoInputRef.current?.click()}
                >
                  <Camera size={17} />
                  <span>Фото</span>
                </button>
                <button
                  type="button"
                  className="tool-btn"
                  onClick={() => videoInputRef.current?.click()}
                >
                  <Video size={17} />
                  <span>Видео</span>
                </button>
                <button
                  type="button"
                  className="tool-btn"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Paperclip size={17} />
                  <span>Файл</span>
                </button>
                <button
                  type="button"
                  className={`tool-btn ${recording ? 'is-recording' : ''}`}
                  onClick={recording ? stopRecording : startRecording}
                >
                  {recording ? <Square size={16} /> : <Mic size={17} />}
                  <span>{recording ? 'Стоп' : 'Голос'}</span>
                </button>
              </div>

              <div className="composer-actions">
                <Toggle
                  label="ИИ разберёт"
                  checked={aiOn && aiReady}
                  onChange={setAiOn}
                  disabled={!aiReady}
                />
                <button
                  type="button"
                  className="btn btn-primary composer-submit"
                  onClick={submit}
                  disabled={createMutation.isPending || recording}
                >
                  {createMutation.isPending ? (
                    <Loader2 size={17} className="spin" />
                  ) : aiOn && aiReady ? (
                    <Sparkles size={17} />
                  ) : (
                    <Inbox size={17} />
                  )}
                  {createMutation.isPending
                    ? 'Сохраняю…'
                    : aiOn && aiReady
                      ? 'Записать и разобрать'
                      : 'Сохранить'}
                </button>
              </div>
            </div>

            <div className="composer-hint">
              <span>
                <CornerDownLeft size={12} /> Enter — отправить · Shift + Enter — новая строка
              </span>
              <span className="composer-hint-ai">
                {aiOn && aiReady
                  ? 'ИИ создаст заметку, задачи и события — потом всё можно поправить.'
                  : 'Сейчас сохраню как есть. Подключи ИИ, чтобы разбирать автоматически.'}
              </span>
            </div>
          </section>

          {items.length === 0 && (
            <div className="composer-examples">
              <span className="composer-examples-label">Попробуй начать так</span>
              <div className="composer-example-chips">
                {EXAMPLES.map((example) => (
                  <button
                    key={example}
                    type="button"
                    className="suggestion-chip"
                    onClick={() => {
                      setText(example)
                      textareaRef.current?.focus()
                    }}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <section className="inbox-feed">
          <div className="inbox-feed-head">
            <div>
              <h2 className="inbox-feed-title">Лента</h2>
              <p className="inbox-feed-caption">
                {items.length
                  ? `${items.length} ${items.length === 1 ? 'запись' : items.length < 5 ? 'записи' : 'записей'} · синхронизируется между устройствами`
                  : 'Здесь появятся твои записи'}
              </p>
            </div>
            {counts.failed > 0 && (
              <button
                type="button"
                className="inbox-failed-chip"
                onClick={() => setFilter('failed')}
              >
                {counts.failed} с ошибкой
              </button>
            )}
          </div>

          {items.length > 0 && (
            <div className="inbox-filters" role="tablist" aria-label="Фильтр записей">
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
                  {counts[entry.value] > 0 && (
                    <span className="chip-count">{counts[entry.value]}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {inbox.isPending ? (
            <div className="inbox-feed-list">
              {[0, 1, 2].map((index) => (
                <div className="inbox-skeleton" key={index}>
                  <div className="inbox-skeleton-head">
                    <span className="skeleton inbox-skeleton-icon" />
                    <span className="skeleton inbox-skeleton-line short" />
                  </div>
                  <span className="skeleton inbox-skeleton-line" />
                  <span className="skeleton inbox-skeleton-line medium" />
                </div>
              ))}
            </div>
          ) : inbox.isError ? (
            <EmptyState
              icon={Inbox}
              title="Не удалось загрузить инбокс"
              description={inbox.error instanceof Error ? inbox.error.message : 'Проверь соединение с сервером.'}
              action={
                <button className="btn btn-ghost" onClick={() => void inbox.refetch()}>
                  Повторить
                </button>
              }
            />
          ) : items.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Голова свободна"
              description="Запиши первую мысль: задачу на неделю, идею, фото домашнего задания или голосовое. Всё останется здесь и появится на других устройствах."
              action={
                <button className="btn btn-soft" onClick={focusComposer}>
                  <Sparkles size={16} /> Записать мысль
                </button>
              }
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              compact
              icon={Sparkles}
              title="В этой категории пусто"
              description="Попробуй другой фильтр или добавь новую запись."
              action={
                <button className="btn btn-ghost btn-small" onClick={() => setFilter('all')}>
                  Показать все
                </button>
              }
            />
          ) : (
            <div className="inbox-groups">
              {groups.map(([label, groupItems]) => (
                <div className="inbox-group" key={label}>
                  <div className="inbox-group-label">{label}</div>
                  <div className="inbox-feed-list">
                    {groupItems.map((item) => (
                      <InboxCard
                        key={item.id}
                        item={item}
                        aiReady={aiReady}
                        busy={actingId === item.id}
                        onProcess={(entry) => processMutation.mutate(entry.id)}
                        onConvert={(entry, target) => convertMutation.mutate({ item: entry, target })}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
