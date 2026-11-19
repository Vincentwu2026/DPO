import { parseThresholds, type GazeThresholds } from '../tracker/thresholds'

/** The slice of electron-store the calibration needs (lets tests use a Map). */
export interface CalibrationBacking {
  get(key: string): unknown
  set(key: string, value: unknown): void
  delete(key: string): void
}

export interface CalibrationInfo {
  /** Epoch ms of the last successful calibration. */
  calibratedAt: number
}

/** The user's personal gaze thresholds. Stored values are validated on every read. */
export class CalibrationStore {
  constructor(private readonly store: CalibrationBacking) {}

  getThresholds(): GazeThresholds | null {
    return parseThresholds(this.store.get('thresholds'))
  }

  getInfo(): CalibrationInfo | null {
    if (!this.getThresholds()) return null
    const at = this.store.get('calibratedAt')
    return typeof at === 'number' && Number.isFinite(at) ? { calibratedAt: at } : null
  }

  /** Returns false (and stores nothing) if the thresholds are not valid. */
  save(thresholds: unknown, now: number = Date.now()): boolean {
    const clean = parseThresholds(thresholds)
    if (!clean) return false
    this.store.set('thresholds', clean)
    this.store.set('calibratedAt', now)
    return true
  }

  clear(): void {
    this.store.delete('thresholds')
    this.store.delete('calibratedAt')
  }
}
