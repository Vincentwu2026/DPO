// Generates a soft alert "ping" (16-bit mono PCM WAV): 880 Hz sine + quiet octave, fast attack,
// exponential decay, low amplitude. Usage: node scripts/generate-alert-sound.mjs
// Writes only to electron/resources/sounds/ping.wav. No network access, no external input.
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../electron/resources/sounds/ping.wav'
)
const RATE = 44100
const SECONDS = 0.4
const AMPLITUDE = 0.28
const ATTACK_S = 0.006

const samples = Math.round(RATE * SECONDS)
const pcm = Buffer.alloc(samples * 2)
for (let i = 0; i < samples; i++) {
  const t = i / RATE
  const envelope = Math.min(1, t / ATTACK_S) * Math.exp(-9 * t)
  const tone = Math.sin(2 * Math.PI * 880 * t) + 0.25 * Math.sin(2 * Math.PI * 1760 * t)
  pcm.writeInt16LE(Math.round((tone / 1.25) * envelope * AMPLITUDE * 32767), i * 2)
}

const header = Buffer.alloc(44)
header.write('RIFF', 0, 'ascii')
header.writeUInt32LE(36 + pcm.length, 4)
header.write('WAVEfmt ', 8, 'ascii')
header.writeUInt32LE(16, 16) // fmt chunk size
header.writeUInt16LE(1, 20) // PCM
header.writeUInt16LE(1, 22) // mono
header.writeUInt32LE(RATE, 24)
header.writeUInt32LE(RATE * 2, 28) // byte rate
header.writeUInt16LE(2, 32) // block align
header.writeUInt16LE(16, 34) // bits per sample
header.write('data', 36, 'ascii')
header.writeUInt32LE(pcm.length, 40)

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, Buffer.concat([header, pcm]))
console.log(`Wrote ${OUT} (${header.length + pcm.length} bytes)`)
