import fs from 'node:fs'
import path from 'node:path'
import { broadcast } from './realtime'
import {
  buildAiSearchResponse,
  createEvent,
  createNote,
  createTask,
  deleteSetting,
  getInboxItem,
  getNotesForAiSearch,
  getPhysicalFile,
  getSetting,
  getWeekAnalytics,
  listHabits,
  listInbox,
  listNotes,
  listTasks,
  saveWeeklySummary,
  setSetting,
  updateInboxItem,
} from './store'
import { transaction } from './db'
import {
  localDayOf,
  normalizeDateTime,
  nowIso,
  timeInTz,
  todayInTz,
  truncate,
  validDate,
  validTime,
  weekdayInTz,
} from './utils'
import { DEFAULT_MODELS } from '../shared/types'
import type {
  AIEventDraft,
  AINoteDraft,
  AIResult,
  AISearchResponse,
  AISettingsInfo,
  AITaskDraft,
  MediaFile,
  NoteKind,
  TaskPriority,
} from '../shared/types'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_STT_URL = 'https://openrouter.ai/api/v1/audio/transcriptions'
const APP_TITLE = 'Second Brain'

export function getAiConfig(): AiConfig {
  const envKey = (process.env.OPENROUTER_API_KEY || '').trim()
  const storedKey = (getSetting('openrouter_key') || '').trim()
  const apiKey = envKey || storedKey
  return {
    apiKey,
    source: envKey ? 'env' : storedKey ? 'settings' : null,
    textModel: (getSetting('model_text') || process.env.OPENROUTER_MODEL || DEFAULT_MODELS.text).trim(),
    visionModel: (
      getSetting('model_vision') ||
      process.env.OPENROUTER_VISION_MODEL ||
      getSetting('model_text') ||
      process.env.OPENROUTER_MODEL ||
      DEFAULT_MODELS.vision
    ).trim(),
    sttModel: (getSetting('model_stt') || process.env.OPENROUTER_STT_MODEL || DEFAULT_MODELS.stt).trim(),
  }
}

export function getAiSettingsInfo(): AISettingsInfo {
  const config = getAiConfig()
  return {
    configured: Boolean(config.apiKey),
    source: config.source,
    key_hint: config.apiKey ? `…${config.apiKey.slice(-4)}` : null,
    text_model: config.textModel,
    vision_model: config.visionModel,
    stt_model: config.sttModel,
  }
}

export function saveAiSettings(input: {
  apiKey?: string
  textModel?: string
  visionModel?: string
  sttModel?: string
  clearKey?: boolean
}): AISettingsInfo {
  if (input.clearKey) deleteSetting('openrouter_key')
  if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
    setSetting('openrouter_key', input.apiKey.trim())
  }
  const saveModel = (key: string, value: string | undefined) => {
    if (typeof value !== 'string') return
    const cleaned = value.trim()
    if (!cleaned || cleaned.length > 120 || /\s/.test(cleaned)) return
    setSetting(key, cleaned)
  }
  saveModel('model_text', input.textModel)
  saveModel('model_vision', input.visionModel)
  saveModel('model_stt', input.sttModel)
  broadcast('ai:settings-changed')
  return getAiSettingsInfo()
}

export interface AiConfig {
  apiKey: string
  source: 'env' | 'settings' | null
  textModel: string
  visionModel: string
  sttModel: string
}

type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

interface ChatMessage {
  role: 'system' | 'user'
  content: string | ContentPart[]
}

function openRouterHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.PUBLIC_URL || 'http://localhost:8787',
    'X-Title': APP_TITLE,
  }
}

function describeOpenRouterError(status: number, body: string): string {
  let detail = ''
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string }
    detail = parsed.error?.message || parsed.message || ''
  } catch {
    detail = body.slice(0, 240)
  }
  if (status === 401) return 'Ключ OpenRouter недействителен. Проверьте его в настройках.'
  if (status === 402) return 'На балансе OpenRouter недостаточно средств.'
  if (status === 404) return `Модель недоступна в OpenRouter. Выберите другую модель в настройках. ${detail}`
  if (status === 429) return 'ИИ перегружен запросами. Подождите минуту и попробуйте снова.'
  return `Ошибка OpenRouter (${status})${detail ? `: ${truncate(detail, 220)}` : '.'}`
}

