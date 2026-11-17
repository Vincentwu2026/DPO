// Generates a 16x16 placeholder tray icon (solid blue circle on transparent background).
// Usage: node scripts/generate-tray-icon.mjs
// Writes only to electron/resources/icons/tray.png. No network access, no external input.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const SIZE = 16
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../electron/resources/icons/tray.png')

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

// RGBA scanlines, each prefixed with filter byte 0.
const rows = []
for (let y = 0; y < SIZE; y++) {
  rows.push(0)
  for (let x = 0; x < SIZE; x++) {
    const inside = Math.hypot(x - 7.5, y - 7.5) <= 7
    rows.push(59, 130, 212, inside ? 255 : 0)
  }
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(SIZE, 0)
ihdr.writeUInt32BE(SIZE, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 6 // RGBA

const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(Buffer.from(rows))),
  chunk('IEND', Buffer.alloc(0))
])

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, png)
console.log(`Wrote ${OUT} (${png.length} bytes)`)
