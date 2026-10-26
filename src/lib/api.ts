import type {
  AISearchResponse,
  AISettingsInfo,
  AnalyticsSummaryResponse,
  AuthState,
  AuthUser,
  CalendarEvent,
  Habit,
  InboxItem,
  MediaFile,
  Note,
  NotesAiEditResponse,
  NotificationSettingsInfo,
  NotificationSettingsPatch,
  NotificationTestResult,
  PushSubscriptionInput,
  SearchResponse,
  Task,
  WeekAnalytics,
} from '../../shared/types'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export const UNAUTHORIZED_EVENT = 'brain:unauthorized'

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers,
  })
  if (!response.ok) {
    let message = `Ошибка ${response.status}`
    try {
      const data = (await response.json()) as { error?: string }
      if (data?.error) message = data.error
    } catch {
      // keep the default message
    }
    if (response.status === 401 && !path.startsWith('/api/auth')) {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    throw new ApiError(message, response.status)
  }
  if (response.status === 204) return undefined as T
  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) return (await response.text()) as T
  return (await response.json()) as T
}

export interface NotesQuery {
  kind?: string
  q?: string
}

export interface InboxCreateInput {
  text: string
  files: File[]
  tz: string
  autoProcess: boolean
}

export const api = {
  auth: {
    me: () => request<AuthState>('/api/auth/me'),
    login: (login: string, password: string) =>
      request<{ ok: boolean; user: AuthUser | null }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ login, password }),
      }),
    logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
    users: () => request<AuthUser[]>('/api/auth/users'),
  },

  inbox: {
    list: () => request<InboxItem[]>('/api/inbox'),
    create: (input: InboxCreateInput) => {
      const form = new FormData()
      form.append('text', input.text)
      form.append('tz', input.tz)
      form.append('autoProcess', input.autoProcess ? 'true' : 'false')
      for (const file of input.files) form.append('files', file)
      return request<InboxItem>('/api/inbox', { method: 'POST', body: form })
    },
    process: (id: string) => request<InboxItem>(`/api/inbox/${id}/process`, { method: 'POST' }),
    convert: (id: string, target: 'note' | 'task') =>
      request<{ inbox: InboxItem; note_id: string | null; task_id: string | null }>(
        `/api/inbox/${id}/convert`,
        { method: 'POST', body: JSON.stringify({ target }) },
      ),
    remove: (id: string) => request<{ ok: boolean }>(`/api/inbox/${id}`, { method: 'DELETE' }),
  },

  notes: {
    list: (query: NotesQuery = {}) => {
      const params = new URLSearchParams()
      if (query.kind) params.set('kind', query.kind)
      if (query.q) params.set('q', query.q)
      const suffix = params.size ? `?${params.toString()}` : ''
      return request<Note[]>(`/api/notes${suffix}`)
    },
    get: (id: string) => request<Note>(`/api/notes/${id}`),
    create: (input: Partial<Pick<Note, 'title' | 'body' | 'kind' | 'tags' | 'pinned'>>) =>
      request<Note>('/api/notes', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: Partial<Pick<Note, 'title' | 'body' | 'kind' | 'tags' | 'pinned'>>) =>
      request<Note>(`/api/notes/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/notes/${id}`, { method: 'DELETE' }),
    aiEdit: (noteIds: string[], instruction: string) =>
      request<NotesAiEditResponse>('/api/notes/ai-edit', {
        method: 'POST',
        body: JSON.stringify({ noteIds, instruction }),
      }),
    upload: (id: string, files: File[]) => {
      const form = new FormData()
      for (const file of files) form.append('files', file)
      return request<Note>(`/api/notes/${id}/files`, { method: 'POST', body: form })
    },
    removeFile: (id: string, fileId: string) =>
      request<Note>(`/api/notes/${id}/files/${fileId}`, { method: 'DELETE' }),
  },

  tasks: {
    list: () => request<Task[]>('/api/tasks'),
    create: (input: {
      title: string
      notes?: string
      due_date?: string | null
      due_time?: string | null
      priority?: string
    }) => request<Task>('/api/tasks', { method: 'POST', body: JSON.stringify(input) }),
    update: (
      id: string,
      input: Partial<{
        title: string
        notes: string
        due_date: string | null
        due_time: string | null
        priority: string
        completed: boolean
      }>,
    ) => request<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/tasks/${id}`, { method: 'DELETE' }),
    removeFile: (id: string, fileId: string) =>
      request<Task>(`/api/tasks/${id}/files/${fileId}`, { method: 'DELETE' }),
  },

  habits: {
    list: () => request<Habit[]>('/api/habits'),
    create: (input: { title: string; emoji?: string }) =>
      request<Habit>('/api/habits', { method: 'POST', body: JSON.stringify(input) }),
    update: (id: string, input: { title?: string; emoji?: string }) =>
      request<Habit>(`/api/habits/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/habits/${id}`, { method: 'DELETE' }),
    toggle: (id: string, date: string, done: boolean) =>
      request<Habit>(`/api/habits/${id}/toggle`, {
        method: 'POST',
        body: JSON.stringify({ date, done }),
      }),
  },

  events: {
    list: () => request<CalendarEvent[]>('/api/events'),
    create: (input: {
      title: string
      description?: string
      starts_at: string
      ends_at?: string | null
      all_day?: boolean
      location?: string | null
    }) => request<CalendarEvent>('/api/events', { method: 'POST', body: JSON.stringify(input) }),
    update: (
      id: string,
      input: Partial<{
        title: string
        description: string
        starts_at: string
        ends_at: string | null
        all_day: boolean
        location: string | null
      }>,
    ) => request<CalendarEvent>(`/api/events/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
    remove: (id: string) => request<{ ok: boolean }>(`/api/events/${id}`, { method: 'DELETE' }),
    removeFile: (id: string, fileId: string) =>
      request<CalendarEvent>(`/api/events/${id}/files/${fileId}`, { method: 'DELETE' }),
  },

  analytics: {
    week: (weekStart: string, tz: string) =>
      request<WeekAnalytics>(
        `/api/analytics/week?weekStart=${encodeURIComponent(weekStart)}&tz=${encodeURIComponent(tz)}`,
      ),
    summary: (weekStart: string, tz: string) =>
      request<AnalyticsSummaryResponse>('/api/analytics/summary', {
        method: 'POST',
        body: JSON.stringify({ weekStart, tz }),
      }),
  },

  ai: {
    settings: () => request<AISettingsInfo>('/api/settings/ai'),
    saveSettings: (input: {
      apiKey?: string
      textModel?: string
      visionModel?: string
      sttModel?: string
      clearKey?: boolean
    }) => request<AISettingsInfo>('/api/settings/ai', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
    test: () =>
      request<{ ok: boolean; message: string; model: string }>('/api/settings/ai/test', {
        method: 'POST',
      }),
    search: (query: string) =>
      request<AISearchResponse>('/api/search/ai', {
        method: 'POST',
        body: JSON.stringify({ query }),
      }),
  },

  notifications: {
    settings: () => request<NotificationSettingsInfo>('/api/notifications/settings'),
    saveSettings: (patch: NotificationSettingsPatch) =>
      request<NotificationSettingsInfo>('/api/notifications/settings', {
        method: 'PUT',
        body: JSON.stringify(patch),
      }),
    subscribe: (subscription: PushSubscriptionInput) =>
      request<{ ok: boolean; subscriptions: number }>('/api/notifications/subscriptions', {
        method: 'POST',
        body: JSON.stringify(subscription),
      }),
    unsubscribe: (endpoint: string) =>
      request<{ ok: boolean; subscriptions: number }>('/api/notifications/subscriptions', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint }),
      }),
    test: (channel: 'push' | 'telegram') =>
      request<NotificationTestResult>('/api/notifications/test', {
        method: 'POST',
        body: JSON.stringify({ channel }),
      }),
  },

  search: (query: string) =>
    request<SearchResponse>(`/api/search?q=${encodeURIComponent(query)}`),

  exportData: async (): Promise<Blob> => {
    const response = await fetch('/api/export', { credentials: 'same-origin' })
    if (!response.ok) {
      throw new ApiError('Не удалось подготовить экспорт.', response.status)
    }
    return response.blob()
  },
}

export function fileUrl(file: MediaFile): string {
  return file.url
}
