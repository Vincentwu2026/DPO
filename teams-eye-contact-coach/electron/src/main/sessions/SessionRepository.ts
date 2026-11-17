import { randomUUID } from 'node:crypto'
import { chmodSync } from 'node:fs'
import Database from 'better-sqlite3'
import { MAX_EVENT_GAP_S, ZONES, type Zone } from '../../shared/hudModel'
import type { TrackingMode } from '../settings/SettingsService'

export interface MeetingMeta {
  meetingId?: string | null
  subject?: string | null
}

export interface NewSession extends MeetingMeta {
  trackingMode: TrackingMode
  /** Unix seconds; defaults to now. */
  startedAt?: number
}

export interface SessionMeta {
  id: string
  meetingId: string | null
  subject: string | null
  trackingMode: TrackingMode
  startedAt: number
  endedAt: number | null
}

export interface StoredGazeEvent {
  ts: number
  zone: Zone
  confidence: number
}

export interface ZoneStat {
  seconds: number
  /** Share of tracked time, 0–100 */
  percent: number
  events: number
}

export interface SessionSummary extends SessionMeta {
  /** Wall-clock length (end − start; for an open session, up to the last event). */
  durationSeconds: number
  /** Time actually attributed to a zone (gaps over MAX_EVENT_GAP_S are not counted). */
  trackedSeconds: number
  zones: Record<Zone, ZoneStat>
  cameraPercent: number
}

/** Append-only list: index i migrates schema version i → i+1. Never edit a released migration. */
const MIGRATIONS: ReadonlyArray<(db: Database.Database) => void> = [
  (db) =>
    db.exec(`
      CREATE TABLE sessions (
        id            TEXT PRIMARY KEY,
        meeting_id    TEXT,
        subject       TEXT,
        tracking_mode TEXT NOT NULL CHECK (tracking_mode IN ('realtime', 'postcall', 'both')),
        started_at    REAL NOT NULL,
        ended_at      REAL
      );
      CREATE TABLE gaze_events (
        id         INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        ts         REAL NOT NULL,
        zone       TEXT NOT NULL CHECK (zone IN ('camera', 'screen', 'away')),
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1)
      );
      CREATE INDEX idx_gaze_events_session_ts ON gaze_events (session_id, ts);
    `)
]

export const SCHEMA_VERSION = MIGRATIONS.length

export function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  if (current > SCHEMA_VERSION) {
    throw new Error(
      `Database schema v${current} is newer than this app supports (v${SCHEMA_VERSION})`
    )
  }
  for (let version = current; version < SCHEMA_VERSION; version++) {
    db.transaction(() => {
      MIGRATIONS[version](db)
      db.pragma(`user_version = ${version + 1}`)
    })()
  }
}

/** Opens (creating if needed) the on-disk database, readable by the current user only. */
export function openSessionDatabase(path: string): Database.Database {
  const db = new Database(path)
  try {
    chmodSync(path, 0o600) // behavioural data; best effort (no-op semantics on Windows)
  } catch {
    // ignore
  }
  return db
}

interface SessionRow {
  id: string
  meeting_id: string | null
  subject: string | null
  tracking_mode: TrackingMode
  started_at: number
  ended_at: number | null
}

const toMeta = (r: SessionRow): SessionMeta => ({
  id: r.id,
  meetingId: r.meeting_id,
  subject: r.subject,
  trackingMode: r.tracking_mode,
  startedAt: r.started_at,
  endedAt: r.ended_at
})

const nowSeconds = (): number => Date.now() / 1000

/**
 * Local persistence for sessions and gaze events. better-sqlite3 is synchronous (fast enough for
 * ~30 Hz writes on the main process); the public API is async so the storage can change later.
 */
export class SessionRepository {
  constructor(private readonly db: Database.Database) {
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')
    db.pragma('foreign_keys = ON')
    migrate(db)
  }

