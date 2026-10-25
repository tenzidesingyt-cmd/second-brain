import fs from 'node:fs'
import path from 'node:path'
import { db, uploadsDir } from './db'
import { addDays, localDayOf, nowIso, safeJson, startOfWeek, todayInTz, uid } from './utils'
import type {
  AIResult,
  AISearchResponse,
  CalendarEvent,
  DayStat,
  Habit,
  HabitStat,
  InboxItem,
  InboxStatus,
  InboxType,
  MediaFile,
  Note,
  NoteKind,
  SearchResponse,
  Task,
  TaskPriority,
  WeekAnalytics,
} from '../shared/types'

interface FileRow {
  id: string
  name: string
  mime: string
  size: number
  stored_name: string
  created_at: string
}

interface InboxRow {
  id: string
  text: string
  type: string
  tz: string
  status: string
  ai_result: string | null
  ai_error: string | null
  created_at: string
  processed_at: string | null
}

interface NoteRow {
  id: string
  title: string
  body: string
  kind: string
  tags: string
  pinned: number
  source_inbox_id: string | null
  created_at: string
  updated_at: string
}

interface TaskRow {
  id: string
  title: string
  notes: string
  due_date: string | null
  due_time: string | null
  priority: string
  completed: number
  completed_at: string | null
  source_inbox_id: string | null
  created_at: string
  updated_at: string
}

interface EventRow {
  id: string
  title: string
  description: string
  starts_at: string
  ends_at: string | null
  all_day: number
  location: string | null
  source_inbox_id: string | null
  created_at: string
  updated_at: string
}

interface HabitRow {
  id: string
  title: string
  emoji: string
  archived: number
  created_at: string
}

const rows = <T>(value: unknown): T[] => value as unknown as T[]
const row = <T>(value: unknown): T | undefined => value as unknown as T | undefined

function mediaFromFile(file: FileRow): MediaFile {
  return {
    id: file.id,
    name: file.name,
    mime: file.mime,
    size: file.size,
    url: `/api/files/${file.id}`,
    created_at: file.created_at,
  }
}

function attachmentsFor(entityType: string, ids: string[]): Map<string, MediaFile[]> {
  const result = new Map<string, MediaFile[]>()
  for (const id of ids) result.set(id, [])
  if (!ids.length) return result
  const placeholders = ids.map(() => '?').join(',')
  const found = rows<FileRow & { entity_id: string }>(
    db
      .prepare(
        `SELECT a.entity_id, f.id, f.name, f.mime, f.size, f.stored_name, f.created_at
         FROM attachments a JOIN files f ON f.id = a.file_id
         WHERE a.entity_type = ? AND a.entity_id IN (${placeholders})
         ORDER BY a.created_at ASC`,
      )
      .all(entityType, ...ids),
  )
  for (const file of found) {
    result.get(file.entity_id)?.push(mediaFromFile(file))
  }
  return result
}

