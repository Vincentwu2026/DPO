// Downloads the MediaPipe FaceLandmarker model over HTTPS and verifies its SHA-256 before saving.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const URL_ =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'
const SHA256 = '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'python', 'models', 'face_landmarker.task')

if (existsSync(target) && !process.argv.includes('--force')) {
  console.log(`Model already present: ${target}`)
  process.exit(0)
}

const response = await fetch(URL_, { signal: AbortSignal.timeout(120_000) })
if (!response.ok) {
  console.error(`Download failed: HTTP ${response.status}`)
  process.exit(1)
}
const data = Buffer.from(await response.arrayBuffer())
const digest = createHash('sha256').update(data).digest('hex')
if (digest !== SHA256) {
  console.error(`Checksum mismatch (expected ${SHA256}, got ${digest}); not saving.`)
  process.exit(1)
}
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, data)
console.log(`Saved ${target}`)
