import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { createInterface } from 'node:readline'
import {
  isValidCameraIndex,
  isValidStability,
  parseTrackerLine,
  type CalibrationFit,
  type CalibrationPhase,
  type CalibrationUpdate,
  type GazeEvent,
  type TrackerDevice,
  type TrackerError
} from './protocol'
import { parseThresholds, type GazeThresholds } from './thresholds'

export interface TrackerLaunch {
  command: string
  /** Fixed arguments; `--camera-index` is appended per spawn. */
  args: string[]
}

export type SpawnFn = (command: string, args: string[]) => ChildProcess

export interface TrackerProcessOptions {
  launch: TrackerLaunch
  /** Automatic restarts after an unexpected exit before giving up. Default 3. */
  maxRestarts?: number
  /** First restart delay; doubles each attempt. Default 500 ms. */
  restartBaseDelayMs?: number
  /** Grace period between SIGTERM and SIGKILL in stop(). Default 3000 ms. */
  stopTimeoutMs?: number
  spawnFn?: SpawnFn
}

export const defaultSpawn: SpawnFn = (command, args) =>
  // stderr is discarded: MediaPipe is very chatty and an unread pipe would eventually block it.
  spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true })

/**
 * Owns the Python gaze-tracker child process: spawns it, parses its stdout into typed events,
 * forwards stdin commands and restarts it with exponential back-off if it dies unexpectedly.
 *
 * Events: `gaze` (GazeEvent), `devices` (TrackerDevice[]), `tracker-error` (TrackerError),
 * `calibration` (CalibrationUpdate) and `calibration-result` (CalibrationFit | null).
 */
export class TrackerProcess extends EventEmitter {
  private readonly launch: TrackerLaunch
  private readonly maxRestarts: number
  private readonly restartBaseDelayMs: number
  private readonly stopTimeoutMs: number
  private readonly spawnFn: SpawnFn

  private child: ChildProcess | null = null
  private readonly closed = new WeakMap<ChildProcess, Promise<void>>()
  private restartTimer: NodeJS.Timeout | null = null
  private wanted = false
  private restarts = 0
  private cameraIndex = 0
  private stability = 'balanced'
  private thresholds: GazeThresholds | null = null

  constructor(options: TrackerProcessOptions) {
    super()
    this.launch = options.launch
    this.maxRestarts = options.maxRestarts ?? 3
    this.restartBaseDelayMs = options.restartBaseDelayMs ?? 500
    this.stopTimeoutMs = options.stopTimeoutMs ?? 3_000
    this.spawnFn = options.spawnFn ?? defaultSpawn
  }

  /** True while the tracker is supposed to be running (including while waiting to restart). */
  get running(): boolean {
    return this.wanted
  }

  start(cameraIndex: number, stability?: string): void {
    if (!isValidCameraIndex(cameraIndex)) throw new RangeError('Invalid camera index')
    if (stability !== undefined) this.setStability(stability)
    if (this.wanted) {
      this.setCamera(cameraIndex)
      return
    }
    this.cameraIndex = cameraIndex
    this.wanted = true
    this.restarts = 0
    this.spawnChild()
  }

  /** Hot-swap the camera without restarting. Returns false if it could not be delivered now. */
  setCamera(index: number): boolean {
    if (!isValidCameraIndex(index)) return false
    this.cameraIndex = index // also used by the next automatic restart
    const stdin = this.child?.stdin
    if (!stdin?.writable) return false
    stdin.write(`${JSON.stringify({ cmd: 'set_camera', index })}\n`)
    return true
  }

  /** Change gaze smoothing without restarting; also used by the next automatic restart. */
  setStability(preset: string): boolean {
    if (!isValidStability(preset)) return false
    this.stability = preset
    const stdin = this.child?.stdin
    if (!stdin?.writable) return false
    stdin.write(`${JSON.stringify({ cmd: 'set_stability', preset })}\n`)
    return true
  }

  /**
   * Use personal zone thresholds (null = the built-in defaults). Remembered, and re-sent when the
   * tracker is restarted. Returns false if they are invalid or could not be delivered right now.
   */
  setThresholds(thresholds: GazeThresholds | null): boolean {
    const clean = thresholds === null ? null : parseThresholds(thresholds)
    if (thresholds !== null && !clean) return false
    this.thresholds = clean
    return this.send({ cmd: 'set_thresholds', thresholds: clean })
  }

