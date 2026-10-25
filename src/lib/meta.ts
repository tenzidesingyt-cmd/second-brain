import {
  CalendarDays,
  CheckSquare,
  CircleDashed,
  Layers,
  Lightbulb,
  NotebookText,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { AIResult, NoteKind, TaskPriority } from '../../shared/types'

export type Tone = 'accent' | 'green' | 'amber' | 'coral' | 'blue' | 'neutral'

export interface CategoryMeta {
  label: string
  icon: LucideIcon
  tone: Tone
}

export const CATEGORY_META: Record<NonNullable<AIResult['category']>, CategoryMeta> = {
  task: { label: 'Задача', icon: CheckSquare, tone: 'green' },
  note: { label: 'Заметка', icon: NotebookText, tone: 'blue' },
  idea: { label: 'Идея', icon: Lightbulb, tone: 'amber' },
  event: { label: 'Событие', icon: CalendarDays, tone: 'accent' },
  mixed: { label: 'Разобрано', icon: Layers, tone: 'accent' },
  none: { label: 'Запись', icon: CircleDashed, tone: 'neutral' },
}

export const NOTE_KIND_META: Record<NoteKind, CategoryMeta> = {
  note: { label: 'Заметка', icon: NotebookText, tone: 'blue' },
  lesson: { label: 'Урок', icon: NotebookText, tone: 'green' },
  idea: { label: 'Идея', icon: Lightbulb, tone: 'amber' },
}

export const PRIORITY_META: Record<TaskPriority, { label: string; tone: Tone }> = {
  low: { label: 'Низкий', tone: 'neutral' },
  normal: { label: 'Обычный', tone: 'blue' },
  high: { label: 'Высокий', tone: 'coral' },
}