async function chatCompletion(options: {
  model: string
  messages: ChatMessage[]
  json?: boolean
  temperature?: number
  maxTokens?: number
}): Promise<string> {
  const config = getAiConfig()
  if (!config.apiKey) {
    throw new Error('ИИ не подключён. Добавьте ключ OpenRouter в настройках.')
  }
  const request = async (jsonMode: boolean) => {
    const body: Record<string, unknown> = {
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 2000,
    }
    if (jsonMode) body.response_format = { type: 'json_object' }
    return fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: openRouterHeaders(config.apiKey),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(150_000),
    })
  }

  let response = await request(Boolean(options.json))
  if (options.json && [400, 404, 422].includes(response.status)) {
    response = await request(false)
  }
  const text = await response.text()
  if (!response.ok) {
    throw new Error(describeOpenRouterError(response.status, text))
  }
  let parsed: {
    choices?: { message?: { content?: string | { type?: string; text?: string }[] } }[]
    error?: { message?: string }
  }
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('ИИ вернул некорректный ответ. Попробуйте ещё раз.')
  }
  if (parsed.error?.message) throw new Error(truncate(parsed.error.message, 300))
  const content = parsed.choices?.[0]?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part.text || '')).join('')
  }
  throw new Error('ИИ не вернул текст ответа.')
}

function extractJson(raw: string): Record<string, unknown> {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  try {
    return JSON.parse(cleaned) as Record<string, unknown>
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
      } catch {
        // fall through
      }
    }
    throw new Error('ИИ вернул ответ не в формате JSON. Попробуйте ещё раз.')
  }
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function stringList(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().slice(0, 40))
        .filter(Boolean),
    ),
  ].slice(0, limit)
}

function normalizeNote(raw: unknown): AINoteDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const title = text(source.title, 200)
  const markdown = text(source.markdown, 40_000)
  if (!title && !markdown) return null
  const kindValue = text(source.kind, 20)
  const kind: NoteKind = kindValue === 'lesson' || kindValue === 'idea' ? kindValue : 'note'
  return {
    title: title || 'Без названия',
    markdown,
    kind,
    tags: stringList(source.tags),
  }
}

function normalizeTasks(raw: unknown, today: string): AITaskDraft[] {
  if (!Array.isArray(raw)) return []
  const result: AITaskDraft[] = []
  for (const entry of raw.slice(0, 12)) {
    if (!entry || typeof entry !== 'object') continue
    const source = entry as Record<string, unknown>
    const title = text(source.title, 300)
    if (!title) continue
    let dueDate = validDate(source.due_date)
    const dueTime = validTime(source.due_time)
    if (dueTime && !dueDate) dueDate = today
    const priorityValue = text(source.priority, 20)
    const priority: TaskPriority =
      priorityValue === 'high' || priorityValue === 'low' ? priorityValue : 'normal'
    result.push({
      title,
      due_date: dueDate,
      due_time: dueDate ? dueTime : null,
      priority,
    })
  }
  return result
}

function normalizeEvent(raw: unknown): AIEventDraft | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const title = text(source.title, 200)
  const startsAt = normalizeDateTime(source.starts_at)
  if (!title || !startsAt) return null
  let endsAt = normalizeDateTime(source.ends_at)
  if (endsAt && endsAt <= startsAt) endsAt = null
  return {
    title,
    starts_at: startsAt,
    ends_at: endsAt,
    location: text(source.location, 200) || null,
  }
}