  /** Start streaming live readings and previews (only while the calibration window is open). */
  calibrationStart(): boolean {
    return this.send({ cmd: 'calibration_start' })
  }

  calibrationStop(): boolean {
    return this.send({ cmd: 'calibration_stop' })
  }

  /** Which look is being sampled; null pauses sampling between steps. */
  calibrationPhase(phase: CalibrationPhase | null): boolean {
    return this.send({ cmd: 'calibration_phase', phase })
  }

  /** Ask for a fit; the answer arrives as a `calibration-result` event. */
  calibrationFit(): boolean {
    return this.send({ cmd: 'calibration_fit' })
  }

  private send(command: Record<string, unknown>): boolean {
    const stdin = this.child?.stdin
    if (!stdin?.writable) return false
    stdin.write(`${JSON.stringify(command)}\n`)
    return true
  }

  /** Close stdin and send SIGTERM (SIGKILL after the grace period); resolves once the child is gone. */
  async stop(): Promise<void> {
    this.wanted = false
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null

    const child = this.child
    this.child = null
    if (!child) return

    const closed = this.closed.get(child)
    child.stdin?.end()
    child.kill('SIGTERM')
    const killTimer = setTimeout(() => child.kill('SIGKILL'), this.stopTimeoutMs)
    try {
      await closed
    } finally {
      clearTimeout(killTimer)
    }
  }

  private spawnChild(): void {
    let child: ChildProcess
    try {
      child = this.spawnFn(this.launch.command, [
        ...this.launch.args,
        '--camera-index',
        String(this.cameraIndex),
        '--stability',
        this.stability
      ])
    } catch {
      this.scheduleRestart()
      return
    }
    this.child = child

    let resolveClosed: () => void = () => undefined
    this.closed.set(
      child,
      new Promise<void>((resolve) => {
        resolveClosed = resolve
      })
    )

    const lines = child.stdout ? createInterface({ input: child.stdout }) : null
    lines?.on('line', (line) => this.handleLine(child, line))
    child.stdin?.on('error', () => undefined) // EPIPE if the child dies mid-write
    if (this.thresholds) this.send({ cmd: 'set_thresholds', thresholds: this.thresholds })

    let ended = false
    const onEnd = (): void => {
      if (ended) return
      ended = true
      lines?.close()
      resolveClosed()
      if (this.child !== child) return // stopped, or replaced by a newer child
      this.child = null
      if (this.wanted) this.scheduleRestart()
    }
    child.once('error', onEnd) // spawn failure (e.g. ENOENT): no 'close' follows
    child.once('close', onEnd)
  }

  private handleLine(child: ChildProcess, line: string): void {
    if (this.child !== child) return
    const message = parseTrackerLine(line)
    if (!message) return
    switch (message.type) {
      case 'gaze':
        this.restarts = 0 // a frame arrived, so the tracker is healthy again
        this.emit('gaze', {
          ts: message.ts,
          zone: message.zone,
          confidence: message.confidence
        } satisfies GazeEvent)
        break
      case 'devices':
        this.emit('devices', message.list satisfies TrackerDevice[])
        break
      case 'error':
        this.emit('tracker-error', {
          message: message.message,
          fatal: false
        } satisfies TrackerError)
        break
      case 'calibration':
        this.emit('calibration', {
          face: message.face,
          h: message.h,
          v: message.v,
          yaw: message.yaw,
          pitch: message.pitch,
          zone: message.zone,
          phase: message.phase,
          cameraSamples: message.cameraSamples,
          screenSamples: message.screenSamples,
          preview: message.preview
        } satisfies CalibrationUpdate)
        break
      case 'calibration_result':
        this.emit('calibration-result', message.result satisfies CalibrationFit | null)
        break
      case 'ready':
        break
    }
  }

  private scheduleRestart(): void {
    if (this.restarts >= this.maxRestarts) {
      this.wanted = false
      this.emit('tracker-error', {
        message: 'The gaze tracker stopped unexpectedly and could not be restarted.',
        fatal: true
      } satisfies TrackerError)
      return
    }
    const delay = this.restartBaseDelayMs * 2 ** this.restarts
    this.restarts++
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      if (this.wanted) this.spawnChild()
    }, delay)
  }
}
