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
  /** True while the signed-in user was the active speaker (Graph, ~5 s resolution). */
  speaking?: boolean
}

export interface ZoneStat {
  seconds: number
  /** Share of tracked time, 0–100 */
  percent: number
  events: number
}

export interface ZoneBreakdown {
  /** Time actually attributed to a zone (gaps over MAX_EVENT_GAP_S are not counted). */
  trackedSeconds: number
  zones: Record<Zone, ZoneStat>
  cameraPercent: number
}

export interface SessionSummary extends SessionMeta, ZoneBreakdown {
  /** Wall-clock length (end − start; for an open session, up to the last event). */
  durationSeconds: number
  /** The same breakdown restricted to time the user was the active speaker. */
  speaking: ZoneBreakdown
}

export interface SyncSource {
  meta: SessionMeta & { endedAt: number }
  events: { ts: number; zone: Zone; speaking: boolean }[]
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
    `),
  // v2: tag each event with whether the user was speaking. Older events default to 0 (unknown).
  (db) =>
    db.exec(`
      ALTER TABLE gaze_events
        ADD COLUMN speaking INTEGER NOT NULL DEFAULT 0 CHECK (speaking IN (0, 1));
    `),
  // v3: cloud upload bookkeeping. NULL = waiting to upload. Sessions recorded before this version
  // have no speaking tags and were captured before sync existed, so they are never uploaded.
  (db) =>
    db.exec(`
      ALTER TABLE sessions ADD COLUMN synced_at REAL;
      UPDATE sessions SET synced_at = 0;
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

function emptyBreakdown(): ZoneBreakdown {
  return {
    trackedSeconds: 0,
    zones: Object.fromEntries(
      ZONES.map((z) => [z, { seconds: 0, percent: 0, events: 0 }])
    ) as Record<Zone, ZoneStat>,
    cameraPercent: 0
  }
}

function finishBreakdown(b: ZoneBreakdown): void {
  b.trackedSeconds = ZONES.reduce((sum, z) => sum + b.zones[z].seconds, 0)
  for (const z of ZONES) {
    b.zones[z].percent = b.trackedSeconds > 0 ? (b.zones[z].seconds / b.trackedSeconds) * 100 : 0
  }
  b.cameraPercent = b.zones.camera.percent
}

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
      'INSERT INTO gaze_events (session_id, ts, zone, confidence, speaking) VALUES (?, ?, ?, ?, ?)'
    )
    this.db.transaction((batch: readonly StoredGazeEvent[]) => {
      for (const e of batch) insert.run(sessionId, e.ts, e.zone, e.confidence, e.speaking ? 1 : 0)
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
    // An event's time counts toward "speaking" when the event itself was tagged speaking.
    const stats = this.db
      .prepare(
        `SELECT zone, speaking, COUNT(*) AS events, COALESCE(SUM(dur), 0) AS seconds FROM (
           SELECT zone, speaking, MIN(COALESCE(LEAD(ts) OVER (ORDER BY ts, id) - ts, 0), ?) AS dur
           FROM gaze_events WHERE session_id = ?
         ) GROUP BY zone, speaking`
      )
      .all(MAX_EVENT_GAP_S, sessionId) as {
      zone: Zone
      speaking: 0 | 1
      events: number
      seconds: number
    }[]

    const overall = emptyBreakdown()
    const speaking = emptyBreakdown()
    for (const s of stats) {
      for (const target of s.speaking === 1 ? [overall, speaking] : [overall]) {
        target.zones[s.zone].seconds += s.seconds
        target.zones[s.zone].events += s.events
      }
    }
    finishBreakdown(overall)
    finishBreakdown(speaking)

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
      ...overall,
      speaking
    }
  }

  /** Closed sessions not yet uploaded, oldest first. */
  async listUnsyncedSessionIds(): Promise<string[]> {
    const rows = this.db
      .prepare(
        'SELECT id FROM sessions WHERE ended_at IS NOT NULL AND synced_at IS NULL ORDER BY started_at'
      )
      .all() as { id: string }[]
    return rows.map((r) => r.id)
  }

  async markSynced(sessionId: string): Promise<void> {
    this.db.prepare('UPDATE sessions SET synced_at = ? WHERE id = ?').run(nowSeconds(), sessionId)
  }

  /** Everything needed to upload one closed session; null if it is missing or still open. */
  async getSyncSource(sessionId: string): Promise<SyncSource | null> {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as
      SessionRow | undefined
    if (!row || row.ended_at === null) return null
    const events = this.db
      .prepare('SELECT ts, zone, speaking FROM gaze_events WHERE session_id = ? ORDER BY ts, id')
      .all(sessionId) as { ts: number; zone: Zone; speaking: 0 | 1 }[]
    return {
      meta: { ...toMeta(row), endedAt: row.ended_at },
      events: events.map((e) => ({ ts: e.ts, zone: e.zone, speaking: e.speaking === 1 }))
    }
  }

  /** Events of one session for the report timeline; empty if the session does not exist. */
  async getReportEvents(sessionId: string): Promise<SyncSource['events']> {
    const events = this.db
      .prepare('SELECT ts, zone, speaking FROM gaze_events WHERE session_id = ? ORDER BY ts, id')
      .all(sessionId) as { ts: number; zone: Zone; speaking: 0 | 1 }[]
    return events.map((e) => ({ ts: e.ts, zone: e.zone, speaking: e.speaking === 1 }))
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
