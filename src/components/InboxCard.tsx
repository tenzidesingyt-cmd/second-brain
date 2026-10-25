import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlignLeft,
  ArrowUpRight,
  CalendarDays,
  Camera,
  CheckSquare,
  CircleAlert,
  FileText,
  ListPlus,
  Loader2,
  Mic,
  NotebookPen,
  RefreshCw,
  Sparkles,
  Trash2,
  Video,
} from 'lucide-react'
import type { InboxItem, InboxStatus, InboxType } from '../../shared/types'
import { formatRelative } from '../lib/date'
import { CATEGORY_META } from '../lib/meta'
import { Badge } from './ui'
import { MediaGallery } from './MediaGallery'

const STATUS_META: Record<InboxStatus, { label: string; tone: string; dot: boolean }> = {
  new: { label: 'В инбоксе', tone: 'amber', dot: true },
  processing: { label: 'ИИ разбирает', tone: 'accent', dot: true },
  done: { label: 'Разобрано', tone: 'green', dot: false },
  failed: { label: 'Ошибка', tone: 'coral', dot: true },
}

const TYPE_META: Record<InboxType, { label: string; icon: typeof AlignLeft; tone: string }> = {
  text: { label: 'Текст', icon: AlignLeft, tone: 'blue' },
  photo: { label: 'Фото', icon: Camera, tone: 'coral' },
  audio: { label: 'Голос', icon: Mic, tone: 'amber' },
  video: { label: 'Видео', icon: Video, tone: 'accent' },
  file: { label: 'Файл', icon: FileText, tone: 'green' },
}

interface InboxCardProps {
  item: InboxItem
  aiReady: boolean
  busy: boolean
  onProcess: (item: InboxItem) => void
  onConvert: (item: InboxItem, target: 'note' | 'task') => void
  onDelete: (item: InboxItem) => void
}

