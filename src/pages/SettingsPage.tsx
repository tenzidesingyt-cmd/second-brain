import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpRight,
  BellRing,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  Download,
  Eye,
  EyeOff,
  HardDrive,
  Info,
  KeyRound,
  Loader2,
  LogOut,
  Moon,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Sun,
  Trash2,
  Users,
  Wifi,
} from 'lucide-react'
import {
  DEFAULT_MODELS,
  type AISettingsInfo,
  type NotificationSettingsPatch,
} from '../../shared/types'
import { api } from '../lib/api'
import { qk, useAiSettings } from '../lib/hooks'
import {
  currentPushEndpoint,
  isStandalone,
  notificationPermission,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  useInstallPrompt,
} from '../lib/pwa'
import { useDocumentTitle } from '../hooks/useDocumentTitle'
import { todayIso } from '../lib/date'
import { useTheme } from '../context/ThemeContext'
import { useToast } from '../context/ToastContext'
import { useConfirm } from '../context/ConfirmContext'
import { Badge, PageHeader, Toggle } from '../components/ui'

interface TestResult {
  ok: boolean
  message: string
  model: string
}

const MODEL_OPTIONS = [
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
  'openai/gpt-4o-mini',
  'openai/gpt-4o',
  'anthropic/claude-sonnet-4',
]

const STT_OPTIONS = ['openai/whisper-1', 'openai/gpt-4o-mini-transcribe', 'openai/gpt-4o-transcribe']

async function copyToClipboard(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return true
    }
  } catch {
    // fall back to the legacy path
  }
  try {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const copied = document.execCommand('copy')
    area.remove()
    return copied
  } catch {
    return false
  }
}

