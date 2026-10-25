import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const OUT_DIR = path.join(process.cwd(), 'public', 'icons')

const COLORS = {
  bg: [0x5d, 0x4b, 0xe0],
  spark: [0xf7, 0xf2, 0xe7],
  dot: [0xf2, 0xa0, 0x7e],
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i]
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

function encodePng(size, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1)
    raw[rowStart] = 0
    for (let x = 0; x < size; x += 1) {
      const src = (y * size + x) * 4
      const dst = rowStart + 1 + x * 4
      raw[dst] = pixels[src]
      raw[dst + 1] = pixels[src + 1]
      raw[dst + 2] = pixels[src + 2]
      raw[dst + 3] = pixels[src + 3]
    }
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function insideRoundedRect(x, y, size, radius) {
  const r = radius
  if (x < 0 || y < 0 || x > size || y > size) return false
  const cx = Math.min(Math.max(x, r), size - r)
  const cy = Math.min(Math.max(y, r), size - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

function insideSparkle(x, y, cx, cy, reach) {
  const nx = Math.abs((x - cx) / reach)
  const ny = Math.abs((y - cy) / reach)
  if (nx > 1 || ny > 1) return false
  return Math.pow(nx, 0.5) + Math.pow(ny, 0.5) <= 1
}

function renderIcon(size, { maskable = false, bleed = false } = {}) {
  const pixels = Buffer.alloc(size * size * 4)
  const samples = 4
  const scale = size / 40
  const radius = maskable || bleed ? 0 : 12.5 * scale
  const contentScale = maskable ? 0.78 : bleed ? 0.9 : 1
  const center = size / 2
  const sparkleReach = 11.4 * scale * contentScale
  const dotX = center + (30.6 - 20) * scale * contentScale
  const dotY = center + (9.7 - 20) * scale * contentScale
  const dotR = 3.1 * scale * contentScale

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      let hits = 0
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + (sx + 0.5) / samples
          const py = y + (sy + 0.5) / samples
          if (!insideRoundedRect(px, py, size, radius)) continue
          hits += 1
          let color = COLORS.bg
          const dx = px - dotX
          const dy = py - dotY
          if (dx * dx + dy * dy <= dotR * dotR) {
            color = COLORS.dot
          } else if (insideSparkle(px, py, center, center, sparkleReach)) {
            color = COLORS.spark
          }
          r += color[0]
          g += color[1]
          b += color[2]
        }
      }
      const idx = (y * size + x) * 4
      if (!hits) {
        pixels[idx] = 0
        pixels[idx + 1] = 0
        pixels[idx + 2] = 0
        pixels[idx + 3] = 0
        continue
      }
      const coverage = hits / (samples * samples)
      pixels[idx] = Math.round(r / hits)
      pixels[idx + 1] = Math.round(g / hits)
      pixels[idx + 2] = Math.round(b / hits)
      pixels[idx + 3] = Math.round(255 * coverage)
    }
  }
  return encodePng(size, pixels)
}

fs.mkdirSync(OUT_DIR, { recursive: true })

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-512-maskable.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false, bleed: true },
]

for (const target of targets) {
  const png = renderIcon(target.size, { maskable: target.maskable, bleed: target.bleed })
  fs.writeFileSync(path.join(OUT_DIR, target.file), png)
  console.log(`${target.file} — ${target.size}x${target.size}, ${png.length} bytes`)
}