function deriveTitle(source: string): string {
  const firstLine = source.split('\n').find((line) => line.trim())
  return truncate((firstLine || 'Новая запись').replace(/^[#>\-*\s]+/, '').trim() || 'Новая запись', 90)
}

function normalizeResult(raw: Record<string, unknown>, sourceText: string, today: string): AIResult {
  let note = normalizeNote(raw.note)
  const tasks = normalizeTasks(raw.tasks, today)
  const event = normalizeEvent(raw.event)

  if (!note && !tasks.length && !event) {
    const fallbackText = sourceText.trim()
    note = {
      title: fallbackText ? deriveTitle(fallbackText) : 'Новая запись',
      markdown: fallbackText,
      kind: 'note',
      tags: [],
    }
  }
  if (note && !note.markdown && sourceText.trim()) note.markdown = sourceText.trim()
  if (note && !note.title) note.title = deriveTitle(note.markdown)

  const category: AIResult['category'] =
    event && (note || tasks.length)
      ? 'mixed'
      : event
        ? 'event'
        : note && tasks.length
          ? 'mixed'
          : tasks.length
            ? 'task'
            : note?.kind === 'idea'
              ? 'idea'
              : note
                ? 'note'
                : 'none'
  const filled = [note?.title, tasks[0]?.title, event?.title].find(Boolean) || 'Новая запись'

  return {
    title: text(raw.title, 200) || filled,
    summary:
      text(raw.summary, 700) ||
      truncate(sourceText.trim() || `${filled} — добавлено из инбокса.`, 300),
    category,
    note,
    tasks,
    event,
  }
}

interface LoadedImage {
  part: ContentPart
  name: string
}

function loadImages(files: MediaFile[]): LoadedImage[] {
  const loaded: LoadedImage[] = []
  let totalBytes = 0
  for (const file of files.filter((entry) => entry.mime.startsWith('image/')).slice(0, 4)) {
    const physical = getPhysicalFile(file.id)
    if (!physical) continue
    try {
      const stat = fs.statSync(physical.absPath)
      if (stat.size > 12 * 1024 * 1024) continue
      if (totalBytes + stat.size > 24 * 1024 * 1024) continue
      totalBytes += stat.size
      const base64 = fs.readFileSync(physical.absPath).toString('base64')
      loaded.push({
        name: file.name,
        part: {
          type: 'image_url',
          image_url: { url: `data:${file.mime || 'image/jpeg'};base64,${base64}` },
        },
      })
    } catch {
      // A broken image should not stop processing of the rest.
    }
  }
  return loaded
}

function audioFormat(file: MediaFile): string {
  const extension = path.extname(file.name).slice(1).toLowerCase()
  const aliases: Record<string, string> = { mp4: 'm4a', mpeg: 'mp3', opus: 'ogg', xwav: 'wav' }
  const fromName = aliases[extension] || extension
  const allowed = new Set(['wav', 'mp3', 'flac', 'm4a', 'ogg', 'webm', 'aac'])
  if (allowed.has(fromName)) return fromName
  const mime = file.mime.toLowerCase()
  if (mime.includes('webm')) return 'webm'
  if (mime.includes('mpeg')) return 'mp3'
  if (mime.includes('mp4')) return 'm4a'
  if (mime.includes('wav')) return 'wav'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('flac')) return 'flac'
  if (mime.includes('aac')) return 'aac'
  return 'mp3'
}

async function transcribeAudio(file: MediaFile, config: AiConfig): Promise<string> {
  const physical = getPhysicalFile(file.id)
  if (!physical) return ''
  const buffer = fs.readFileSync(physical.absPath)
  if (buffer.length > 24 * 1024 * 1024) {
    throw new Error(`Аудиофайл «${file.name}» слишком большой для расшифровки (лимит 24 МБ).`)
  }
  const response = await fetch(OPENROUTER_STT_URL, {
    method: 'POST',
    headers: openRouterHeaders(config.apiKey),
    body: JSON.stringify({
      model: config.sttModel,
      input_audio: {
        data: buffer.toString('base64'),
        format: audioFormat(file),
      },
    }),
    signal: AbortSignal.timeout(180_000),
  })
  const rawBody = await response.text()
  if (!response.ok) {
    throw new Error(describeOpenRouterError(response.status, rawBody))
  }
  try {
    const parsed = JSON.parse(rawBody) as { text?: string; transcript?: string }
    const transcript = (parsed.text || parsed.transcript || '').trim()
    if (!transcript) throw new Error('empty')
    return transcript
  } catch {
    throw new Error('Не удалось расшифровать голосовое сообщение. Попробуйте записать его ещё раз.')
  }
}

function processingPrompt(today: string, time: string, weekday: string, tz: string): string {
  return `Ты — внимательный ассистент личного приложения «Второй мозг». Ты превращаешь входящий материал (текст, фото, конспекты, голосовые) в структурированные сущности: заметки, задачи и события календаря.

Сейчас: ${weekday}, ${today}, ${time} (часовой пояс ${tz}).

Правила:
1. Верни ТОЛЬКО валидный JSON без markdown и пояснений.
2. Ничего не выдумывай. Если данных для задачи или события нет — не создавай их.
3. Если на изображениях есть текст (доска, тетрадь, скриншот, документ) — распознай его полностью (OCR) и сохрани в note.markdown, аккуратно структурируя заголовками, списками и кодом. Фото задания — это kind: "lesson".
4. Мысль или идея без действия — это note с kind: "idea". Справка или конспект — kind: "note" или "lesson".
5. Любое явное действие, поручение, дедлайн или просьба — это tasks. Извлекай все отдельные действия. Дедлайн переноси в due_date (YYYY-MM-DD), время — в due_time (HH:MM). Относительные даты («до пятницы», «завтра») считай от текущей даты выше. Если срок не назван — due_date: null.
6. Встреча, урок, день рождения, звонок с конкретным временем — это event. Формат starts_at/ends_at: "YYYY-MM-DDTHH:mm" (локальное время, без часового пояса).
7. Если одновременно есть что сохранить и что сделать (например, фото задания + поручение), заполни и note, и tasks, category: "mixed".
8. В summary напиши 1–2 коротких предложения по-русски: что это и что с этим делать.
9. Теги — короткие, по-русски, максимум 5. Приоритет задачи: low | normal | high.

Схема ответа:
{
  "title": "короткий заголовок",
  "summary": "что это и что дальше",
  "category": "task | note | idea | event | mixed | none",
  "note": {
    "title": "заголовок заметки",
    "markdown": "полный текст в markdown",
    "kind": "note | lesson | idea",
    "tags": ["тег"]
  },
  "tasks": [
    {
      "title": "действие",
      "due_date": "YYYY-MM-DD или null",
      "due_time": "HH:MM или null",
      "priority": "low | normal | high"
    }
  ],
  "event": {
    "title": "название",
    "starts_at": "YYYY-MM-DDTHH:mm",
    "ends_at": "YYYY-MM-DDTHH:mm или null",
    "location": "место или null"
  }
}

Поля note/tasks/event всегда присутствуют: используй null для note/event и [] для tasks, если они не нужны. Предметы и факты не добавляй от себя.`
}

export async function processInboxItem(itemId: string): Promise<void> {
  const item = getInboxItem(itemId)
  if (!item) return
  const config = getAiConfig()
  if (!config.apiKey) {
    updateInboxItem(itemId, {
      status: 'failed',
      ai_error: 'ИИ не подключён. Добавьте ключ OpenRouter в настройках и повторите обработку.',
    })
    broadcast('inbox:updated', { id: itemId })
    return
  }

  updateInboxItem(itemId, { status: 'processing', ai_error: null })
  broadcast('inbox:updated', { id: itemId })

  try {
    const audioFiles = item.files.filter(
      (file) => file.mime.startsWith('audio/') || /\.(mp3|wav|m4a|ogg|webm|aac|flac)$/i.test(file.name),
    )
    const transcripts: string[] = []
    for (const audio of audioFiles) {
      transcripts.push(await transcribeAudio(audio, config))
    }
    const transcript = transcripts.filter(Boolean).join('\n\n')
    const images = loadImages(item.files)
    const today = todayInTz(item.tz)
    const time = timeInTz(item.tz)
    const weekday = weekdayInTz(today, item.tz)

    const fileList = item.files
      .map((file) => `- ${file.name} (${file.mime}, ${Math.round(file.size / 1024)} КБ)`)
      .join('\n')
    const userText = [
      `Тип входящего материала: ${item.type}`,
      `Текст пользователя:\n${item.text.trim() || '(нет)'}`,
      `Расшифровка голосового:\n${transcript || '(нет)'}`,
      `Приложенные файлы:\n${fileList || '(нет)'}`,
      images.length
        ? `Изображения приложены ниже (${images.length}). Прочитай текст на них и используй визуальный контекст.`
        : '',
      audioFiles.length && !transcript
        ? 'Аудио недоступно для расшифровки — не выдумывай его содержание.'
        : '',
      'Разбери этот материал по правилам и верни JSON.',
    ]
      .filter(Boolean)
      .join('\n\n')

    const parts: ContentPart[] = [{ type: 'text', text: userText }]
    for (const image of images) parts.push(image.part)
    const model = images.length ? config.visionModel : config.textModel

    const rawAnswer = await chatCompletion({
      model,
      messages: [
        { role: 'system', content: processingPrompt(today, time, weekday, item.tz) },
        { role: 'user', content: parts },
      ],
      json: true,
      temperature: 0.15,
      maxTokens: 3200,
    })
    const parsed = extractJson(rawAnswer)
    const result = normalizeResult(parsed, [item.text, transcript].filter(Boolean).join('\n\n'), today)
    if (transcript) result.transcript = transcript

    const fileIds = item.files.map((file) => file.id)

    transaction(() => {
      if (result.note) {
        const note = createNote({
          title: result.note.title,
          body: result.note.markdown,
          kind: result.note.kind,
          tags: result.note.tags,
          source_inbox_id: item.id,
          fileIds,
        })
        result.created_note_id = note.id
      }
      if (result.tasks?.length) {
        result.created_task_ids = result.tasks.map((task) => {
          const created = createTask({
            title: task.title,
            due_date: task.due_date || null,
            due_time: task.due_time || null,
            priority: task.priority || 'normal',
            source_inbox_id: item.id,
            fileIds,
          })
          return created.id
        })
      }
      if (result.event) {
        const event = createEvent({
          title: result.event.title,
          starts_at: result.event.starts_at,
          ends_at: result.event.ends_at || null,
          location: result.event.location || null,
          source_inbox_id: item.id,
          fileIds,
        })
        result.created_event_id = event.id
      }
      updateInboxItem(itemId, {
        status: 'done',
        ai_result: result,
        ai_error: null,
        processed_at: nowIso(),
      })
    })

    broadcast('inbox:updated', { id: itemId })
    broadcast('notes:changed', { source: 'ai' })
    broadcast('tasks:changed', { source: 'ai' })
    broadcast('events:changed', { source: 'ai' })
  } catch (error) {
    const message =
      error instanceof Error && error.message
        ? error.message
        : 'Не удалось обработать материал. Попробуйте ещё раз.'
    console.error(`[ai] inbox ${itemId}:`, message)
    updateInboxItem(itemId, { status: 'failed', ai_error: truncate(message, 500) })
    broadcast('inbox:updated', { id: itemId })
  }
}

const queue: string[] = []
const active = new Set<string>()
let running = 0
const MAX_CONCURRENT = 2

export function enqueueInbox(itemId: string): void {
  if (!queue.includes(itemId) && !active.has(itemId)) queue.push(itemId)
  pumpQueue()
}

function pumpQueue(): void {
  while (running < MAX_CONCURRENT && queue.length) {
    const id = queue.shift()!
    active.add(id)
    running += 1
    processInboxItem(id)
      .catch((error) => {
        console.error('[ai] queue error:', error)
      })
      .finally(() => {
        active.delete(id)
        running -= 1
        pumpQueue()
      })
  }
}

export function resetStuckInbox(): void {
  for (const item of listInbox('processing')) {
    updateInboxItem(item.id, {
      status: 'failed',
      ai_error: 'Обработка была прервана перезапуском сервера. Нажмите «Обработать снова».',
    })
  }
}

export async function runAiSearch(query: string): Promise<AISearchResponse> {
  const config = getAiConfig()
  if (!config.apiKey) {
    throw new Error('ИИ не подключён. Добавьте ключ OpenRouter в настройках.')
  }
  const notes = getNotesForAiSearch()
  if (!notes.length) {
    return { answer: 'Пока нет заметок, по которым можно искать. Сначала сохрани что-нибудь в инбокс.', notes: [] }
  }
  const catalog = notes.slice(0, 60).map((note) => ({
    id: note.id,
    title: note.title,
    kind: note.kind,
    tags: note.tags,
    excerpt: truncate(note.body || '', 500),
  }))
  const rawAnswer = await chatCompletion({
    model: config.textModel,
    messages: [
      {
        role: 'system',
        content:
          'Ты — поисковый ассистент личной базы заметок. Отвечай по-русски. Нужно найти заметки, наиболее релевантные смысловому запросу. Верни ТОЛЬКО JSON: {"answer": "краткий полезный ответ 1-3 предложения без выдумок", "note_ids": ["id подходящих заметок, максимум 6"]}. Если ничего не подходит — пустой массив и честный ответ. Не придумывай заметки и id, используй только предоставленный каталог.',
      },
      {
        role: 'user',
        content: `Запрос: ${query}\n\nКаталог заметок:\n${JSON.stringify(catalog)}`,
      },
    ],
    json: true,
    temperature: 0.2,
    maxTokens: 900,
  })
  let parsed: { answer?: string; note_ids?: string[] }
  try {
    parsed = extractJson(rawAnswer) as { answer?: string; note_ids?: string[] }
  } catch {
    parsed = { answer: rawAnswer.slice(0, 1200), note_ids: [] }
  }
  const validIds = new Set(notes.map((note) => note.id))
  const ids = Array.isArray(parsed.note_ids)
    ? parsed.note_ids.filter((id): id is string => typeof id === 'string' && validIds.has(id))
    : []
  const answer =
    typeof parsed.answer === 'string' && parsed.answer.trim()
      ? parsed.answer.trim()
      : ids.length
        ? 'Вот заметки, которые подходят по смыслу:'
        : 'По этому запросу ничего не нашлось. Попробуйте сформулировать иначе.'
  return buildAiSearchResponse(answer, ids)
}

export async function generateWeeklySummary(
  weekStart: string,
  tz: string,
): Promise<{ content: string; created_at: string }> {
  const config = getAiConfig()
  if (!config.apiKey) {
    throw new Error('ИИ не подключён. Добавьте ключ OpenRouter в настройках.')
  }
  const analytics = getWeekAnalytics(weekStart, tz)
  const tasks = listTasks()
  const completed = tasks.filter((task) => {
    const day = localDayOf(task.completed_at, tz)
    return task.completed && day && day >= analytics.week_start && day <= analytics.week_end
  })
  const overdue = tasks.filter((task) => !task.completed && task.due_date && task.due_date < todayInTz(tz))
  const notes = listNotes().filter((note) => {
    const day = localDayOf(note.created_at, tz)
    return day && day >= analytics.week_start && day <= analytics.week_end
  })
  const habits = listHabits()
  const habitLines = analytics.habits
    .map((habit) => `${habit.emoji} ${habit.title}: ${habit.week_done}/7, серия ${habit.streak}`)
    .join('\n')

  const prompt = `С недельной статистикой приложения «Второй мозг». Составь короткую, тёплую и конкретную сводку на русском в markdown.

Период: ${analytics.week_start} — ${analytics.week_end}.
Завершено задач: ${analytics.tasks_completed}. Просрочено на текущий момент: ${analytics.tasks_overdue}. Задач с дедлайном на неделе: ${analytics.tasks_due_in_week}. Всего открытых: ${analytics.tasks_open}.
Создано заметок: ${analytics.notes_created}. Записей в инбоксе: ${analytics.inbox_captured}, обработано ИИ: ${analytics.inbox_processed}.
По дням (завершено): ${analytics.daily.map((day) => `${day.date}: ${day.completed}`).join(', ')}.
Привычки:
${habitLines || '(нет привычек)'}
Выполненные задачи: ${completed.map((task) => `«${task.title}»`).join(', ') || '(нет)'}.
Просроченные задачи: ${overdue.slice(0, 8).map((task) => `«${task.title}»`).join(', ') || '(нет)'}.
Заметки за неделю: ${notes.slice(0, 10).map((note) => `«${note.title}»`).join(', ') || '(нет)'}.

Формат: 2–4 пункта наблюдений по фактическим данным, затем один пункт «Фокус на следующую неделю» с конкретным советом. Если данных мало — скажи это мягко. Не выдумывай события и цифры. Без заголовка «Сводка» и без лишних вступлений. Длина — до 900 символов.`

  const content = (
    await chatCompletion({
      model: config.textModel,
      messages: [
        {
          role: 'system',
          content:
            'Ты — поддерживающий ассистент по личной эффективности. Пишешь по-русски, по делу, без канцелярита и без выдуманных фактов.',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.5,
      maxTokens: 700,
    })
  ).trim()
  if (!content) throw new Error('ИИ не вернул текст сводки. Попробуйте ещё раз.')
  const createdAt = nowIso()
  saveWeeklySummary(analytics.week_start, content)
  return { content, created_at: createdAt }
}

export async function testAiConnection(): Promise<{ ok: boolean; message: string; model: string }> {
  const config = getAiConfig()
  if (!config.apiKey) {
    return { ok: false, message: 'Ключ OpenRouter не задан.', model: config.textModel }
  }
  const answer = await chatCompletion({
    model: config.textModel,
    messages: [{ role: 'user', content: 'Ответь одним словом: работает' }],
    temperature: 0,
    maxTokens: 12,
  })
  return {
    ok: true,
    message: `Связь есть. Ответ модели: «${truncate(answer.trim(), 60)}»`,
    model: config.textModel,
  }
}
