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