  async createSession(meta: NewSession): Promise<string> {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO sessions (id, meeting_id, subject, tracking_mode, started_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        id,
        meta.meetingId ?? null,
        meta.subject ?? null,
        meta.trackingMode,
        meta.startedAt ?? nowSeconds()
      )
    return id
  }

  async updateSessionMeeting(sessionId: string, meta: MeetingMeta): Promise<void> {
    this.db
      .prepare(
        `UPDATE sessions SET meeting_id = COALESCE(?, meeting_id), subject = COALESCE(?, subject)
         WHERE id = ?`
      )
      .run(meta.meetingId ?? null, meta.subject ?? null, sessionId)
  }

  async insertGazeEvent(sessionId: string, event: StoredGazeEvent): Promise<void> {
    await this.insertGazeEvents(sessionId, [event])
  }

  /** Inserts all events in one transaction. */
  async insertGazeEvents(sessionId: string, events: readonly StoredGazeEvent[]): Promise<void> {
    if (events.length === 0) return
    const insert = this.db.prepare(
      'INSERT INTO gaze_events (session_id, ts, zone, confidence) VALUES (?, ?, ?, ?)'
    )
    this.db.transaction((batch: readonly StoredGazeEvent[]) => {
      for (const e of batch) insert.run(sessionId, e.ts, e.zone, e.confidence)
    })(events)
  }

  async closeSession(sessionId: string, endedAt: number = nowSeconds()): Promise<void> {
    this.db
      .prepare('UPDATE sessions SET ended_at = ? WHERE id = ? AND ended_at IS NULL')
      .run(endedAt, sessionId)
  }

  /** Closes sessions left open by a crash/force-quit, ending them at their last recorded event. */
  async closeOrphanedSessions(): Promise<number> {
    return this.db
      .prepare(
        `UPDATE sessions
         SET ended_at = COALESCE((SELECT MAX(ts) FROM gaze_events WHERE session_id = sessions.id), started_at)
         WHERE ended_at IS NULL`
      )
      .run().changes
  }

  async getSessionSummary(sessionId: string): Promise<SessionSummary | null> {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
      SessionRow | undefined
    if (!row) return null

    // Each event lasts until the next one (capped); the final event contributes no time.
    const stats = this.db
      .prepare(
        `SELECT zone, COUNT(*) AS events, COALESCE(SUM(dur), 0) AS seconds FROM (
           SELECT zone, MIN(COALESCE(LEAD(ts) OVER (ORDER BY ts, id) - ts, 0), ?) AS dur
           FROM gaze_events WHERE session_id = ?
         ) GROUP BY zone`
      )
      .all(MAX_EVENT_GAP_S, sessionId) as { zone: Zone; events: number; seconds: number }[]

    const zones = Object.fromEntries(
      ZONES.map((z) => [z, { seconds: 0, percent: 0, events: 0 }])
    ) as Record<Zone, ZoneStat>
    for (const s of stats) {
      zones[s.zone].seconds = s.seconds
      zones[s.zone].events = s.events
    }
    const trackedSeconds = ZONES.reduce((sum, z) => sum + zones[z].seconds, 0)
    for (const z of ZONES) {
      zones[z].percent = trackedSeconds > 0 ? (zones[z].seconds / trackedSeconds) * 100 : 0
    }

    let end = row.ended_at
    if (end === null) {
      const last = this.db
        .prepare('SELECT MAX(ts) AS ts FROM gaze_events WHERE session_id = ?')
        .get(sessionId) as { ts: number | null }
      end = last.ts ?? row.started_at
    }

    return {
      ...toMeta(row),
      durationSeconds: Math.max(0, end - row.started_at),
      trackedSeconds,
      zones,
      cameraPercent: zones.camera.percent
    }
  }

  /** Newest first. */
  async listSessions(): Promise<SessionMeta[]> {
    const rows = this.db
      .prepare('SELECT * FROM sessions ORDER BY started_at DESC')
      .all() as SessionRow[]
    return rows.map(toMeta)
  }

  close(): void {
    this.db.close()
  }
}
