import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle, ArrowUp, Loader2, Sparkles, X } from 'lucide-react'
import { AI_EDIT_MAX_INSTRUCTION } from '../../shared/types'

export interface AiEditContext {
  id: string
  title: string
}

interface AiEditComposerProps {
  contexts: AiEditContext[]
  onSubmit: (instruction: string) => Promise<boolean>
  pending: boolean
  aiReady: boolean
  onRemove?: (id: string) => void
  placeholder?: string
  hint?: string
  error?: string | null
  className?: string
  children?: ReactNode
}

export function AiEditComposer({
  contexts,
  onSubmit,
  pending,
  aiReady,
  onRemove,
  placeholder = 'Что изменить?',
  hint,
  error,
  className = '',
  children,
}: AiEditComposerProps) {
  const [instruction, setInstruction] = useState('')
  const canSubmit = aiReady && !pending && contexts.length > 0 && Boolean(instruction.trim())

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSubmit) return
    const applied = await onSubmit(instruction.trim())
    if (applied) setInstruction('')
  }

  return (
    <section className={`ai-edit-card ${className}`.trim()}>
      <div className="ai-edit-head">
        <span className="ai-edit-orb">
          <Sparkles size={15} />
        </span>
        <span className="ai-edit-head-copy">
          <strong>ИИ-редактор</strong>
          <span>
            {contexts.length === 1
              ? 'Работает только с этой заметкой'
              : `Работает только с выбранными заметками: ${contexts.length}`}
          </span>
        </span>
      </div>

      <div className="ai-edit-contexts">
        {contexts.length ? (
          contexts.map((context) => (
            <span className="ai-context-chip" key={context.id}>
              <span className="ai-context-hash">#</span>
              <span className="ai-context-title">{context.title || 'Без названия'}</span>
              {onRemove && (
                <button
                  type="button"
                  className="ai-context-remove"
                  onClick={() => onRemove(context.id)}
                  aria-label={`Убрать заметку «${context.title || 'Без названия'}» из выбора`}
                  title="Убрать из выбора"
                >
                  <X size={11} />
                </button>
              )}
            </span>
          ))
        ) : (
          <span className="ai-edit-empty">Сначала выбери заметки в списке.</span>
        )}
      </div>

      <form className="ai-edit-form" onSubmit={handleSubmit}>
        <Sparkles size={15} className="ai-edit-form-icon" />
        <input
          className="ai-edit-input"
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          placeholder={placeholder}
          maxLength={AI_EDIT_MAX_INSTRUCTION}
          aria-label="Что изменить в заметках"
          disabled={!aiReady || pending || !contexts.length}
        />
        <button
          type="submit"
          className="ai-edit-submit"
          disabled={!canSubmit}
          aria-label="Применить изменения"
          title="Применить изменения"
        >
          {pending ? <Loader2 size={16} className="spin" /> : <ArrowUp size={16} />}
        </button>
      </form>

      <div className="ai-edit-foot">
        {aiReady ? (
          <span className={pending ? 'is-pending' : ''}>
            {pending
              ? 'ИИ редактирует заметки…'
              : hint || 'ИИ видит только выбранные заметки и не трогает остальные.'}
          </span>
        ) : (
          <span className="ai-edit-off">
            ИИ не подключён.{' '}
            <Link to="/settings">Подключить в настройках</Link>
          </span>
        )}
      </div>

      {error && (
        <div className="ai-edit-error">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}

      {children}
    </section>
  )
}
