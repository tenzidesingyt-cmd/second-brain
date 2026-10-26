import { Router } from 'express'
import { handleTelegramUpdate, isTelegramWebhookAuthorized, type TelegramUpdate } from '../telegram'

const router = Router()

router.post('/webhook', async (req, res) => {
  if (!isTelegramWebhookAuthorized(req.get('x-telegram-bot-api-secret-token'))) {
    res.status(401).json({ ok: false })
    return
  }
  const update = req.body as TelegramUpdate
  if (!update || typeof update.update_id !== 'number') {
    res.status(400).json({ ok: false })
    return
  }
  try {
    await handleTelegramUpdate(update)
  } catch (error) {
    console.error('[telegram] update:', error instanceof Error ? error.message : error)
  }
  res.json({ ok: true })
})

export default router
