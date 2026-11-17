import { EventEmitter } from 'node:events'
import type { MeetingInfo } from './MeetingService'

export interface FakeCallOptions {
  durationSeconds: number
  /** Called after MEETING_ENDED has been emitted. */
  onFinished?: () => void | Promise<void>
}

/**
 * Development stand-in for MeetingService: emits the same events a Graph-detected Teams call would,
 * so the HUD, alerts, tracker and session store can be exercised without Azure configuration.
 * Wired in only when `!app.isPackaged && FAKE_CALL=1` (see index.ts).
 */
export class FakeCall extends EventEmitter {
  private timers: NodeJS.Timeout[] = []

  constructor(private readonly options: FakeCallOptions) {
    super()
  }

  start(): void {
    const { durationSeconds } = this.options
    const at = (seconds: number, fn: () => void): void => {
      this.timers.push(setTimeout(fn, seconds * 1000))
    }
    this.emit('MEETING_STARTED')
    at(0.5, () =>
      this.emit('MEETING_INFO', {
        meetingId: 'fake-meeting',
        subject: 'Fake call (dev)'
      } satisfies MeetingInfo)
    )
    // Toggle the "Active presenter" badge so it can be seen.
    at(Math.min(5, durationSeconds / 4), () => this.emit('SPEAKER_ACTIVE'))
    at(Math.min(15, durationSeconds / 2), () => this.emit('SPEAKER_INACTIVE'))
    at(durationSeconds, () => {
      this.emit('MEETING_ENDED')
      this.timers = []
      void this.options.onFinished?.()
    })
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers = []
  }
}
