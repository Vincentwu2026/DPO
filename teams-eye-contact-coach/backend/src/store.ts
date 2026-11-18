import {
  breakdown,
  toTimeline,
  type Breakdown,
  type TimelineSegment,
  type Zone
} from './analysis.js'
import type { Database } from './db.js'
import type { SessionUpload } from './schemas.js'

export interface SessionListItem extends Breakdown {
  id: string
  meetingId: string | null
  subject: string | null
  trackingMode: string
  startedAt: number
  endedAt: number
  durationSeconds: number
}

export interface SessionDetail extends SessionListItem {
  /** Speaking-time gaze segments; `start`/`end` are seconds since the session started. */
  timeline: TimelineSegment[]
}

interface SessionRow {
  id: string
  meeting_id: string | null
  subject: string | null
  tracking_mode: string
  started_at: number
  ended_at: number
  duration_s: number
  camera_s: number
  screen_s: number
  away_s: number
}

const SESSION_COLUMNS =
  'id, meeting_id, subject, tracking_mode, started_at, ended_at, duration_s, camera_s, screen_s, away_s'

const toItem = (r: SessionRow): SessionListItem => ({
  id: r.id,
  meetingId: r.meeting_id,
  subject: r.subject,
  trackingMode: r.tracking_mode,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  durationSeconds: r.duration_s,
  ...breakdown({ camera: r.camera_s, screen: r.screen_s, away: r.away_s })
})

/**
 * Every method takes the caller's `oid` (from the validated token) and scopes all SQL by it, so a
 * session belonging to someone else is indistinguishable from one that does not exist.
 */
export class SessionStore {
  constructor(private readonly db: Database) {}

  /** Idempotent per (user, session id): a repeat upload changes nothing. */
  async save(oid: string, s: SessionUpload): Promise<{ created: boolean }> {
    const totals = { camera: 0, screen: 0, away: 0 }
    for (const seg of s.segments) totals[seg.zone] += seg.duration

    return this.db.transaction(async (tx) => {
      const inserted = await tx.query(
        `INSERT INTO sessions
           (user_oid, id, meeting_id, subject, tracking_mode, started_at, ended_at,
            duration_s, camera_s, screen_s, away_s)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (user_oid, id) DO NOTHING
         RETURNING id`,
        [
          oid,
          s.id,
          s.meetingId ?? null,
          s.subject ?? null,
          s.trackingMode,
          s.startedAt,
          s.endedAt,
          s.endedAt - s.startedAt,
          totals.camera,
          totals.screen,
          totals.away
        ]
      )
      if (inserted.rows.length === 0) return { created: false }

      if (s.segments.length > 0) {
        await tx.query(
          `INSERT INTO gaze_segments (user_oid, session_id, seq, start_s, duration_s, zone)
           SELECT $1::uuid, $2::uuid, (t.n - 1)::int, t.start_s, t.duration_s, t.zone
           FROM unnest($3::float8[], $4::float8[], $5::text[]) WITH ORDINALITY
             AS t(start_s, duration_s, zone, n)`,
          [
            oid,
            s.id,
            s.segments.map((x) => x.start),
            s.segments.map((x) => x.duration),
            s.segments.map((x) => x.zone)
          ]
        )
      }
      return { created: true }
    })
  }

  /** Newest first. `before` pages by started_at (unix seconds). */
  async list(oid: string, limit: number, before?: number): Promise<SessionListItem[]> {
    const { rows } = await this.db.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM sessions
       WHERE user_oid = $1 AND ($3::float8 IS NULL OR started_at < $3::float8)
       ORDER BY started_at DESC
       LIMIT $2`,
      [oid, limit, before ?? null]
    )
    return rows.map(toItem)
  }

  async get(oid: string, id: string): Promise<SessionDetail | null> {
    const found = await this.db.query<SessionRow>(
      `SELECT ${SESSION_COLUMNS} FROM sessions WHERE user_oid = $1 AND id = $2`,
      [oid, id]
    )
    const row = found.rows[0]
    if (!row) return null
    const segs = await this.db.query<{ start_s: number; duration_s: number; zone: Zone }>(
      `SELECT start_s, duration_s, zone FROM gaze_segments
       WHERE user_oid = $1 AND session_id = $2 ORDER BY seq`,
      [oid, id]
    )
    const timeline = toTimeline(
      segs.rows.map((r) => ({ start: r.start_s, duration: r.duration_s, zone: r.zone }))
    )
    return { ...toItem(row), timeline }
  }
}
