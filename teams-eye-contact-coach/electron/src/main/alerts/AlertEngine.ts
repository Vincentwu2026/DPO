import { MAX_EVENT_GAP_S, type Zone } from '../../shared/hudModel'

export type AlertTransition = 'fire' | 'reset'

export interface AlertEngineOptions {
  /** Consecutive seconds off-camera before the alert fires. */
  thresholdSeconds: number
  /** No alert fires within this many seconds of the first event of a session. Default 3. */
  graceSeconds?: number
}

/**
 * Look-away alert state machine, driven entirely by tracker event timestamps (no wall clock), so
 * it is deterministic and a stalled tracker can never raise an alert.
 *
 * - Off-camera time is *consecutive*: any `camera` event resets it (and clears a fired alert).
 * - A gap longer than MAX_EVENT_GAP_S between events (tracker restart/camera swap) restarts counting.
 * - The alert fires once per look-away; it re-arms when the presenter returns to the camera.
 */
export class AlertEngine {
  private thresholdSeconds: number
  private readonly graceSeconds: number
  private sessionStart: number | null = null
  private lastTs: number | null = null
  private offSince: number | null = null
  private firing = false

  constructor(options: AlertEngineOptions) {
    this.thresholdSeconds = options.thresholdSeconds
    this.graceSeconds = options.graceSeconds ?? 3
  }

  setThresholdSeconds(seconds: number): void {
    this.thresholdSeconds = seconds
  }

  get isFiring(): boolean {
    return this.firing
  }

  /** Begin a new session: forgets all state; the next event's timestamp starts the grace period. */
  startSession(): void {
    this.sessionStart = this.lastTs = this.offSince = null
    this.firing = false
  }

  update(event: { ts: number; zone: Zone }): AlertTransition | null {
    this.sessionStart ??= event.ts
    const gap = this.lastTs === null ? 0 : event.ts - this.lastTs
    this.lastTs = event.ts

    if (event.zone === 'camera') {
      this.offSince = null
      if (this.firing) {
        this.firing = false
        return 'reset'
      }
      return null
    }

    if (this.offSince === null || gap > MAX_EVENT_GAP_S) this.offSince = event.ts

    if (
      !this.firing &&
      event.ts - this.sessionStart >= this.graceSeconds &&
      event.ts - this.offSince >= this.thresholdSeconds
    ) {
      this.firing = true
      return 'fire'
    }
    return null
  }
}
