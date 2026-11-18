import Database from 'better-sqlite3'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  migrate,
  SCHEMA_VERSION,
  SessionRepository,
  type StoredGazeEvent
} from '../sessions/SessionRepository'

const ev = (ts: number, zone: StoredGazeEvent['zone'], confidence = 0.9): StoredGazeEvent => ({
  ts,
  zone,
  confidence
})

describe('SessionRepository (in-memory SQLite)', () => {
  let db: Database.Database
  let repo: SessionRepository

  beforeEach(() => {
    db = new Database(':memory:')
    repo = new SessionRepository(db)
  })

  it('creates the schema and records the version', () => {
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[]
    expect(tables.map((t) => t.name)).toEqual(expect.arrayContaining(['sessions', 'gaze_events']))
  })

  it('createSession stores metadata and returns a unique id', async () => {
    const a = await repo.createSession({
      meetingId: 'thread-1',
      subject: 'Weekly sync',
      trackingMode: 'both',
      startedAt: 1000
    })
    const b = await repo.createSession({ trackingMode: 'realtime', startedAt: 2000 })
    expect(a).not.toBe(b)

    const list = await repo.listSessions()
    expect(list.map((s) => s.id)).toEqual([b, a]) // newest first
    expect(list[1]).toEqual({
      id: a,
      meetingId: 'thread-1',
      subject: 'Weekly sync',
      trackingMode: 'both',
      startedAt: 1000,
      endedAt: null
    })
    expect(list[0].meetingId).toBeNull()
  })

  it('updateSessionMeeting fills in meeting details without clobbering existing ones', async () => {
    const id = await repo.createSession({ meetingId: 'm1', trackingMode: 'both', startedAt: 1 })
    await repo.updateSessionMeeting(id, { subject: 'Roadmap' })
    await repo.updateSessionMeeting(id, {})
    const [s] = await repo.listSessions()
    expect(s.meetingId).toBe('m1')
    expect(s.subject).toBe('Roadmap')
  })

  it('computes time-weighted per-zone totals and percentages', async () => {
    const id = await repo.createSession({ trackingMode: 'both', startedAt: 100 })
    // camera 100-104 (1+1+1+1), screen 104-106 (1+1), away 106-107 (1), last event adds no time
    await repo.insertGazeEvents(id, [
      ev(100, 'camera'),
      ev(101, 'camera'),
      ev(102, 'camera'),
      ev(103, 'camera'),
      ev(104, 'screen'),
      ev(105, 'screen'),
      ev(106, 'away'),
      ev(107, 'camera')
    ])
    await repo.closeSession(id, 107)

    const s = (await repo.getSessionSummary(id))!
    expect(s.zones.camera.seconds).toBeCloseTo(4)
    expect(s.zones.screen.seconds).toBeCloseTo(2)
    expect(s.zones.away.seconds).toBeCloseTo(1)
    expect(s.trackedSeconds).toBeCloseTo(7)
    expect(s.zones.camera.percent).toBeCloseTo((4 / 7) * 100)
    expect(s.cameraPercent).toBeCloseTo((4 / 7) * 100)
    expect(s.zones.camera.events + s.zones.screen.events + s.zones.away.events).toBe(8)
    expect(s.durationSeconds).toBe(7)
    expect(s.endedAt).toBe(107)
  })

  it('caps long gaps so paused tracking is not attributed to a zone', async () => {
    const id = await repo.createSession({ trackingMode: 'both', startedAt: 0 })
    await repo.insertGazeEvents(id, [ev(0, 'camera'), ev(60, 'screen'), ev(61, 'screen')])
    const s = (await repo.getSessionSummary(id))!
    expect(s.zones.camera.seconds).toBe(2) // MAX_EVENT_GAP_S, not 60
    expect(s.trackedSeconds).toBe(3)
  })

  it('summarises an empty or unknown session safely', async () => {
    const id = await repo.createSession({ trackingMode: 'postcall', startedAt: 5 })
    const s = (await repo.getSessionSummary(id))!
    expect(s.trackedSeconds).toBe(0)
    expect(s.cameraPercent).toBe(0)
    expect(s.durationSeconds).toBe(0)
    expect(await repo.getSessionSummary('nope')).toBeNull()
  })

  it('closeSession only sets the end time once', async () => {
    const id = await repo.createSession({ trackingMode: 'both', startedAt: 1 })
    await repo.closeSession(id, 10)
    await repo.closeSession(id, 99)
    expect((await repo.listSessions())[0].endedAt).toBe(10)
  })

  it('closes sessions orphaned by a crash at their last event', async () => {
    const withEvents = await repo.createSession({ trackingMode: 'both', startedAt: 10 })
    await repo.insertGazeEvent(withEvents, ev(15, 'camera'))
    const empty = await repo.createSession({ trackingMode: 'both', startedAt: 20 })
    const done = await repo.createSession({ trackingMode: 'both', startedAt: 30 })
    await repo.closeSession(done, 31)

    expect(await repo.closeOrphanedSessions()).toBe(2)
    const byId = Object.fromEntries((await repo.listSessions()).map((s) => [s.id, s.endedAt]))
    expect(byId[withEvents]).toBe(15)
    expect(byId[empty]).toBe(20)
    expect(byId[done]).toBe(31)
  })

  it('rejects invalid zones, confidences and unknown sessions (DB constraints)', async () => {
    const id = await repo.createSession({ trackingMode: 'both', startedAt: 1 })
    await expect(
      repo.insertGazeEvent(id, { ts: 1, zone: 'sideways' as never, confidence: 0.5 })
    ).rejects.toThrow()
    await expect(repo.insertGazeEvent(id, ev(1, 'camera', 1.5))).rejects.toThrow()
    await expect(repo.insertGazeEvent('missing', ev(1, 'camera'))).rejects.toThrow()
    await expect(
      repo.createSession({ trackingMode: 'bogus' as never, startedAt: 1 })
    ).rejects.toThrow()
  })

  it('stores user-controlled text via bound parameters, not SQL interpolation', async () => {
    const evil = "x'); DROP TABLE sessions; --"
    const id = await repo.createSession({ subject: evil, trackingMode: 'both', startedAt: 1 })
    expect((await repo.listSessions())[0].subject).toBe(evil)
    expect((await repo.getSessionSummary(id))!.subject).toBe(evil)
  })

  it('a failing batch insert is atomic', async () => {
    const id = await repo.createSession({ trackingMode: 'both', startedAt: 1 })
    await expect(repo.insertGazeEvents(id, [ev(1, 'camera'), ev(2, 'camera', 5)])).rejects.toThrow()
    expect((await repo.getSessionSummary(id))!.zones.camera.events).toBe(0)
  })

  it('cascades deletes from sessions to gaze events', async () => {
    const id = await repo.createSession({ trackingMode: 'both', startedAt: 1 })
    await repo.insertGazeEvent(id, ev(1, 'camera'))
    db.prepare('DELETE FROM sessions WHERE id = ?').run(id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM gaze_events').get()).toEqual({ n: 0 })
  })
})

describe('speaking-time breakdown', () => {
  let repo: SessionRepository

  beforeEach(() => {
    repo = new SessionRepository(new Database(':memory:'))
  })

  it('counts only events tagged speaking in the speaking breakdown', async () => {
    const id = await repo.createSession({ trackingMode: 'both', startedAt: 0 })
    // 0-4 s listening (screen), 4-8 s speaking: 3 s camera + 1 s screen, then one closing event.
    await repo.insertGazeEvents(id, [
      { ts: 0, zone: 'screen', confidence: 1, speaking: false },
      { ts: 1, zone: 'screen', confidence: 1, speaking: false },
      { ts: 2, zone: 'screen', confidence: 1, speaking: false },
      { ts: 3, zone: 'screen', confidence: 1, speaking: false },
      { ts: 4, zone: 'camera', confidence: 1, speaking: true },
      { ts: 5, zone: 'camera', confidence: 1, speaking: true },
      { ts: 6, zone: 'camera', confidence: 1, speaking: true },
      { ts: 7, zone: 'screen', confidence: 1, speaking: true },
      { ts: 8, zone: 'screen', confidence: 1, speaking: true }
    ])
    const s = (await repo.getSessionSummary(id))!

    expect(s.speaking.trackedSeconds).toBeCloseTo(4)
    expect(s.speaking.zones.camera.seconds).toBeCloseTo(3)
    expect(s.speaking.zones.screen.seconds).toBeCloseTo(1)
    expect(s.speaking.cameraPercent).toBeCloseTo(75)

    // The overall numbers still cover the whole call, listening included.
    expect(s.trackedSeconds).toBeCloseTo(8)
    expect(s.cameraPercent).toBeCloseTo((3 / 8) * 100)
  })

  it('reports an empty speaking breakdown when the user never spoke', async () => {
    const id = await repo.createSession({ trackingMode: 'both', startedAt: 0 })
    await repo.insertGazeEvents(id, [
      { ts: 0, zone: 'camera', confidence: 1 },
      { ts: 1, zone: 'camera', confidence: 1 }
    ])
    const s = (await repo.getSessionSummary(id))!
    expect(s.speaking.trackedSeconds).toBe(0)
    expect(s.speaking.cameraPercent).toBe(0)
    expect(s.cameraPercent).toBe(100)
  })
})

describe('cloud sync bookkeeping', () => {
  let repo: SessionRepository
  beforeEach(() => {
    repo = new SessionRepository(new Database(':memory:'))
  })

  it('lists only closed, unsynced sessions, oldest first', async () => {
    const a = await repo.createSession({ trackingMode: 'realtime', startedAt: 200 })
    const b = await repo.createSession({ trackingMode: 'realtime', startedAt: 100 })
    const open = await repo.createSession({ trackingMode: 'realtime', startedAt: 300 })
    await repo.closeSession(a, 210)
    await repo.closeSession(b, 110)
    expect(await repo.listUnsyncedSessionIds()).toEqual([b, a])

    await repo.markSynced(b)
    expect(await repo.listUnsyncedSessionIds()).toEqual([a])
    expect(await repo.listUnsyncedSessionIds()).not.toContain(open)
  })

  it('returns events with their speaking tags for upload, and null for open sessions', async () => {
    const id = await repo.createSession({ trackingMode: 'both', subject: 'Talk', startedAt: 0 })
    await repo.insertGazeEvents(id, [
      { ts: 1, zone: 'camera', confidence: 0.9, speaking: true },
      { ts: 2, zone: 'away', confidence: 0.9 }
    ])
    expect(await repo.getSyncSource(id)).toBeNull() // still open
    await repo.closeSession(id, 5)
    const src = await repo.getSyncSource(id)
    expect(src?.meta).toMatchObject({ id, subject: 'Talk', startedAt: 0, endedAt: 5 })
    expect(src?.events).toEqual([
      { ts: 1, zone: 'camera', speaking: true },
      { ts: 2, zone: 'away', speaking: false }
    ])
    expect(await repo.getSyncSource('missing')).toBeNull()
  })
})

describe('migrate', () => {
  it('is idempotent', () => {
    const db = new Database(':memory:')
    migrate(db)
    migrate(db)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
  })

  it('upgrades a database at an older version and keeps its data path intact', () => {
    const db = new Database(':memory:')
    migrate(db)
    db.pragma('user_version = 0')
    db.exec('DROP TABLE gaze_events; DROP TABLE sessions;')
    migrate(db)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    db.prepare('SELECT * FROM sessions').all()
  })

  it('upgrades a v1 database with data and defaults old events to not speaking', () => {
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, meeting_id TEXT, subject TEXT,
        tracking_mode TEXT NOT NULL CHECK (tracking_mode IN ('realtime', 'postcall', 'both')),
        started_at REAL NOT NULL, ended_at REAL
      );
      CREATE TABLE gaze_events (
        id INTEGER PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        ts REAL NOT NULL,
        zone TEXT NOT NULL CHECK (zone IN ('camera', 'screen', 'away')),
        confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1)
      );
      INSERT INTO sessions VALUES ('old', NULL, 'Old call', 'both', 0, 10);
      INSERT INTO gaze_events (session_id, ts, zone, confidence) VALUES ('old', 1, 'camera', 0.9);
    `)
    db.pragma('user_version = 1')

    migrate(db)

    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(db.prepare('SELECT speaking FROM gaze_events').get()).toEqual({ speaking: 0 })
    expect(db.prepare('SELECT subject FROM sessions').get()).toEqual({ subject: 'Old call' })
  })

  it('never queues sessions recorded before cloud sync existed', () => {
    const db = new Database(':memory:')
    migrate(db)
    db.pragma('user_version = 2')
    db.exec('ALTER TABLE sessions DROP COLUMN synced_at')
    db.exec("INSERT INTO sessions VALUES ('old', NULL, 'Old', 'both', 0, 10)")
    migrate(db)
    expect(db.prepare('SELECT synced_at FROM sessions').get()).toEqual({ synced_at: 0 })
  })

  it('refuses a database written by a newer app version', () => {
    const db = new Database(':memory:')
    db.pragma(`user_version = ${SCHEMA_VERSION + 1}`)
    expect(() => migrate(db)).toThrow(/newer/)
  })
})
