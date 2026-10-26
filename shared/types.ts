export type InboxStatus = 'new' | 'processing' | 'done' | 'failed'
export type InboxType = 'text' | 'photo' | 'audio' | 'video' | 'file'
export type NoteKind = 'note' | 'lesson' | 'idea'
export type TaskPriority = 'low' | 'normal' | 'high'
export type EntityType = 'inbox' | 'note' | 'task' | 'event'

export interface MediaFile {
  id: string
  name: string
  mime: string
  size: number
  url: string
  created_at: string
}

export interface AITaskDraft {
  title: string
  due_date?: string | null
  due_time?: string | null
  priority?: TaskPriority
}

export interface AIEventDraft {
  title: string
  starts_at: string
  ends_at?: string | null
  location?: string | null
}

export interface AINoteDraft {
  title: string
  markdown: string
  kind: NoteKind
  tags: string[]
}

export interface AIResult {
  title: string
  summary: string
  category: 'task' | 'note' | 'idea' | 'event' | 'mixed' | 'none'
  transcript?: string | null
  note?: AINoteDraft | null
  tasks?: AITaskDraft[]
  event?: AIEventDraft | null
  created_note_id?: string | null
  created_task_ids?: string[]
  created_event_id?: string | null
}

export interface InboxItem {
  id: string
  text: string
  type: InboxType
  tz: string
  status: InboxStatus
  ai_result: AIResult | null
  ai_error: string | null
  files: MediaFile[]
  created_at: string
  processed_at: string | null
}

export interface Note {
  id: string
  title: string
  body: string
  kind: NoteKind
  tags: string[]
  pinned: boolean
  source_inbox_id: string | null
  attachments: MediaFile[]
  created_at: string
  updated_at: string
}

export interface NoteEditSnapshot {
  title: string
  body: string
  kind: NoteKind
  tags: string[]
  pinned: boolean
}

export interface NoteEditChange {
  id: string
  summary: string
  changed: boolean
  before: NoteEditSnapshot
}

export interface NoteEditError {
  id: string
  title: string
  error: string
}

export interface NotesAiEditResponse {
  notes: Note[]
  changes: NoteEditChange[]
  errors: NoteEditError[]
}

export interface Task {
  id: string
  title: string
  notes: string
  due_date: string | null
  due_time: string | null
  priority: TaskPriority
  completed: boolean
  completed_at: string | null
  source_inbox_id: string | null
  attachments: MediaFile[]
  created_at: string
  updated_at: string
}

export interface Habit {
  id: string
  title: string
  emoji: string
  logs: string[]
  created_at: string
}

export interface CalendarEvent {
  id: string
  title: string
  description: string
  starts_at: string
  ends_at: string | null
  all_day: boolean
  location: string | null
  source_inbox_id: string | null
  attachments: MediaFile[]
  created_at: string
  updated_at: string
}

export interface DayStat {
  date: string
  completed: number
  created: number
  due: number
}

export interface HabitStat {
  id: string
  title: string
  emoji: string
  logs: string[]
  streak: number
  week_done: number
  week_target: number
}

export interface WeekAnalytics {
  week_start: string
  week_end: string
  tasks_completed: number
  tasks_open: number
  tasks_overdue: number
  tasks_due_in_week: number
  notes_created: number
  inbox_captured: number
  inbox_processed: number
  daily: DayStat[]
  habits: HabitStat[]
  summary: { content: string; created_at: string } | null
}

export interface AISettingsInfo {
  configured: boolean
  source: 'env' | 'settings' | null
  key_hint: string | null
  text_model: string
  vision_model: string
  stt_model: string
}

export interface SearchResponse {
  notes: Note[]
  tasks: Task[]
  inbox: InboxItem[]
}

export interface AISearchResponse {
  answer: string
  notes: Note[]
}

export interface AnalyticsSummaryResponse {
  content: string
  created_at: string
}

export interface AuthUser {
  id: string
  login: string
  name: string
  role: 'owner' | 'user'
  telegram_id: string | null
  telegram_username: string | null
  created_at: string
}

export interface AuthState {
  auth_required: boolean
  authenticated: boolean
  google_enabled: boolean
  password_enabled: boolean
  telegram_enabled: boolean
  telegram_bot_username: string | null
  user: AuthUser | null
}

export interface AppSettings {
  theme: 'light' | 'dark' | 'system'
}

export interface NotificationSettingsInfo {
  timezone: string
  push_enabled: boolean
  telegram_enabled: boolean
  day_before: boolean
  at_time: boolean
  push_public_key: string | null
  push_subscriptions: number
  telegram_available: boolean
  telegram_linked: boolean
  telegram_username: string | null
  bot_username: string | null
}

export interface NotificationSettingsPatch {
  timezone?: string
  push_enabled?: boolean
  telegram_enabled?: boolean
  day_before?: boolean
  at_time?: boolean
}

export interface PushSubscriptionInput {
  endpoint: string
  keys: {
    p256dh: string
    auth: string
  }
}

export interface NotificationTestResult {
  ok: boolean
  message: string
  sent: number
}

export const AI_EDIT_MAX_NOTES = 6
export const AI_EDIT_MAX_INSTRUCTION = 2000

export const NOTE_KIND_LABEL: Record<NoteKind, string> = {
  note: 'Заметка',
  lesson: 'Урок',
  idea: 'Идея',
}

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
}

export const DEFAULT_MODELS = {
  text: 'google/gemini-2.5-flash',
  vision: 'google/gemini-2.5-flash',
  stt: 'openai/whisper-1',
}
