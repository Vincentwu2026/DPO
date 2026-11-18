import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { GazeEvent, TrackerDevice, TrackerError } from '../tracker/protocol'
import { defaultSpawn, TrackerProcess } from '../tracker/TrackerProcess'

const MOCK = join(__dirname, 'fixtures', 'mock-tracker.mjs')

function launch(...extra: string[]) {
  return { command: process.execPath, args: [MOCK, ...extra] }
}

function waitFor<T>(
  emitter: TrackerProcess,
  event: string,
  predicate: (value: T) => boolean = () => true,
  timeoutMs = 8_000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs)
    const handler = (value: T): void => {
      if (!predicate(value)) return
      clearTimeout(timer)
      emitter.off(event, handler)
      resolve(value)
    }
    emitter.on(event, handler)
  })
}

describe('TrackerProcess (integration with a mock tracker process)', () => {
  const created: TrackerProcess[] = []
  const tempDirs: string[] = []

  function make(extra: string[] = [], options: { maxRestarts?: number } = {}): TrackerProcess {
    const t = new TrackerProcess({
      launch: launch(...extra),
      restartBaseDelayMs: 10,
      stopTimeoutMs: 2_000,
      ...options
    })
    created.push(t)
    return t
  }

  afterEach(async () => {
    await Promise.all(created.splice(0).map((t) => t.stop()))
    for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('emits typed gaze events and the device list', async () => {
    const tracker = make()
    const devices = waitFor<TrackerDevice[]>(tracker, 'devices')
    const gaze = waitFor<GazeEvent>(tracker, 'gaze')
    tracker.start(0)

    expect(await devices).toEqual([
      { index: 0, name: 'Mock Camera' },
      { index: 1, name: 'Second Cam' }
    ])
    expect(await gaze).toMatchObject({ zone: 'camera', confidence: 0.9 })
  })

  it('passes the camera index on the command line', async () => {
    const tracker = make()
    const started = waitFor<TrackerError>(tracker, 'tracker-error', (e) =>
      /started on/.test(e.message)
    )
    tracker.start(3)
    expect((await started).message).toBe('started on camera 3 stability balanced')
  })

  it('passes the stability preset on the command line', async () => {
    const tracker = make()
    const started = waitFor<TrackerError>(tracker, 'tracker-error', (e) =>
      /started on/.test(e.message)
    )
    tracker.start(0, 'steady')
    expect((await started).message).toBe('started on camera 0 stability steady')
  })

  it('setStability writes a set_stability command and rejects unknown presets', async () => {
    const tracker = make()
    const ready = waitFor(tracker, 'gaze')
    tracker.start(0)
    await ready

    const ack = waitFor<TrackerError>(tracker, 'tracker-error', (e) =>
      /stability set to/.test(e.message)
    )
    expect(tracker.setStability('responsive')).toBe(true)
    expect((await ack).message).toBe('stability set to responsive')
    expect(tracker.setStability('extreme')).toBe(false)
  })

  it('setCamera writes a set_camera command to stdin without restarting', async () => {
    const tracker = make()
    const ready = waitFor(tracker, 'gaze')
    tracker.start(0)
    await ready

    const ack = waitFor<TrackerError>(tracker, 'tracker-error', (e) =>
      /camera set to/.test(e.message)
    )
    expect(tracker.setCamera(1)).toBe(true)
    expect(await ack).toEqual({ message: 'camera set to 1', fatal: false })
  })

  it('setCamera rejects invalid indices and returns false when not running', () => {
    const tracker = make()
    expect(tracker.setCamera(2)).toBe(false)
    expect(tracker.setCamera(99)).toBe(false)
    expect(() => tracker.start(10)).toThrow(RangeError)
  })

  it('ignores malformed and unknown output lines', async () => {
    const tracker = make(['--mode', 'noisy'])
    const events: GazeEvent[] = []
    tracker.on('gaze', (e: GazeEvent) => events.push(e))
    tracker.start(0)
    await waitFor(tracker, 'gaze', () => events.length >= 3)
    expect(events.every((e) => e.zone === 'camera' && e.confidence === 0.9)).toBe(true)
  })

  it('stop() terminates the child and resolves; no further events or restarts', async () => {
    const tracker = make()
    tracker.start(0)
    await waitFor(tracker, 'gaze')
    await tracker.stop()
    expect(tracker.running).toBe(false)

    let after = 0
    tracker.on('gaze', () => after++)
    tracker.on('tracker-error', () => after++)
    await new Promise((r) => setTimeout(r, 150))
    expect(after).toBe(0)
  })

  it('stop() is safe when never started and when called twice', async () => {
    const tracker = make()
    await tracker.stop()
    tracker.start(0)
    await waitFor(tracker, 'gaze')
    await Promise.all([tracker.stop(), tracker.stop()])
  })

  it('restarts after a crash and keeps going', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tracker-test-'))
    tempDirs.push(dir)
    const tracker = make(['--mode', 'crash-once', '--marker', join(dir, 'marker')])
    const gaze = waitFor<GazeEvent>(tracker, 'gaze')
    tracker.start(0)
    expect((await gaze).zone).toBe('camera')
  })

  it('gives up after 3 restarts (4 launches) and emits a fatal tracker-error', async () => {
    let spawns = 0
    const tracker = new TrackerProcess({
      launch: launch('--mode', 'crash'),
      restartBaseDelayMs: 5,
      spawnFn: (command, args) => {
        spawns++
        return defaultSpawn(command, args)
      }
    })
    created.push(tracker)
    const fatal = waitFor<TrackerError>(tracker, 'tracker-error', (e) => e.fatal)
    tracker.start(0)

    expect((await fatal).fatal).toBe(true)
    expect(spawns).toBe(4)
    expect(tracker.running).toBe(false)
  })

  it('reports a spawn failure (missing binary) as fatal after the retries', async () => {
    const tracker = new TrackerProcess({
      launch: { command: join(tmpdir(), 'definitely-not-a-real-binary-xyz'), args: [] },
      restartBaseDelayMs: 5
    })
    created.push(tracker)
    const fatal = waitFor<TrackerError>(tracker, 'tracker-error', (e) => e.fatal)
    tracker.start(0)
    expect((await fatal).fatal).toBe(true)
    expect(tracker.running).toBe(false)
  })

  it('can be started again after a stop', async () => {
    const tracker = make()
    tracker.start(0)
    await waitFor(tracker, 'gaze')
    await tracker.stop()
    tracker.start(1)
    await waitFor(tracker, 'gaze')
    expect(tracker.running).toBe(true)
  })
})
