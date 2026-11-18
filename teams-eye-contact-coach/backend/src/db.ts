/**
 * Minimal database seam: `pg` in production, PGlite (real Postgres compiled to WASM) in tests.
 * Every query must be parameterised ($1, $2, …); never interpolate values into the SQL text.
 */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>
}

export interface Database extends Queryable {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>
  close(): Promise<void>
}

/** Append-only; index i migrates schema version i → i+1. Never edit a released migration. */
const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE sessions (
    user_oid        UUID NOT NULL,
    id              UUID NOT NULL,
    meeting_id      TEXT,
    subject         TEXT,
    tracking_mode   TEXT NOT NULL CHECK (tracking_mode IN ('realtime', 'postcall', 'both')),
    started_at      DOUBLE PRECISION NOT NULL,
    ended_at        DOUBLE PRECISION NOT NULL,
    duration_s      DOUBLE PRECISION NOT NULL CHECK (duration_s >= 0),
    camera_s        DOUBLE PRECISION NOT NULL CHECK (camera_s >= 0),
    screen_s        DOUBLE PRECISION NOT NULL CHECK (screen_s >= 0),
    away_s          DOUBLE PRECISION NOT NULL CHECK (away_s >= 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Scoped by user: two users can never collide on, or probe for, the same session id.
    PRIMARY KEY (user_oid, id)
  );
  CREATE INDEX sessions_user_started ON sessions (user_oid, started_at DESC);

  CREATE TABLE gaze_segments (
    user_oid   UUID NOT NULL,
    session_id UUID NOT NULL,
    seq        INTEGER NOT NULL,
    start_s    DOUBLE PRECISION NOT NULL CHECK (start_s >= 0),
    duration_s DOUBLE PRECISION NOT NULL CHECK (duration_s > 0),
    zone       TEXT NOT NULL CHECK (zone IN ('camera', 'screen', 'away')),
    PRIMARY KEY (user_oid, session_id, seq),
    FOREIGN KEY (user_oid, session_id) REFERENCES sessions (user_oid, id) ON DELETE CASCADE
  );
  `
]

export const SCHEMA_VERSION = MIGRATIONS.length

/** Brings the schema up to date. Safe to run from several instances at once. */
export async function migrate(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    // Serialises concurrent starts (released when the transaction ends).
    await tx.query('SELECT pg_advisory_xact_lock(727274)')
    await tx.query('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)')
    const { rows } = await tx.query<{ version: number }>('SELECT version FROM schema_version')
    const current = rows[0]?.version ?? 0
    if (current > SCHEMA_VERSION) {
      throw new Error(`Database schema v${current} is newer than this server (v${SCHEMA_VERSION})`)
    }
    for (let v = current; v < SCHEMA_VERSION; v++) {
      await tx.query(MIGRATIONS[v] as string)
    }
    if (rows.length === 0)
      await tx.query('INSERT INTO schema_version (version) VALUES ($1)', [SCHEMA_VERSION])
    else if (current < SCHEMA_VERSION) {
      await tx.query('UPDATE schema_version SET version = $1', [SCHEMA_VERSION])
    }
  })
}
