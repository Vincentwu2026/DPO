/** Pure gaze/HUD logic shared by the main process (session summaries) and the HUD renderer. */

export type Zone = 'camera' | 'screen' | 'away'
export const ZONES: readonly Zone[] = ['camera', 'screen', 'away']

/**
 * A gaze event is credited with the time until the next event, but never more than this: a longer
 * gap means the tracker was paused/restarted, and that time is untracked rather than attributed.
 */
export const MAX_EVENT_GAP_S = 2

export interface TimedGaze {
  /** Unix time in seconds */
  ts: number
  zone: Zone
}

/** Time-weighted share of tracked time spent in each zone, built incrementally from events. */
export class GazeAccumulator {
  private last: TimedGaze | null = null
  private readonly seconds: Record<Zone, number> = { camera: 0, screen: 0, away: 0 }

  add(event: TimedGaze): void {
    if (this.last && event.ts > this.last.ts) {
      this.seconds[this.last.zone] += Math.min(event.ts - this.last.ts, MAX_EVENT_GAP_S)
    }
    this.last = { ts: event.ts, zone: event.zone }
  }

  reset(): void {
    this.last = null
    this.seconds.camera = this.seconds.screen = this.seconds.away = 0
  }

  get currentZone(): Zone | null {
    return this.last?.zone ?? null
  }

  get trackedSeconds(): number {
    return this.seconds.camera + this.seconds.screen + this.seconds.away
  }

  /** 0–100, or null while nothing has been tracked yet. */
  get cameraPercent(): number | null {
    const total = this.trackedSeconds
    return total > 0 ? (this.seconds.camera / total) * 100 : null
  }

  /** Share of tracked time per zone (each 0–100, summing to 100), or null before any tracking. */
  get zonePercents(): Record<Zone, number> | null {
    const total = this.trackedSeconds
    if (total <= 0) return null
    return {
      camera: (this.seconds.camera / total) * 100,
      screen: (this.seconds.screen / total) * 100,
      away: (this.seconds.away / total) * 100
    }
  }
}

/** m:ss, or h:mm:ss from one hour; negative/NaN input renders as 0:00. */
export function formatElapsed(ms: number): string {
  const total = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** stroke-dashoffset that draws `percent` (clamped to 0–100) of a circle with this circumference. */
export function gaugeDashOffset(percent: number | null, circumference: number): number {
  const p = percent === null || !Number.isFinite(percent) ? 0 : Math.min(100, Math.max(0, percent))
  return circumference * (1 - p / 100)
}

/** After this many consecutive off-camera seconds the HUD starts nudging (before the red alert). */
export const NUDGE_AFTER_S = 2

export type HintLevel = 'idle' | 'good' | 'nudge' | 'alert'

export interface Hint {
  text: string
  level: HintLevel
}

/**
 * The real-time coaching line shown under the gauge.
 * `offCameraSeconds` is how long the presenter has been continuously off camera; `alerting` is
 * true while the look-away alert (main process) is firing, which always wins.
 */
export function coachingHint(zone: Zone | null, offCameraSeconds: number, alerting: boolean): Hint {
  if (zone === null) return { text: 'Waiting for camera', level: 'idle' }
  if (zone === 'camera') return { text: 'Good eye contact', level: 'good' }
  if (alerting) return { text: 'Look at the camera now', level: 'alert' }
  if (offCameraSeconds >= NUDGE_AFTER_S) {
    return {
      text: zone === 'away' ? 'Face the camera' : 'Look at the camera',
      level: 'nudge'
    }
  }
  return { text: zone === 'away' ? 'Face the camera' : 'Eyes on screen', level: 'idle' }
}

/** Tracks continuous off-camera time from event timestamps (seconds). */
export class OffCameraTimer {
  private since: number | null = null

  /** Feed each event in order; returns seconds continuously off camera (0 while on camera). */
  update(ts: number, zone: Zone): number {
    if (zone === 'camera') {
      this.since = null
      return 0
    }
    this.since ??= ts
    return Math.max(0, ts - this.since)
  }

  reset(): void {
    this.since = null
  }
}
