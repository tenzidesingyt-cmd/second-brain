import fs from 'node:fs'
import { Router } from 'express'
import { getPhysicalFile } from '../store'

const router = Router()

router.get('/files/:id', (req, res) => {
  const physical = getPhysicalFile(req.params.id)
  if (!physical || !fs.existsSync(physical.absPath)) {
    res.status(404).json({ error: 'Файл не найден.' })
    return
  }
  res.setHeader('Content-Type', physical.file.mime || 'application/octet-stream')
  res.setHeader(
    'Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(physical.file.name)}`,
  )
  res.setHeader('Cache-Control', 'private, max-age=86400')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox")
  res.sendFile(physical.absPath, { acceptRanges: true }, (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({ error: 'Файл не найден.' })
    }
  })
})

export default router
