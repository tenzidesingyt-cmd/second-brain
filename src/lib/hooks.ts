import { useQuery } from '@tanstack/react-query'
import { api, type NotesQuery } from './api'

export const qk = {
  auth: ['auth'] as const,
  authUsers: ['auth', 'users'] as const,
  inbox: ['inbox'] as const,
  notes: ['notes'] as const,
  note: (id: string) => ['notes', 'detail', id] as const,
  noteList: (query: NotesQuery) => ['notes', 'list', query.kind || 'all', query.q || ''] as const,
  tasks: ['tasks'] as const,
  habits: ['habits'] as const,
  events: ['events'] as const,
  analytics: ['analytics'] as const,
  analyticsWeek: (weekStart: string) => ['analytics', weekStart] as const,
  aiSettings: ['ai-settings'] as const,
  notifications: ['notifications'] as const,
  search: (query: string) => ['search', query] as const,
}

export function useInbox() {
  return useQuery({
    queryKey: qk.inbox,
    queryFn: () => api.inbox.list(),
  })
}

export function useNotes(query: NotesQuery = {}) {
  return useQuery({
    queryKey: qk.noteList(query),
    queryFn: () => api.notes.list(query),
    placeholderData: (previous) => previous,
  })
}

export function useNote(id: string | undefined) {
  return useQuery({
    queryKey: qk.note(id || ''),
    queryFn: () => api.notes.get(id!),
    enabled: Boolean(id),
  })
}

export function useTasks() {
  return useQuery({
    queryKey: qk.tasks,
    queryFn: () => api.tasks.list(),
  })
}

export function useHabits() {
  return useQuery({
    queryKey: qk.habits,
    queryFn: () => api.habits.list(),
  })
}

export function useEvents() {
  return useQuery({
    queryKey: qk.events,
    queryFn: () => api.events.list(),
  })
}

export function useAnalytics(weekStart: string) {
  return useQuery({
    queryKey: qk.analyticsWeek(weekStart),
    queryFn: () => api.analytics.week(weekStart, Intl.DateTimeFormat().resolvedOptions().timeZone),
  })
}

export function useAiSettings() {
  return useQuery({
    queryKey: qk.aiSettings,
    queryFn: () => api.ai.settings(),
    staleTime: 30_000,
  })
}

export function useSearch(query: string, enabled = true) {
  return useQuery({
    queryKey: qk.search(query),
    queryFn: () => api.search(query),
    enabled: enabled && query.trim().length > 0,
    staleTime: 15_000,
  })
}