export function registerFile(input: {
  name: string
  mime: string
  size: number
  stored_name: string
}): MediaFile {
  const id = uid()
  const created_at = nowIso()
  db.prepare(
    `INSERT INTO files (id, name, mime, size, stored_name, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.name, input.mime, input.size, input.stored_name, created_at)
  return {
    id,
    name: input.name,
    mime: input.mime,
    size: input.size,
    url: `/api/files/${id}`,
    created_at,
  }
}

export function attachFiles(entityType: string, entityId: string, fileIds: string[]): void {
  const statement = db.prepare(
    `INSERT OR IGNORE INTO attachments (id, file_id, entity_type, entity_id, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const createdAt = nowIso()
  for (const fileId of fileIds) {
    statement.run(uid(), fileId, entityType, entityId, createdAt)
  }
}

export function getPhysicalFile(fileId: string): { file: MediaFile; absPath: string } | null {
  const found = row<FileRow>(db.prepare(`SELECT * FROM files WHERE id = ?`).get(fileId))
  if (!found) return null
  return {
    file: mediaFromFile(found),
    absPath: path.join(uploadsDir, found.stored_name),
  }
}

function cleanupFileIfOrphan(fileId: string): void {
  const used = row<{ count: number }>(
    db.prepare(`SELECT COUNT(*) as count FROM attachments WHERE file_id = ?`).get(fileId),
  )
  if (used && used.count > 0) return
  const file = row<FileRow>(db.prepare(`SELECT * FROM files WHERE id = ?`).get(fileId))
  if (!file) return
  try {
    fs.rmSync(path.join(uploadsDir, file.stored_name), { force: true })
  } catch {
    // The DB row is removed even if the file is locked on disk.
  }
  db.prepare(`DELETE FROM files WHERE id = ?`).run(fileId)
}

export function detachFile(entityType: string, entityId: string, fileId: string): void {
  const existing = row<{ file_id: string }>(
    db
      .prepare(`SELECT file_id FROM attachments WHERE entity_type = ? AND entity_id = ? AND file_id = ?`)
      .get(entityType, entityId, fileId),
  )
  if (!existing) return
  db.prepare(`DELETE FROM attachments WHERE entity_type = ? AND entity_id = ? AND file_id = ?`).run(
    entityType,
    entityId,
    fileId,
  )
  cleanupFileIfOrphan(fileId)
}

function detachAll(entityType: string, entityId: string): void {
  const linked = rows<{ file_id: string }>(
    db
      .prepare(`SELECT file_id FROM attachments WHERE entity_type = ? AND entity_id = ?`)
      .all(entityType, entityId),
  )
  db.prepare(`DELETE FROM attachments WHERE entity_type = ? AND entity_id = ?`).run(entityType, entityId)
  for (const file of linked) cleanupFileIfOrphan(file.file_id)
}

// ── Inbox ────────────────────────────────────────────────────────────────

function mapInboxItems(items: InboxRow[]): InboxItem[] {
  const files = attachmentsFor('inbox', items.map((item) => item.id))
  return items.map((item) => ({
    id: item.id,
    text: item.text,
    type: item.type as InboxType,
    tz: item.tz,
    status: item.status as InboxStatus,
    ai_result: safeJson<AIResult | null>(item.ai_result, null),
    ai_error: item.ai_error,
    files: files.get(item.id) || [],
    created_at: item.created_at,
    processed_at: item.processed_at,
  }))
}

export function listInbox(status?: string): InboxItem[] {
  const items = status
    ? rows<InboxRow>(
        db.prepare(`SELECT * FROM inbox_items WHERE status = ? ORDER BY created_at DESC LIMIT 300`).all(status),
      )
    : rows<InboxRow>(db.prepare(`SELECT * FROM inbox_items ORDER BY created_at DESC LIMIT 300`).all())
  return mapInboxItems(items)
}

export function getInboxItem(id: string): InboxItem | null {
  const item = row<InboxRow>(db.prepare(`SELECT * FROM inbox_items WHERE id = ?`).get(id))
  return item ? mapInboxItems([item])[0] : null
}

export function createInboxItem(input: {
  text: string
  type: InboxType
  tz: string
  status?: InboxStatus
  ai_error?: string | null
}): InboxItem {
  const id = uid()
  db.prepare(
    `INSERT INTO inbox_items (id, text, type, tz, status, ai_error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.text,
    input.type,
    input.tz || 'UTC',
    input.status || 'new',
    input.ai_error || null,
    nowIso(),
  )
  return getInboxItem(id)!
}

export function updateInboxItem(
  id: string,
  patch: {
    text?: string
    type?: InboxType
    status?: InboxStatus
    ai_result?: AIResult | null
    ai_error?: string | null
    processed_at?: string | null
  },
): InboxItem | null {
  const fields: string[] = []
  const values: (string | number | null)[] = []
  if (patch.text !== undefined) {
    fields.push('text = ?')
    values.push(patch.text)
  }
  if (patch.type !== undefined) {
    fields.push('type = ?')
    values.push(patch.type)
  }
  if (patch.status !== undefined) {
    fields.push('status = ?')
    values.push(patch.status)
  }
  if (patch.ai_result !== undefined) {
    fields.push('ai_result = ?')
    values.push(patch.ai_result ? JSON.stringify(patch.ai_result) : null)
  }
  if (patch.ai_error !== undefined) {
    fields.push('ai_error = ?')
    values.push(patch.ai_error)
  }
  if (patch.processed_at !== undefined) {
    fields.push('processed_at = ?')
    values.push(patch.processed_at)
  }
  if (!fields.length) return getInboxItem(id)
  values.push(id)
  db.prepare(`UPDATE inbox_items SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getInboxItem(id)
}

export function deleteInboxItem(id: string): void {
  detachAll('inbox', id)
  db.prepare(`DELETE FROM inbox_items WHERE id = ?`).run(id)
}

// ── Notes ────────────────────────────────────────────────────────────────

function mapNotes(noteRows: NoteRow[]): Note[] {
  const files = attachmentsFor('note', noteRows.map((note) => note.id))
  return noteRows.map((note) => ({
    id: note.id,
    title: note.title,
    body: note.body,
    kind: note.kind as NoteKind,
    tags: safeJson<string[]>(note.tags, []),
    pinned: Boolean(note.pinned),
    source_inbox_id: note.source_inbox_id,
    attachments: files.get(note.id) || [],
    created_at: note.created_at,
    updated_at: note.updated_at,
  }))
}

export function listNotes(input: { kind?: NoteKind; q?: string } = {}): Note[] {
  let noteRows: NoteRow[]
  const query = input.q?.trim()
  if (query) {
    const match = buildFtsMatch(query)
    if (!match) return []
    try {
      noteRows = rows<NoteRow>(
        db
          .prepare(
            `SELECT * FROM notes WHERE rowid IN (
               SELECT rowid FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT 100
             ) ORDER BY updated_at DESC`,
          )
          .all(match),
      )
    } catch {
      return []
    }
  } else {
    noteRows = rows<NoteRow>(db.prepare(`SELECT * FROM notes ORDER BY pinned DESC, updated_at DESC`).all())
  }
  if (input.kind) noteRows = noteRows.filter((note) => note.kind === input.kind)
  return mapNotes(noteRows)
}

export function getNote(id: string): Note | null {
  const note = row<NoteRow>(db.prepare(`SELECT * FROM notes WHERE id = ?`).get(id))
  return note ? mapNotes([note])[0] : null
}

export function createNote(input: {
  title?: string
  body?: string
  kind?: NoteKind
  tags?: string[]
  pinned?: boolean
  source_inbox_id?: string | null
  fileIds?: string[]
}): Note {
  const id = uid()
  const timestamp = nowIso()
  db.prepare(
    `INSERT INTO notes (id, title, body, kind, tags, pinned, source_inbox_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title?.trim() || '',
    input.body || '',
    input.kind || 'note',
    JSON.stringify(input.tags || []),
    input.pinned ? 1 : 0,
    input.source_inbox_id || null,
    timestamp,
    timestamp,
  )
  if (input.fileIds?.length) attachFiles('note', id, input.fileIds)
  return getNote(id)!
}

export function updateNote(
  id: string,
  patch: {
    title?: string
    body?: string
    kind?: NoteKind
    tags?: string[]
    pinned?: boolean
  },
): Note | null {
  const fields: string[] = []
  const values: (string | number)[] = []
  if (patch.title !== undefined) {
    fields.push('title = ?')
    values.push(patch.title)
  }
  if (patch.body !== undefined) {
    fields.push('body = ?')
    values.push(patch.body)
  }
  if (patch.kind !== undefined) {
    fields.push('kind = ?')
    values.push(patch.kind)
  }
  if (patch.tags !== undefined) {
    fields.push('tags = ?')
    values.push(JSON.stringify(patch.tags))
  }
  if (patch.pinned !== undefined) {
    fields.push('pinned = ?')
    values.push(patch.pinned ? 1 : 0)
  }
  if (!fields.length) return getNote(id)
  fields.push('updated_at = ?')
  values.push(nowIso())
  values.push(id)
  db.prepare(`UPDATE notes SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getNote(id)
}

export function deleteNote(id: string): void {
  detachAll('note', id)
  db.prepare(`DELETE FROM notes WHERE id = ?`).run(id)
}

// ── Tasks ────────────────────────────────────────────────────────────────

function mapTasks(taskRows: TaskRow[]): Task[] {
  const files = attachmentsFor('task', taskRows.map((task) => task.id))
  return taskRows.map((task) => ({
    id: task.id,
    title: task.title,
    notes: task.notes,
    due_date: task.due_date,
    due_time: task.due_time,
    priority: task.priority as TaskPriority,
    completed: Boolean(task.completed),
    completed_at: task.completed_at,
    source_inbox_id: task.source_inbox_id,
    attachments: files.get(task.id) || [],
    created_at: task.created_at,
    updated_at: task.updated_at,
  }))
}

export function listTasks(): Task[] {
  return mapTasks(
    rows<TaskRow>(
      db
        .prepare(
          `SELECT * FROM tasks ORDER BY completed ASC, due_date IS NULL, due_date ASC, due_time IS NULL, due_time ASC, created_at DESC`,
        )
        .all(),
    ),
  )
}

export function getTask(id: string): Task | null {
  const task = row<TaskRow>(db.prepare(`SELECT * FROM tasks WHERE id = ?`).get(id))
  return task ? mapTasks([task])[0] : null
}

export function createTask(input: {
  title: string
  notes?: string
  due_date?: string | null
  due_time?: string | null
  priority?: TaskPriority
  completed?: boolean
  source_inbox_id?: string | null
  fileIds?: string[]
}): Task {
  const id = uid()
  const timestamp = nowIso()
  db.prepare(
    `INSERT INTO tasks (id, title, notes, due_date, due_time, priority, completed, completed_at, source_inbox_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title.trim(),
    input.notes || '',
    input.due_date || null,
    input.due_time || null,
    input.priority || 'normal',
    input.completed ? 1 : 0,
    input.completed ? timestamp : null,
    input.source_inbox_id || null,
    timestamp,
    timestamp,
  )
  if (input.fileIds?.length) attachFiles('task', id, input.fileIds)
  return getTask(id)!
}

export function updateTask(
  id: string,
  patch: {
    title?: string
    notes?: string
    due_date?: string | null
    due_time?: string | null
    priority?: TaskPriority
    completed?: boolean
  },
): Task | null {
  const current = getTask(id)
  if (!current) return null
  const fields: string[] = []
  const values: (string | number | null)[] = []
  if (patch.title !== undefined) {
    fields.push('title = ?')
    values.push(patch.title)
  }
  if (patch.notes !== undefined) {
    fields.push('notes = ?')
    values.push(patch.notes)
  }
  if (patch.due_date !== undefined) {
    fields.push('due_date = ?')
    values.push(patch.due_date)
  }
  if (patch.due_time !== undefined) {
    fields.push('due_time = ?')
    values.push(patch.due_time)
  }
  if (patch.priority !== undefined) {
    fields.push('priority = ?')
    values.push(patch.priority)
  }
  if (patch.completed !== undefined) {
    fields.push('completed = ?')
    values.push(patch.completed ? 1 : 0)
    fields.push('completed_at = ?')
    values.push(patch.completed ? current.completed_at || nowIso() : null)
  }
  if (!fields.length) return current
  fields.push('updated_at = ?')
  values.push(nowIso())
  values.push(id)
  db.prepare(`UPDATE tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getTask(id)
}

export function deleteTask(id: string): void {
  detachAll('task', id)
  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(id)
}

// ── Habits ───────────────────────────────────────────────────────────────

function getHabitLogs(habitId: string): string[] {
  return rows<{ date: string }>(
    db.prepare(`SELECT date FROM habit_logs WHERE habit_id = ? ORDER BY date ASC`).all(habitId),
  ).map((entry) => entry.date)
}

function mapHabit(habit: HabitRow): Habit {
  return {
    id: habit.id,
    title: habit.title,
    emoji: habit.emoji,
    logs: getHabitLogs(habit.id),
    created_at: habit.created_at,
  }
}

export function listHabits(): Habit[] {
  return rows<HabitRow>(
    db.prepare(`SELECT * FROM habits WHERE archived = 0 ORDER BY created_at ASC`).all(),
  ).map(mapHabit)
}

export function getHabit(id: string): Habit | null {
  const habit = row<HabitRow>(db.prepare(`SELECT * FROM habits WHERE id = ?`).get(id))
  return habit ? mapHabit(habit) : null
}

export function createHabit(input: { title: string; emoji?: string }): Habit {
  const id = uid()
  db.prepare(`INSERT INTO habits (id, title, emoji, created_at) VALUES (?, ?, ?, ?)`).run(
    id,
    input.title.trim(),
    input.emoji || '✦',
    nowIso(),
  )
  return getHabit(id)!
}

export function updateHabit(id: string, patch: { title?: string; emoji?: string }): Habit | null {
  if (patch.title !== undefined) {
    db.prepare(`UPDATE habits SET title = ? WHERE id = ?`).run(patch.title, id)
  }
  if (patch.emoji !== undefined) {
    db.prepare(`UPDATE habits SET emoji = ? WHERE id = ?`).run(patch.emoji, id)
  }
  return getHabit(id)
}

export function deleteHabit(id: string): void {
  db.prepare(`DELETE FROM habits WHERE id = ?`).run(id)
}

export function toggleHabit(id: string, date: string, done: boolean): Habit | null {
  if (done) {
    db.prepare(`INSERT OR IGNORE INTO habit_logs (habit_id, date, created_at) VALUES (?, ?, ?)`).run(
      id,
      date,
      nowIso(),
    )
  } else {
    db.prepare(`DELETE FROM habit_logs WHERE habit_id = ? AND date = ?`).run(id, date)
  }
  return getHabit(id)
}

// ── Events ───────────────────────────────────────────────────────────────

function mapEvents(eventRows: EventRow[]): CalendarEvent[] {
  const files = attachmentsFor('event', eventRows.map((event) => event.id))
  return eventRows.map((event) => ({
    id: event.id,
    title: event.title,
    description: event.description,
    starts_at: event.starts_at,
    ends_at: event.ends_at,
    all_day: Boolean(event.all_day),
    location: event.location,
    source_inbox_id: event.source_inbox_id,
    attachments: files.get(event.id) || [],
    created_at: event.created_at,
    updated_at: event.updated_at,
  }))
}

export function listEvents(): CalendarEvent[] {
  return mapEvents(rows<EventRow>(db.prepare(`SELECT * FROM events ORDER BY starts_at ASC`).all()))
}

export function getEvent(id: string): CalendarEvent | null {
  const event = row<EventRow>(db.prepare(`SELECT * FROM events WHERE id = ?`).get(id))
  return event ? mapEvents([event])[0] : null
}

export function createEvent(input: {
  title: string
  description?: string
  starts_at: string
  ends_at?: string | null
  all_day?: boolean
  location?: string | null
  source_inbox_id?: string | null
  fileIds?: string[]
}): CalendarEvent {
  const id = uid()
  const timestamp = nowIso()
  db.prepare(
    `INSERT INTO events (id, title, description, starts_at, ends_at, all_day, location, source_inbox_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.title.trim(),
    input.description || '',
    input.starts_at,
    input.ends_at || null,
    input.all_day ? 1 : 0,
    input.location || null,
    input.source_inbox_id || null,
    timestamp,
    timestamp,
  )
  if (input.fileIds?.length) attachFiles('event', id, input.fileIds)
  return getEvent(id)!
}

export function updateEvent(
  id: string,
  patch: {
    title?: string
    description?: string
    starts_at?: string
    ends_at?: string | null
    all_day?: boolean
    location?: string | null
  },
): CalendarEvent | null {
  const fields: string[] = []
  const values: (string | number | null)[] = []
  if (patch.title !== undefined) {
    fields.push('title = ?')
    values.push(patch.title)
  }
  if (patch.description !== undefined) {
    fields.push('description = ?')
    values.push(patch.description)
  }
  if (patch.starts_at !== undefined) {
    fields.push('starts_at = ?')
    values.push(patch.starts_at)
  }
  if (patch.ends_at !== undefined) {
    fields.push('ends_at = ?')
    values.push(patch.ends_at)
  }
  if (patch.all_day !== undefined) {
    fields.push('all_day = ?')
    values.push(patch.all_day ? 1 : 0)
  }
  if (patch.location !== undefined) {
    fields.push('location = ?')
    values.push(patch.location)
  }
  if (!fields.length) return getEvent(id)
  fields.push('updated_at = ?')
  values.push(nowIso())
  values.push(id)
  db.prepare(`UPDATE events SET ${fields.join(', ')} WHERE id = ?`).run(...values)
  return getEvent(id)
}

export function deleteEvent(id: string): void {
  detachAll('event', id)
  db.prepare(`DELETE FROM events WHERE id = ?`).run(id)
}

// ── Settings & summaries ─────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const found = row<{ value: string }>(db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key))
  return found?.value ?? null
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value)
}

export function deleteSetting(key: string): void {
  db.prepare(`DELETE FROM settings WHERE key = ?`).run(key)
}

export function getWeeklySummary(weekStart: string): { content: string; created_at: string } | null {
  const found = row<{ content: string; created_at: string }>(
    db.prepare(`SELECT content, created_at FROM weekly_summaries WHERE week_start = ?`).get(weekStart),
  )
  return found || null
}

export function saveWeeklySummary(weekStart: string, content: string): void {
  db.prepare(
    `INSERT INTO weekly_summaries (week_start, content, created_at) VALUES (?, ?, ?)
     ON CONFLICT(week_start) DO UPDATE SET content = excluded.content, created_at = excluded.created_at`,
  ).run(weekStart, content, nowIso())
}

// ── Search ───────────────────────────────────────────────────────────────

function buildFtsMatch(query: string): string {
  const tokens = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
  if (!tokens.length) return ''
  return tokens.map((token) => `"${token}"*`).join(' AND ')
}

export function searchAll(query: string): SearchResponse {
  const trimmed = query.trim()
  if (!trimmed) return { notes: [], tasks: [], inbox: [] }
  const match = buildFtsMatch(trimmed)
  if (!match) return { notes: [], tasks: [], inbox: [] }

  let notes: Note[] = []
  let tasks: Task[] = []
  let inbox: InboxItem[] = []
  try {
    notes = mapNotes(
      rows<NoteRow>(
        db
          .prepare(
            `SELECT * FROM notes WHERE rowid IN (
               SELECT rowid FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rank LIMIT 30
             ) ORDER BY updated_at DESC`,
          )
          .all(match),
      ),
    )
  } catch {
    notes = []
  }
  try {
    tasks = mapTasks(
      rows<TaskRow>(
        db
          .prepare(
            `SELECT * FROM tasks WHERE rowid IN (
               SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH ? ORDER BY rank LIMIT 30
             )`,
          )
          .all(match),
      ),
    )
  } catch {
    tasks = []
  }
  try {
    inbox = mapInboxItems(
      rows<InboxRow>(
        db
          .prepare(
            `SELECT * FROM inbox_items WHERE rowid IN (
               SELECT rowid FROM inbox_fts WHERE inbox_fts MATCH ? ORDER BY rank LIMIT 15
             ) ORDER BY created_at DESC`,
          )
          .all(match),
      ),
    )
  } catch {
    inbox = []
  }
  return { notes, tasks, inbox }
}

// ── Analytics ────────────────────────────────────────────────────────────

function habitStreak(logs: string[], today: string): number {
  const set = new Set(logs)
  let cursor = set.has(today) ? today : addDays(today, -1)
  let streak = 0
  while (set.has(cursor)) {
    streak += 1
    cursor = addDays(cursor, -1)
  }
  return streak
}

export function getWeekAnalytics(weekStartInput: string, tz: string): WeekAnalytics {
  const weekStart = startOfWeek(weekStartInput)
  const weekEnd = addDays(weekStart, 6)
  const today = todayInTz(tz)
  const allTasks = rows<TaskRow>(db.prepare(`SELECT * FROM tasks`).all())
  const allNotes = rows<{ created_at: string }>(db.prepare(`SELECT created_at FROM notes`).all())
  const allInbox = rows<{ created_at: string; status: string; processed_at: string | null }>(
    db.prepare(`SELECT created_at, status, processed_at FROM inbox_items`).all(),
  )
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  const inWeek = (day: string | null) => Boolean(day && day >= weekStart && day <= weekEnd)

  const daily: DayStat[] = days.map((date) => ({
    date,
    completed: allTasks.filter(
      (task) => task.completed && localDayOf(task.completed_at, tz) === date,
    ).length,
    created: allTasks.filter((task) => localDayOf(task.created_at, tz) === date).length,
    due: allTasks.filter((task) => task.due_date === date).length,
  }))

  const habits = listHabits().map<HabitStat>((habit) => ({
    id: habit.id,
    title: habit.title,
    emoji: habit.emoji,
    logs: habit.logs,
    streak: habitStreak(habit.logs, today),
    week_done: habit.logs.filter((day) => inWeek(day)).length,
    week_target: 7,
  }))

  return {
    week_start: weekStart,
    week_end: weekEnd,
    tasks_completed: allTasks.filter(
      (task) => task.completed && inWeek(localDayOf(task.completed_at, tz)),
    ).length,
    tasks_open: allTasks.filter((task) => !task.completed).length,
    tasks_overdue: allTasks.filter(
      (task) => !task.completed && task.due_date && task.due_date < today,
    ).length,
    tasks_due_in_week: allTasks.filter((task) => inWeek(task.due_date)).length,
    notes_created: allNotes.filter((note) => inWeek(localDayOf(note.created_at, tz))).length,
    inbox_captured: allInbox.filter((item) => inWeek(localDayOf(item.created_at, tz))).length,
    inbox_processed: allInbox.filter(
      (item) => item.status === 'done' && inWeek(localDayOf(item.processed_at, tz)),
    ).length,
    daily,
    habits,
    summary: getWeeklySummary(weekStart),
  }
}

export function getNotesForAiSearch(): Note[] {
  return mapNotes(
    rows<NoteRow>(
      db.prepare(`SELECT * FROM notes ORDER BY updated_at DESC LIMIT 80`).all(),
    ),
  )
}

export function buildAiSearchResponse(answer: string, noteIds: string[]): AISearchResponse {
  const uniqueIds = [...new Set(noteIds)].slice(0, 10)
  if (!uniqueIds.length) return { answer, notes: [] }
  const placeholders = uniqueIds.map(() => '?').join(',')
  const found = mapNotes(
    rows<NoteRow>(db.prepare(`SELECT * FROM notes WHERE id IN (${placeholders})`).all(...uniqueIds)),
  )
  const byId = new Map(found.map((note) => [note.id, note]))
  return {
    answer,
    notes: uniqueIds.map((id) => byId.get(id)).filter((note): note is Note => Boolean(note)),
  }
}

export function getAllInboxTz(): string {
  const found = row<{ tz: string }>(
    db.prepare(`SELECT tz FROM inbox_items ORDER BY created_at DESC LIMIT 1`).get(),
  )
  return found?.tz || 'UTC'
}
