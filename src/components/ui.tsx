import type { LucideIcon } from 'lucide-react'
import { Loader2 } from 'lucide-react'
import type { ReactNode } from 'react'

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode
  title: string
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="page-head">
      <div className="page-head-copy">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {actions && <div className="page-head-actions">{actions}</div>}
    </header>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = '',
  ariaLabel,
}: {
  value: T
  options: { value: T; label: string; icon?: LucideIcon }[]
  onChange: (value: T) => void
  className?: string
  ariaLabel?: string
}) {
  return (
    <div className={`segmented ${className}`} role="tablist" aria-label={ariaLabel}>
      {options.map((option) => {
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={value === option.value}
            className={`segmented-item ${value === option.value ? 'is-active' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {Icon && <Icon size={15} />}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div className={`empty-state ${compact ? 'empty-compact' : ''}`}>
      <div className="empty-icon">
        <Icon size={26} strokeWidth={1.7} />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <div className="empty-action">{action}</div>}
    </div>
  )
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <Loader2 size={size} className="spin" aria-label="Загрузка" />
}

export function Badge({
  children,
  tone = 'neutral',
  dot = false,
}: {
  children: ReactNode
  tone?: string
  dot?: boolean
}) {
  return (
    <span className={`badge tone-${tone}`}>
      {dot && <span className="badge-dot" />}
      {children}
    </span>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  disabled?: boolean
}) {
  return (
    <label className={`toggle-wrap ${disabled ? 'is-disabled' : ''}`}>
      {label && <span className="toggle-label">{label}</span>}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`toggle ${checked ? 'is-on' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
      >
        <span className="toggle-thumb" />
      </button>
    </label>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />
}

export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="section-label">
      <span>{children}</span>
      {action}
    </div>
  )
}
