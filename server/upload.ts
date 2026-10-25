import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import multer from 'multer'
import { uploadsDir } from './db'
import { registerFile } from './store'
import type { MediaFile } from '../shared/types'

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, uploadsDir),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase()
    const safeExtension = /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : ''
    callback(null, `${randomUUID()}${safeExtension}`)
  },
})

export const upload = multer({
  storage,
  limits: {
    fileSize: 200 * 1024 * 1024,
    files: 10,
  },
})

function decodeFilename(name: string): string {
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8')
    return decoded.includes('\uFFFD') ? name : decoded
  } catch {
    return name
  }
}

export function storeUploadedFiles(files: Express.Multer.File[] | undefined): MediaFile[] {
  if (!files?.length) return []
  return files.map((file) => {
    const cleanName = decodeFilename(file.originalname || 'file').slice(0, 200)
    return registerFile({
      name: cleanName || 'file',
      mime: file.mimetype || 'application/octet-stream',
      size: file.size,
      stored_name: file.filename,
    })
  })
}

export function cleanupUploadedFiles(files: Express.Multer.File[] | undefined): void {
  if (!files?.length) return
  for (const file of files) {
    try {
      fs.rmSync(file.path, { force: true })
    } catch {
      // ignore cleanup errors
    }
  }
}
