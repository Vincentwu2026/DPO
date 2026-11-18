import type { GazeEvent } from '../tracker/protocol'
import type { MeetingMeta, NewSession, StoredGazeEvent } from './SessionRepository'

/** The slice of SessionRepository the recorder needs (lets tests use a fake). */
export interface SessionStore {
  createSession(meta: NewSession): Promise<string>
  updateSessionMeeting(sessionId: string, meta: MeetingMeta): Promise<void>
  insertGazeEvents(sessionId: string, events: readonly StoredGazeEvent[]): Promise<void>
  closeSession(sessionId: string, endedAt?: number): Promise<void>
}

export interface SessionRecorderOptions {
  /** Buffered events are written at least this often. Default 250 ms (< the 500 ms requirement). */
  flushIntervalMs?: number
}

/** Buffers gaze events and batch-writes them to the store while a session is open. */
export class SessionRecorder {
  private readonly flushIntervalMs: number
  private sessionId: string | null = null
  private buffer: StoredGazeEvent[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(
    private readonly store: SessionStore,
    options: SessionRecorderOptions = {}
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? 250
  }

  get activeSessionId(): string | null {
    return this.sessionId
  }

  /** Opens a session (closing any session still open). */
  async begin(meta: NewSession): Promise<string> {
    if (this.sessionId) await this.end()
    const id = await this.store.createSession(meta)
    this.sessionId = id
    this.timer = setInterval(() => void this.flush(), this.flushIntervalMs)
    return id
  }

  /** Attach meeting id/subject once Graph has provided them. */
  async updateMeta(meta: MeetingMeta): Promise<void> {
    if (!this.sessionId) return
    await this.store.updateSessionMeeting(this.sessionId, meta)
  }

  /** `speaking`: whether the user is the active speaker at the moment of this event. */
  record(event: GazeEvent, speaking = false): void {
    if (this.sessionId) this.buffer.push({ ...event, speaking })
  }

  async flush(): Promise<void> {
    if (!this.sessionId || this.buffer.length === 0) return
    const batch = this.buffer
    this.buffer = []
    try {
      await this.store.insertGazeEvents(this.sessionId, batch)
    } catch (err) {
      // Drop the batch rather than retry forever; never log event data.
      console.error('Failed to persist gaze events', err instanceof Error ? err.message : 'unknown')
    }
  }

  /** Flushes, closes the session and returns its id (null if none was open). */
  async end(): Promise<string | null> {
    const id = this.sessionId
    if (!id) return null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    await this.flush()
    this.sessionId = null
    try {
      await this.store.closeSession(id)
    } catch (err) {
      console.error('Failed to close session', err instanceof Error ? err.message : 'unknown')
    }
    return id
  }
}