export function SettingsPage() {
  useDocumentTitle('Настройки')
  const queryClient = useQueryClient()
  const { showToast } = useToast()
  const confirm = useConfirm()
  const { theme, setTheme } = useTheme()
  const aiSettings = useAiSettings()
  const install = useInstallPrompt()

  const authQuery = useQuery({
    queryKey: qk.auth,
    queryFn: () => api.auth.me(),
    retry: false,
    staleTime: 60_000,
  })

  const currentUser = authQuery.data?.user ?? null
  const isOwner = currentUser?.role === 'owner'
  const telegramEnabled = Boolean(authQuery.data?.telegram_enabled)
  const botUsername = authQuery.data?.telegram_bot_username?.replace(/^@/, '') || ''
  const usersQuery = useQuery({
    queryKey: qk.authUsers,
    queryFn: () => api.auth.users(),
    enabled: isOwner,
    staleTime: 60_000,
  })

  const [apiKey, setApiKey] = useState('')
  const [textModel, setTextModel] = useState('')
  const [visionModel, setVisionModel] = useState('')
  const [sttModel, setSttModel] = useState('')
  const [formInitialized, setFormInitialized] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const configured = Boolean(aiSettings.data?.configured)
  const source = aiSettings.data?.source
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const standalone = isStandalone()
  const isIos =
    typeof navigator !== 'undefined' &&
    (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1))

  const notificationsQuery = useQuery({
    queryKey: qk.notifications,
    queryFn: () => api.notifications.settings(),
    staleTime: 30_000,
  })
  const notifications = notificationsQuery.data
  const detectedTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    [],
  )
  const [notificationTimezone, setNotificationTimezone] = useState('')
  const [timezoneInitialized, setTimezoneInitialized] = useState(false)
  const [pushOnDevice, setPushOnDevice] = useState(false)
  const [pushBusy, setPushBusy] = useState(false)
  const [testingChannel, setTestingChannel] = useState<'push' | 'telegram' | null>(null)

  const timezoneOptions = useMemo(() => {
    let list: string[] = []
    try {
      list = Intl.supportedValuesOf('timeZone')
    } catch {
      list = ['UTC']
    }
    if (notificationTimezone && !list.includes(notificationTimezone)) {
      list = [notificationTimezone, ...list]
    }
    if (!list.includes('UTC')) list = [...list, 'UTC']
    return list
  }, [notificationTimezone])

  useEffect(() => {
    if (!notifications || timezoneInitialized) return
    setNotificationTimezone(notifications.timezone || detectedTimezone)
    setTimezoneInitialized(true)
  }, [notifications, timezoneInitialized, detectedTimezone])

  useEffect(() => {
    if (!notifications || !pushSupported()) return
    let cancelled = false
    void currentPushEndpoint()
      .then((endpoint) => {
        if (!cancelled) setPushOnDevice(Boolean(endpoint))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [notifications])

  const saveNotificationsMutation = useMutation({
    mutationFn: (patch: NotificationSettingsPatch) => api.notifications.saveSettings(patch),
    onSuccess: (info) => {
      queryClient.setQueryData(qk.notifications, info)
    },
    onError: (error) => {
      if (notifications) setNotificationTimezone(notifications.timezone || detectedTimezone)
      showToast(
        error instanceof Error ? error.message : 'Не удалось сохранить настройки уведомлений.',
        'error',
      )
    },
  })

  const saveNotificationPatch = (patch: NotificationSettingsPatch) => {
    saveNotificationsMutation.mutate({
      timezone: notificationTimezone || detectedTimezone,
      ...patch,
    })
  }

  const handleConnectPush = async () => {
    if (!notifications || pushBusy) return
    setPushBusy(true)
    try {
      const publicKey = notifications.push_public_key
      if (!publicKey) throw new Error('Сервер не выдал ключ push-уведомлений.')
      const subscription = await subscribeToPush(publicKey)
      await api.notifications.subscribe(subscription)
      const info = await api.notifications.saveSettings({
        push_enabled: true,
        timezone: notificationTimezone || detectedTimezone,
      })
      queryClient.setQueryData(qk.notifications, info)
      setPushOnDevice(true)
      showToast('Push-уведомления включены на этом устройстве.', 'success')
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Не удалось включить push-уведомления.',
        'error',
      )
    } finally {
      setPushBusy(false)
    }
  }

  const handleDisconnectPush = async () => {
    if (pushBusy) return
    setPushBusy(true)
    try {
      const endpoint = await unsubscribeFromPush()
      if (endpoint) {
        const result = await api.notifications.unsubscribe(endpoint)
        const info = await api.notifications.saveSettings({
          push_enabled: result.subscriptions > 0,
          timezone: notificationTimezone || detectedTimezone,
        })
        queryClient.setQueryData(qk.notifications, info)
      }
      setPushOnDevice(false)
      showToast('Push-уведомления отключены на этом устройстве.', 'success')
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Не удалось отключить push-уведомления.',
        'error',
      )
    } finally {
      setPushBusy(false)
    }
  }

  const handleTestNotification = async (channel: 'push' | 'telegram') => {
    if (testingChannel) return
    setTestingChannel(channel)
    try {
      const result = await api.notifications.test(channel)
      showToast(result.message, 'success')
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Не удалось отправить уведомление.',
        'error',
      )
    } finally {
      setTestingChannel(null)
    }
  }

  const notificationsAvailable = pushSupported()
  const pushPermission = notificationsAvailable ? notificationPermission() : 'unsupported'
  const pushSubscriptions = notifications?.push_subscriptions ?? 0
  const notificationsActive =
    (Boolean(notifications?.push_enabled) && pushSubscriptions > 0) ||
    Boolean(notifications?.telegram_enabled)
  const pushStatus = !notificationsAvailable
    ? 'Этот браузер не поддерживает push-уведомления.'
    : pushOnDevice
      ? `Подключено на этом устройстве${pushSubscriptions > 1 ? ` · всего ${pushSubscriptions}` : ''}`
      : pushPermission === 'denied'
        ? 'Уведомления заблокированы в настройках браузера.'
        : pushSubscriptions > 0
          ? `Не подключено здесь · всего устройств: ${pushSubscriptions}`
          : 'Не подключено на этом устройстве.'
  const telegramReady = Boolean(notifications?.telegram_available)
  const telegramLinked = Boolean(notifications?.telegram_linked)
  const telegramStatus = !telegramReady
    ? 'Telegram-бот не настроен на сервере.'
    : telegramLinked
      ? `Кабинет привязан${notifications?.telegram_username ? ` · @${notifications.telegram_username}` : ''}`
      : isOwner
        ? 'Отправьте боту /owner <пароль кабинета>, чтобы привязать Telegram.'
        : 'Напишите боту /start, чтобы получить кабинет с Telegram.'

  useEffect(() => {
    const info = aiSettings.data
    if (!info || formInitialized) return
    setTextModel(info.text_model)
    setVisionModel(info.vision_model)
    setSttModel(info.stt_model)
    setFormInitialized(true)
  }, [aiSettings.data, formInitialized])

  const applyInfo = (info: AISettingsInfo) => {
    queryClient.setQueryData(qk.aiSettings, info)
    setTextModel(info.text_model)
    setVisionModel(info.vision_model)
    setSttModel(info.stt_model)
    setFormInitialized(true)
  }

  const saveMutation = useMutation({
    mutationFn: () =>
      api.ai.saveSettings({
        apiKey: apiKey.trim() || undefined,
        textModel: textModel.trim() || undefined,
        visionModel: visionModel.trim() || undefined,
        sttModel: sttModel.trim() || undefined,
      }),
    onSuccess: (info) => {
      applyInfo(info)
      setApiKey('')
      setShowKey(false)
      setTestResult(null)
      showToast('Настройки ИИ сохранены.', 'success')
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : 'Не удалось сохранить настройки.', 'error')
    },
  })

  const clearMutation = useMutation({
    mutationFn: () => api.ai.saveSettings({ clearKey: true }),
    onSuccess: (info) => {
      applyInfo(info)
      setTestResult(null)
      showToast('Ключ удалён. ИИ-функции выключены.', 'success')
    },
    onError: (error) => {
      showToast(error instanceof Error ? error.message : 'Не удалось удалить ключ.', 'error')
    },
  })

  const testMutation = useMutation({
    mutationFn: () => api.ai.test(),
    onSuccess: (result) => {
      setTestResult(result)
      showToast(result.ok ? 'ИИ отвечает — всё готово.' : result.message, result.ok ? 'success' : 'error')
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : 'Не удалось проверить связь.'
      setTestResult({ ok: false, message, model: aiSettings.data?.text_model || '' })
      showToast(message, 'error')
    },
  })

  const submitAi = (event: FormEvent) => {
    event.preventDefault()
    if (saveMutation.isPending) return
    saveMutation.mutate()
  }

  const resetModels = () => {
    setTextModel(DEFAULT_MODELS.text)
    setVisionModel(DEFAULT_MODELS.vision)
    setSttModel(DEFAULT_MODELS.stt)
    setTestResult(null)
    showToast('Стандартные модели подставлены. Сохрани настройки.', 'info')
  }

  const handleClearKey = async () => {
    const confirmed = await confirm({
      title: 'Убрать ключ OpenRouter?',
      description:
        'ИИ-разбор инбокса, голосовые расшифровки, семантический поиск и итоги недели перестанут работать, пока не добавишь ключ снова.',
      confirmLabel: 'Убрать ключ',
      danger: true,
    })
    if (confirmed) clearMutation.mutate()
  }

  const copyAddress = async () => {
    const ok = await copyToClipboard(origin)
    if (!ok) {
      showToast('Не удалось скопировать. Выдели адрес вручную.', 'error')
      return
    }
    setCopied(true)
    showToast('Адрес скопирован.', 'success')
    window.setTimeout(() => setCopied(false), 1600)
  }

  const handleInstall = async () => {
    const accepted = await install.promptInstall()
    showToast(
      accepted ? 'Приложение установлено.' : 'Установку можно повторить позже.',
      accepted ? 'success' : 'info',
    )
  }

  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    try {
      const blob = await api.exportData()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `second-brain-${todayIso()}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      showToast('Резервная копия скачана.', 'success')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось экспортировать данные.', 'error')
    } finally {
      setExporting(false)
    }
  }

  const handleLogout = async () => {
    const confirmed = await confirm({
      title: 'Выйти из приложения?',
      description: 'На этом устройстве снова потребуется пароль. Данные останутся на месте.',
      confirmLabel: 'Выйти',
      danger: true,
    })
    if (!confirmed) return
    setLoggingOut(true)
    try {
      await api.auth.logout()
      window.location.reload()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось выйти.', 'error')
      setLoggingOut(false)
    }
  }

  const authPending = authQuery.isPending
  const authRequired = Boolean(authQuery.data?.auth_required)
  const loggedIn = Boolean(authQuery.data?.authenticated)
  const googleEnabled = Boolean(authQuery.data?.google_enabled)
  const passwordEnabled = Boolean(authQuery.data?.password_enabled)

  return (
    <div className="settings-page">
      <PageHeader
        eyebrow="Твой кабинет"
        title="Настройки"
        description="Подключи ИИ, выбери оформление и открой доступ с телефона. Всё остальное уже работает."
        actions={
          <span className={`ai-status-pill ${configured ? 'is-ready' : ''}`}>
            <Sparkles size={14} />
            <span>{configured ? 'ИИ подключён' : 'ИИ не подключён'}</span>
          </span>
        }
      />

      <div className="settings-layout">
        <div className="settings-main">
          <section className="settings-card ai-settings-card">
            <div className="settings-card-head">
              <span className="settings-orb">
                <Sparkles size={18} />
              </span>
              <div className="settings-card-head-copy">
                <h2>Искусственный интеллект</h2>
                <p>
                  OpenRouter разбирает записи инбокса, расшифровывает голос, ищет по смыслу и
                  собирает итоги недели.
                </p>
              </div>
              <Badge tone={configured ? 'green' : 'amber'} dot>
                {configured ? 'Активен' : 'Нужен ключ'}
              </Badge>
            </div>

            {!isOwner ? (
              <div className="ai-readonly">
                <div className="ai-key-status">
                  <KeyRound size={15} />
                  {configured ? (
                    <span>
                      ИИ подключён, ключ <strong>{aiSettings.data?.key_hint}</strong>
                    </span>
                  ) : (
                    <span>ИИ не подключён — остальные функции работают как обычно.</span>
                  )}
                </div>
                <div className="settings-about-list">
                  <div className="settings-about-row">
                    <span>Текстовая модель</span>
                    <strong>{aiSettings.data?.text_model || '—'}</strong>
                  </div>
                  <div className="settings-about-row">
                    <span>Модель для фото</span>
                    <strong>{aiSettings.data?.vision_model || '—'}</strong>
                  </div>
                  <div className="settings-about-row">
                    <span>Расшифровка голоса</span>
                    <strong>{aiSettings.data?.stt_model || '—'}</strong>
                  </div>
                </div>
                <p className="settings-footnote">
                  Ключ и модели ИИ настраивает владелец кабинета.
                </p>
              </div>
            ) : (
            <form className="ai-settings-form" onSubmit={submitAi}>
              <div className="ai-key-block">
                <div className="ai-key-status">
                  <KeyRound size={15} />
                  {configured ? (
                    <span>
                      Ключ подключён <strong>{aiSettings.data?.key_hint}</strong>{' '}
                      {source === 'env' ? '· из .env' : '· хранится в приложении'}
                    </span>
                  ) : (
                    <span>Ключа пока нет — ИИ-функции выключены, всё остальное работает.</span>
                  )}
                </div>
                <div className="ai-key-row">
                  <input
                    className="input mono ai-key-input"
                    type={showKey ? 'text' : 'password'}
                    value={apiKey}
                    onChange={(event) => setApiKey(event.target.value)}
                    placeholder={
                      configured ? 'Новый ключ, чтобы заменить текущий' : 'sk-or-v1-…'
                    }
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Ключ OpenRouter"
                  />
                  <button
                    type="button"
                    className="icon-btn ai-key-reveal"
                    onClick={() => setShowKey((value) => !value)}
                    aria-label={showKey ? 'Скрыть ключ' : 'Показать ключ'}
                  >
                    {showKey ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
                <div className="ai-key-actions">
                  <a
                    className="text-link"
                    href="https://openrouter.ai/keys"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Получить ключ на OpenRouter
                    <ArrowUpRight size={13} />
                  </a>
                  {configured && source !== 'env' && (
                    <button
                      type="button"
                      className="ai-key-clear"
                      onClick={handleClearKey}
                      disabled={clearMutation.isPending}
                    >
                      {clearMutation.isPending ? (
                        <Loader2 size={13} className="spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
                      Убрать ключ
                    </button>
                  )}
                </div>
              </div>

              {source === 'env' && (
                <div className="inline-note is-warning">
                  <Info size={15} />
                  <span>
                    Ключ задан в <code>.env</code> и имеет приоритет. Чтобы менять его здесь,
                    удали <code>OPENROUTER_API_KEY</code> из файла и перезапусти сервер.
                  </span>
                </div>
              )}

              <div className="ai-model-grid">
                <label className="field">
                  <span className="field-label">Текстовая модель</span>
                  <input
                    className="input mono"
                    value={textModel}
                    onChange={(event) => setTextModel(event.target.value)}
                    placeholder={DEFAULT_MODELS.text}
                    list="ai-model-options"
                    spellCheck={false}
                  />
                  <span className="field-hint">Разбор записей и итоги недели</span>
                </label>
                <label className="field">
                  <span className="field-label">Модель для фото</span>
                  <input
                    className="input mono"
                    value={visionModel}
                    onChange={(event) => setVisionModel(event.target.value)}
                    placeholder={DEFAULT_MODELS.vision}
                    list="ai-model-options"
                    spellCheck={false}
                  />
                  <span className="field-hint">Фото доски, скриншоты, документы</span>
                </label>
                <label className="field">
                  <span className="field-label">Расшифровка голоса</span>
                  <input
                    className="input mono"
                    value={sttModel}
                    onChange={(event) => setSttModel(event.target.value)}
                    placeholder={DEFAULT_MODELS.stt}
                    list="ai-stt-options"
                    spellCheck={false}
                  />
                  <span className="field-hint">Голосовые записи из инбокса</span>
                </label>
              </div>

              <datalist id="ai-model-options">
                {MODEL_OPTIONS.map((model) => (
                  <option value={model} key={model} />
                ))}
              </datalist>
              <datalist id="ai-stt-options">
                {STT_OPTIONS.map((model) => (
                  <option value={model} key={model} />
                ))}
              </datalist>

              <div className="ai-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Check size={16} />
                  )}
                  Сохранить
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => testMutation.mutate()}
                  disabled={!configured || testMutation.isPending || saveMutation.isPending}
                >
                  {testMutation.isPending ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Wifi size={16} />
                  )}
                  Проверить связь
                </button>
                <button type="button" className="btn btn-text ai-reset-models" onClick={resetModels}>
                  Стандартные модели
                </button>
              </div>

              {testResult && (
                <div className={`ai-test-result ${testResult.ok ? 'is-ok' : 'is-error'}`}>
                  {testResult.ok ? <CheckCircle2 size={15} /> : <Info size={15} />}
                  <span>{testResult.message}</span>
                </div>
              )}

              <p className="settings-footnote">
                Ключ хранится в базе приложения и не попадает в экспорт. Запросы идут напрямую в
                OpenRouter.
              </p>
            </form>
            )}
          </section>

          <section className="settings-card notifications-settings-card">
            <div className="settings-card-head">
              <span className="settings-orb is-green">
                <BellRing size={18} />
              </span>
              <div className="settings-card-head-copy">
                <h2>Уведомления</h2>
                <p>
                  Напоминания о задачах и событиях за день и в нужный момент — в браузере и
                  Telegram.
                </p>
              </div>
              <Badge tone={notificationsActive ? 'green' : 'amber'} dot>
                {notificationsActive ? 'Включены' : 'Выключены'}
              </Badge>
            </div>

            {notificationsQuery.isPending ? (
              <div className="settings-state">
                <Loader2 size={16} className="spin" />
                Загружаю настройки уведомлений…
              </div>
            ) : notificationsQuery.isError || !notifications ? (
              <div className="settings-state is-error">
                <Info size={16} />
                Не удалось загрузить настройки уведомлений.
              </div>
            ) : (
              <>
                <div className="notification-channel">
                  <span className="settings-action-icon tone-blue">
                    <BellRing size={17} />
                  </span>
                  <span className="settings-action-copy">
                    <strong>Push в браузере</strong>
                    <span>{pushStatus}</span>
                  </span>
                  {pushOnDevice ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-small"
                      onClick={handleDisconnectPush}
                      disabled={pushBusy}
                    >
                      {pushBusy ? (
                        <Loader2 size={14} className="spin" />
                      ) : (
                        <BellRing size={14} />
                      )}
                      Отключить
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-soft btn-small"
                      onClick={handleConnectPush}
                      disabled={
                        pushBusy || !notificationsAvailable || pushPermission === 'denied'
                      }
                    >
                      {pushBusy ? (
                        <Loader2 size={14} className="spin" />
                      ) : (
                        <BellRing size={14} />
                      )}
                      Подключить
                    </button>
                  )}
                </div>

                {isIos && !standalone && (
                  <div className="inline-note is-warning">
                    <Info size={15} />
                    <span>
                      На iPhone push работают после добавления приложения на экран «Домой» (iOS
                      16.4+).
                    </span>
                  </div>
                )}

                <div className="notification-channel">
                  <span className="settings-action-icon tone-blue">
                    <Send size={17} />
                  </span>
                  <span className="settings-action-copy">
                    <strong>Telegram</strong>
                    <span>{telegramStatus}</span>
                  </span>
                  {telegramLinked && telegramReady ? (
                    <Toggle
                      checked={Boolean(notifications.telegram_enabled)}
                      disabled={saveNotificationsMutation.isPending}
                      onChange={(checked) => saveNotificationPatch({ telegram_enabled: checked })}
                    />
                  ) : botUsername ? (
                    <a
                      className="btn btn-ghost btn-small"
                      href={`https://t.me/${botUsername}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <Send size={14} />
                      Открыть бота
                    </a>
                  ) : null}
                </div>

                <div className="notification-schedule">
                  <div className="notification-schedule-row">
                    <span className="notification-schedule-copy">
                      <strong>За день до</strong>
                      <small>В 09:00 по выбранному часовому поясу</small>
                    </span>
                    <Toggle
                      checked={notifications.day_before}
                      disabled={saveNotificationsMutation.isPending}
                      onChange={(checked) => saveNotificationPatch({ day_before: checked })}
                    />
                  </div>
                  <div className="notification-schedule-row">
                    <span className="notification-schedule-copy">
                      <strong>В момент времени</strong>
                      <small>Когда наступает время задачи или события</small>
                    </span>
                    <Toggle
                      checked={notifications.at_time}
                      disabled={saveNotificationsMutation.isPending}
                      onChange={(checked) => saveNotificationPatch({ at_time: checked })}
                    />
                  </div>
                  <label className="field notification-timezone-field">
                    <span className="field-label">Часовой пояс напоминаний</span>
                    <select
                      className="input"
                      value={notificationTimezone || detectedTimezone}
                      onChange={(event) => {
                        const value = event.target.value
                        setNotificationTimezone(value)
                        saveNotificationsMutation.mutate({ timezone: value })
                      }}
                      disabled={saveNotificationsMutation.isPending}
                    >
                      {timezoneOptions.map((timezone) => (
                        <option value={timezone} key={timezone}>
                          {timezone}
                        </option>
                      ))}
                    </select>
                    <span className="field-hint">
                      В нём считаются «09:00» и время задач. Сейчас:{' '}
                      {notificationTimezone || detectedTimezone}.
                    </span>
                  </label>
                </div>

                <div className="notification-test-row">
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => handleTestNotification('push')}
                    disabled={!pushOnDevice || testingChannel !== null}
                  >
                    {testingChannel === 'push' ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <BellRing size={14} />
                    )}
                    Проверить push
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-small"
                    onClick={() => handleTestNotification('telegram')}
                    disabled={!telegramLinked || !telegramReady || testingChannel !== null}
                  >
                    {testingChannel === 'telegram' ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <Clock3 size={14} />
                    )}
                    Проверить Telegram
                  </button>
                </div>
              </>
            )}

            <p className="settings-footnote">
              Push приходит в браузер и установленное приложение. Telegram-сообщения отправляет
              бот. Напоминания приходят за день в 09:00 и в момент времени по выбранному поясу.
            </p>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-orb is-coral">
                <Sun size={18} />
              </span>
              <div className="settings-card-head-copy">
                <h2>Оформление</h2>
                <p>Светлая бумага днём, тёмный кабинет вечером. Выбор сохраняется на устройстве.</p>
              </div>
            </div>

            <div className="theme-options">
              <button
                type="button"
                className={`theme-option ${theme === 'light' ? 'is-active' : ''}`}
                onClick={() => setTheme('light')}
                aria-pressed={theme === 'light'}
              >
                <span className="theme-preview is-light">
                  <span className="theme-preview-side" />
                  <span className="theme-preview-lines">
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
                <span className="theme-option-copy">
                  <strong>Светлая</strong>
                  <small>Тёплая бумага</small>
                </span>
                {theme === 'light' && <Check size={15} className="theme-option-check" />}
              </button>
              <button
                type="button"
                className={`theme-option ${theme === 'dark' ? 'is-active' : ''}`}
                onClick={() => setTheme('dark')}
                aria-pressed={theme === 'dark'}
              >
                <span className="theme-preview is-dark">
                  <span className="theme-preview-side" />
                  <span className="theme-preview-lines">
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
                <span className="theme-option-copy">
                  <strong>Тёмная</strong>
                  <small>Мягкий полумрак</small>
                </span>
                {theme === 'dark' && <Check size={15} className="theme-option-check" />}
              </button>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-orb is-blue">
                <HardDrive size={18} />
              </span>
              <div className="settings-card-head-copy">
                <h2>Данные</h2>
                <p>Всё хранится локально. Снимок данных можно забрать с собой в любой момент.</p>
              </div>
            </div>

            <div className="settings-action">
              <span className="settings-action-icon tone-blue">
                <Download size={17} />
              </span>
              <span className="settings-action-copy">
                <strong>Резервная копия в JSON</strong>
                <span>Заметки, задачи, привычки, события, инбокс и вложения.</span>
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-small"
                onClick={handleExport}
                disabled={exporting}
              >
                {exporting ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Download size={14} />
                )}
                Скачать
              </button>
            </div>

            <p className="settings-footnote">
              Файл не содержит ключ OpenRouter и пароль. Это снимок данных — вложения в нём
              указаны ссылками, поэтому для полной копии сохрани ещё папку <code>data</code>.
            </p>
          </section>

          {isOwner && (
            <section className="settings-card">
              <div className="settings-card-head">
                <span className="settings-orb is-blue">
                  <Users size={18} />
                </span>
                <div className="settings-card-head-copy">
                  <h2>Пользователи</h2>
                  <p>
                    Кабинеты, созданные через Telegram-бота. Заметки, задачи и файлы каждого
                    пользователя изолированы.
                  </p>
                </div>
                <Badge tone="blue">{usersQuery.data?.length ?? 0}</Badge>
              </div>

              {usersQuery.isPending ? (
                <div className="settings-state">
                  <Loader2 size={16} className="spin" />
                  Загружаю пользователей…
                </div>
              ) : usersQuery.isError ? (
                <div className="settings-state is-error">
                  <Info size={16} />
                  Не удалось загрузить список.
                </div>
              ) : (
                <ul className="settings-user-list">
                  {usersQuery.data?.map((user) => (
                    <li className="settings-user-row" key={user.id}>
                      <span className="settings-user-avatar">
                        {(user.name || user.login).slice(0, 1).toUpperCase()}
                      </span>
                      <span className="settings-user-copy">
                        <strong>
                          {user.name || user.login}
                          {user.id === currentUser?.id && <em>это вы</em>}
                        </strong>
                        <span>
                          Логин: {user.login}
                          {user.telegram_username ? ` · Telegram @${user.telegram_username}` : ''}
                          {' · '}
                          {new Date(user.created_at).toLocaleDateString('ru-RU', {
                            day: 'numeric',
                            month: 'short',
                            year: 'numeric',
                          })}
                        </span>
                      </span>
                      <Badge tone={user.role === 'owner' ? 'green' : 'neutral'}>
                        {user.role === 'owner' ? 'владелец' : 'пользователь'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}

              <p className="settings-footnote">
                Новый кабинет создаётся автоматически, когда человек пишет боту{' '}
                <code>/start</code>. Пароль можно сбросить командой <code>/password</code>.
              </p>
            </section>
          )}
        </div>

        <aside className="settings-aside">
          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-orb is-green">
                <Smartphone size={18} />
              </span>
              <div className="settings-card-head-copy">
                <h2>С телефона</h2>
                <p>Открой приложение рядом с компьютером и добавь его на главный экран.</p>
              </div>
            </div>

            <div className="device-address">
              <Wifi size={15} />
              <code>{origin}</code>
              <button
                type="button"
                className="device-copy"
                onClick={copyAddress}
                aria-label="Скопировать адрес"
                title="Скопировать адрес"
              >
                {copied ? <Check size={15} /> : <Copy size={15} />}
              </button>
            </div>

            <ol className="device-steps">
              <li>
                <span className="device-step-num">1</span>
                <span>Подключи телефон к той же Wi-Fi сети, что и компьютер.</span>
              </li>
              <li>
                <span className="device-step-num">2</span>
                <span>Открой этот адрес в браузере телефона.</span>
              </li>
              <li>
                <span className="device-step-num">3</span>
                <span>
                  {isIos
                    ? 'Нажми «Поделиться» → «На экран „Домой“».'
                    : 'Открой меню браузера и выбери «Установить приложение».'}
                </span>
              </li>
            </ol>

            {standalone ? (
              <div className="settings-state is-ready">
                <CheckCircle2 size={16} />
                Приложение открыто как установленное
              </div>
            ) : install.available ? (
              <button
                type="button"
                className="btn btn-soft btn-block settings-install-btn"
                onClick={handleInstall}
              >
                <Download size={16} />
                Установить приложение
              </button>
            ) : (
              <div className="settings-install-hint">
                <Download size={15} />
                <span>
                  Кнопка установки появится в Chrome или Edge, когда приложение открыто по HTTPS
                  или на localhost.
                </span>
              </div>
            )}

            <div className="inline-note is-warning">
              <ShieldCheck size={15} />
              <span>
                Микрофон и установка как приложение требуют <b>HTTPS</b> или <b>localhost</b>. По
                локальному HTTP фото и файлы работают, а голос можно прикрепить записью с
                диктофона.
              </span>
            </div>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-orb is-neutral">
                <ShieldCheck size={18} />
              </span>
              <div className="settings-card-head-copy">
                <h2>Доступ</h2>
                <p>Аккаунты, способы входа и защита кабинета.</p>
              </div>
            </div>

            {loggedIn && currentUser && (
              <div className="settings-account">
                <span className="settings-account-avatar">
                  {(currentUser.name || currentUser.login).slice(0, 1).toUpperCase()}
                </span>
                <span className="settings-account-copy">
                  <strong>
                    {currentUser.name || currentUser.login}
                    <em>{currentUser.role === 'owner' ? 'владелец' : 'пользователь'}</em>
                  </strong>
                  <span>
                    Логин: {currentUser.login}
                    {currentUser.telegram_username ? ` · Telegram @${currentUser.telegram_username}` : ''}
                  </span>
                </span>
              </div>
            )}

            {telegramEnabled && botUsername && (
              <a
                className="btn btn-soft btn-small btn-block settings-bot-btn"
                href={`https://t.me/${botUsername}`}
                target="_blank"
                rel="noreferrer"
              >
                <Send size={14} />
                Открыть бота @{botUsername}
              </a>
            )}

            {authPending ? (
              <div className="settings-access-row">
                <span className="settings-access-icon is-open">
                  <Loader2 size={16} className="spin" />
                </span>
                <div className="settings-access-copy">
                  <strong>Проверяю доступ…</strong>
                  <span>Секунду.</span>
                </div>
              </div>
            ) : (
              <div className="settings-access-row">
                <span className={`settings-access-icon ${authRequired ? 'is-locked' : 'is-open'}`}>
                  {authRequired ? <ShieldCheck size={16} /> : <Info size={16} />}
                </span>
                <div className="settings-access-copy">
                  <strong>
                    {telegramEnabled
                      ? 'Вход через Telegram-бота'
                      : googleEnabled
                        ? passwordEnabled
                          ? 'Google и пароль включены'
                          : 'Вход через Google включён'
                        : authRequired
                          ? 'Вход по паролю включён'
                          : 'Открытый доступ'}
                  </strong>
                  <span>
                    {telegramEnabled
                      ? 'Логин и пароль выдаёт бот. Команда /password сбрасывает пароль, если он потерялся.'
                      : googleEnabled
                        ? passwordEnabled
                          ? 'Основной вход — через Google, пароль работает как резервный. Выйти можно на каждом устройстве отдельно.'
                          : 'Доступ только для Google-аккаунта владельца кабинета. Выйти можно на каждом устройстве отдельно.'
                        : authRequired
                          ? 'Сессия хранится в защищённой cookie. Выйти можно на каждом устройстве отдельно.'
                          : 'Любое устройство в этой сети может открыть приложение без пароля.'}
                  </span>
                </div>
              </div>
            )}

            {authRequired && loggedIn && (
              <button
                type="button"
                className="btn btn-ghost btn-small settings-logout"
                onClick={handleLogout}
                disabled={loggingOut}
              >
                {loggingOut ? <Loader2 size={14} className="spin" /> : <LogOut size={14} />}
                Выйти на этом устройстве
              </button>
            )}

            <p className="settings-footnote">
              {telegramEnabled ? (
                <>
                  Бот работает через <code>TELEGRAM_BOT_TOKEN</code>. Новые кабинеты создаются
                  автоматически; ограничить доступ можно списком <code>TELEGRAM_ALLOWED_IDS</code>.
                </>
              ) : googleEnabled ? (
                <>
                  Google-вход задаётся переменными <code>GOOGLE_CLIENT_ID</code>,{' '}
                  <code>GOOGLE_CLIENT_SECRET</code> и <code>OWNER_EMAIL</code>.
                </>
              ) : (
                <>
                  Пароль задаётся переменной <code>APP_PASSWORD</code> в <code>.env</code>.
                </>
              )}{' '}
              После изменения перезапусти сервер.
            </p>
          </section>

          <section className="settings-card">
            <div className="settings-card-head">
              <span className="settings-orb is-neutral">
                <Sparkles size={18} />
              </span>
              <div className="settings-card-head-copy">
                <h2>О приложении</h2>
                <p>Личный кабинет для мыслей, планов и всего важного.</p>
              </div>
            </div>

            <div className="settings-about-list">
              <div className="settings-about-row">
                <span>Версия</span>
                <strong>1.0</strong>
              </div>
              <div className="settings-about-row">
                <span>Хранилище</span>
                <strong>SQLite · локально</strong>
              </div>
              <div className="settings-about-row">
                <span>Синхронизация</span>
                <strong>WebSocket</strong>
              </div>
            </div>

            <p className="settings-footnote">
              Данные и вложения остаются на твоём компьютере. В интернет уходят только запросы к
              OpenRouter, когда работает ИИ.
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
