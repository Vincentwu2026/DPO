// Stand-in for python/main.py used by TrackerProcess tests. Speaks the same JSON-lines protocol.
//   --mode normal   : ready, devices, then a gaze line every 20 ms; echoes set_camera as a tracker error
//   --mode crash    : emits only "ready" and exits with code 1 (every launch)
//   --mode crash-once: crashes only when the marker file given by --marker does not exist yet
//   --mode noisy    : emits garbage/unknown lines between valid gaze lines
import { existsSync, writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const args = process.argv.slice(2)
const arg = (name) => {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}
const mode = arg('--mode') ?? 'normal'
const cameraIndex = Number(arg('--camera-index') ?? 0)
const out = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`)
const gaze = (zone = 'camera') =>
  out({ type: 'gaze', ts: Date.now() / 1000, zone, confidence: 0.9 })

if (mode === 'crash') {
  out({ type: 'ready', version: 'mock' })
  process.exit(1)
}
if (mode === 'crash-once') {
  const marker = arg('--marker')
  if (!existsSync(marker)) {
    writeFileSync(marker, '1')
    out({ type: 'ready', version: 'mock' })
    process.exit(1)
  }
}

out({ type: 'ready', version: 'mock' })
out({
  type: 'devices',
  list: [
    { index: 0, name: 'Mock Camera' },
    { index: 1, name: 'Second Cam' }
  ]
})
out({
  type: 'error',
  message: `started on camera ${cameraIndex} stability ${arg('--stability') ?? 'none'}`
})

const timer = setInterval(() => {
  if (mode === 'noisy') {
    process.stdout.write('not json\n')
    out({ type: 'gaze', ts: 'x', zone: 'camera', confidence: 0.5 })
    out({ type: 'gaze', ts: 1, zone: 'sideways', confidence: 0.5 })
    out({ type: 'unknown' })
  }
  gaze()
}, 20)

createInterface({ input: process.stdin }).on('line', (line) => {
  try {
    const cmd = JSON.parse(line)
    if (cmd.cmd === 'set_camera') out({ type: 'error', message: `camera set to ${cmd.index}` })
    if (cmd.cmd === 'set_stability')
      out({ type: 'error', message: `stability set to ${cmd.preset}` })
  } catch {
    // ignore
  }
})
process.stdin.on('end', () => {
  clearInterval(timer)
  process.exit(0)
})
process.on('SIGTERM', () => {
  clearInterval(timer)
  process.exit(0)
})
