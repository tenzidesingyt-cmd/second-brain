import { Router } from 'express'
import {
  getNotificationSettings,
  removePushSubscription,
  savePushSubscription,
  sendTestNotification,
  updateNotificationSettings,
} from '../notifications'
import { currentUserId } from '../userContext'
import type { NotificationSettingsPatch, PushSubscriptionInput } from '../../shared/types'

const router = Router()

router.get('/settings', (_req, res) => {
  res.json(getNotificationSettings(currentUserId()))
})

router.put('/settings', (req, res) => {
  try {
    const body = (req.body || {}) as NotificationSettingsPatch
    res.json(updateNotificationSettings(currentUserId(), body))
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Не удалось сохранить настройки.',
    })
  }
})

router.post('/subscriptions', (req, res) => {
  try {
    const userAgent = String(req.headers['user-agent'] || '').slice(0, 300) || null
    const count = savePushSubscription(
      currentUserId(),
      req.body as PushSubscriptionInput,
      userAgent,
    )
    res.status(201).json({ ok: true, subscriptions: count })
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Не удалось сохранить подписку.',
    })
  }
})

router.delete('/subscriptions', (req, res) => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : ''
  const count = removePushSubscription(currentUserId(), endpoint)
  res.json({ ok: true, subscriptions: count })
})

router.post('/test', async (req, res) => {
  const channel = req.body?.channel === 'telegram' ? 'telegram' : 'push'
  try {
    const result = await sendTestNotification(currentUserId(), channel)
    res.json({ ok: true, message: result.message, sent: result.sent })
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : 'Не удалось отправить уведомление.',
    })
  }
})

export default router