export function InboxCard({
  item,
  aiReady,
  busy,
  onProcess,
  onConvert,
  onDelete,
}: InboxCardProps) {
  const typeMeta = TYPE_META[item.type]
  const TypeIcon = typeMeta.icon
  const statusMeta = STATUS_META[item.status]
  const result = item.ai_result
  const categoryMeta = result ? CATEGORY_META[result.category] : null
  const CategoryIcon = categoryMeta?.icon
  const createdLinks: ReactNode[] = []

  if (result?.created_note_id) {
    createdLinks.push(
      <Link className="inbox-link" to={`/notes/${result.created_note_id}`} key="note">
        <NotebookPen size={14} />
        <span>{result.note?.title || 'Открыть заметку'}</span>
        <ArrowUpRight size={13} />
      </Link>,
    )
  }

  result?.created_task_ids?.forEach((taskId, index) => {
    createdLinks.push(
      <Link className="inbox-link" to={`/tasks?task=${taskId}`} key={`task-${taskId}`}>
        <CheckSquare size={14} />
        <span>{result.tasks?.[index]?.title || 'Открыть задачу'}</span>
        <ArrowUpRight size={13} />
      </Link>,
    )
  })

  if (result?.created_event_id) {
    const date = result.event?.starts_at?.slice(0, 10)
    createdLinks.push(
      <Link
        className="inbox-link"
        to={date ? `/calendar?date=${date}` : '/calendar'}
        key="event"
      >
        <CalendarDays size={14} />
        <span>{result.event?.title || 'Открыть событие'}</span>
        <ArrowUpRight size={13} />
      </Link>,
    )
  }

  return (
    <article className={`inbox-card is-${item.status}`}>
      <header className="inbox-card-head">
        <span className={`inbox-type-icon tone-${typeMeta.tone}`}>
          <TypeIcon size={17} strokeWidth={1.9} />
        </span>
        <div className="inbox-card-meta">
          <span className="inbox-card-kind">
            {typeMeta.label}
            <span className="inbox-card-sep" />
            {formatRelative(item.created_at)}
          </span>
          <Badge tone={statusMeta.tone} dot={statusMeta.dot}>
            {statusMeta.label}
          </Badge>
        </div>
        <div className="inbox-card-actions">
          {item.status === 'new' && aiReady && (
            <button
              className="icon-btn"
              onClick={() => onProcess(item)}
              disabled={busy}
              title="Разобрать с ИИ"
              aria-label="Разобрать с ИИ"
            >
              {busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />}
            </button>
          )}
          {item.status === 'failed' && aiReady && (
            <button
              className="icon-btn"
              onClick={() => onProcess(item)}
              disabled={busy}
              title="Попробовать снова"
              aria-label="Попробовать снова"
            >
              {busy ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
            </button>
          )}
          <button
            className="icon-btn inbox-delete"
            onClick={() => onDelete(item)}
            disabled={busy}
            title="Удалить запись"
            aria-label="Удалить запись"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </header>

      {item.text && <p className="inbox-text">{item.text}</p>}

      {item.files.length > 0 && <MediaGallery files={item.files} limit={4} />}

      {item.status === 'processing' && (
        <div className="inbox-processing">
          <span className="inbox-processing-orb">
            <Sparkles size={16} />
          </span>
          <div className="inbox-processing-copy">
            <strong>ИИ читает и раскладывает</strong>
            <span>Распознаю текст, задачи и даты — обычно это несколько секунд.</span>
            <span className="inbox-processing-bar">
              <span />
            </span>
          </div>
        </div>
      )}

      {item.status === 'failed' && (
        <div className="inbox-error">
          <div className="inbox-error-head">
            <CircleAlert size={15} />
            <strong>Не получилось разобрать</strong>
          </div>
          {item.ai_error && <p>{item.ai_error}</p>}
          <div className="inbox-error-actions">
            {aiReady && (
              <button className="btn btn-soft btn-small" onClick={() => onProcess(item)} disabled={busy}>
                {busy ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                Повторить
              </button>
            )}
            <button
              className="btn btn-ghost btn-small"
              onClick={() => onConvert(item, 'note')}
              disabled={busy}
            >
              <NotebookPen size={14} /> В заметку
            </button>
          </div>
        </div>
      )}

      {item.status === 'new' && (
        <div className="inbox-manual">
          <span className="inbox-manual-hint">
            {aiReady
              ? 'Можно разложить вручную, если не хочешь ждать ИИ.'
              : 'ИИ не подключён — сохрани как заметку или задачу.'}
          </span>
          <div className="inbox-manual-actions">
            <button
              className="btn btn-ghost btn-small"
              onClick={() => onConvert(item, 'note')}
              disabled={busy}
            >
              {busy ? <Loader2 size={14} className="spin" /> : <NotebookPen size={14} />}
              В заметку
            </button>
            <button
              className="btn btn-ghost btn-small"
              onClick={() => onConvert(item, 'task')}
              disabled={busy}
            >
              <ListPlus size={14} /> В задачу
            </button>
          </div>
        </div>
      )}

      {item.status === 'done' && result && (
        <div className="inbox-result">
          <div className="inbox-result-head">
            <div className="inbox-result-badges">
              {categoryMeta && CategoryIcon && (
                <Badge tone={categoryMeta.tone}>
                  <CategoryIcon size={12} />
                  {categoryMeta.label}
                </Badge>
              )}
              {typeof result.transcript === 'string' && result.transcript && (
                <span className="inbox-transcript-badge">
                  <Mic size={11} /> Расшифровка
                </span>
              )}
            </div>
            {item.processed_at && (
              <span className="inbox-result-time">{formatRelative(item.processed_at)}</span>
            )}
          </div>

          {result.title && <h3 className="inbox-result-title">{result.title}</h3>}
          {result.summary && <p className="inbox-result-summary">{result.summary}</p>}

          {result.transcript && (
            <blockquote className="inbox-transcript">«{result.transcript}»</blockquote>
          )}

          {createdLinks.length > 0 && <div className="inbox-links">{createdLinks}</div>}
        </div>
      )}
    </article>
  )
}
