import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GazeEvent } from '../tracker/protocol'
import { SessionRecorder, type SessionStore } from '../sessions/SessionRecorder'
import type { StoredGazeEvent } from '../sessions/SessionRepository'

const gaze = (ts: number): GazeEvent => ({ ts, zone: 'camera', confidence: 0.9 })

function fakeStore() {
  const written: { at: number; sessionId: string; events: StoredGazeEvent[] }[] = []
  const store = {
    createSession: vi.fn().mockResolvedValue('s1'),
    updateSessionMeeting: vi.fn().mockResolvedValue(undefined),
    insertGazeEvents: vi.fn(async (sessionId: string, events: readonly StoredGazeEvent[]) => {
      written.push({ at: Date.now(), sessionId, events: [...events] })
    }),
    closeSession: vi.fn().mockResolvedValue(undefined)
  } satisfies SessionStore
  return { store, written }
}

describe('SessionRecorder', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('persists each event within 500 ms of recording it', async () => {
    const { store, written } = fakeStore()
    const rec = new SessionRecorder(store)
    await rec.begin({ trackingMode: 'both' })

    const t0 = Date.now()
    rec.record(gaze(1))
    await vi.advanceTimersByTimeAsync(499)
    expect(written.length).toBe(1)
    expect(written[0].at - t0).toBeLessThan(500)
    expect(written[0].events).toEqual([{ ...gaze(1), speaking: false }])
    await rec.end()
  })

  it('tags each event with whether the user was speaking when it was recorded', async () => {
    const { store, written } = fakeStore()
    const rec = new SessionRecorder(store)
    await rec.begin({ trackingMode: 'both' })
    rec.record(gaze(1), false)
    rec.record(gaze(2), true)
    await vi.advanceTimersByTimeAsync(250)
    expect(written[0].events.map((e) => e.speaking)).toEqual([false, true])
    await rec.end()
  })

  it('batches events into one write per flush', async () => {
    const { store, written } = fakeStore()
    const rec = new SessionRecorder(store, { flushIntervalMs: 1000 })
    await rec.begin({ trackingMode: 'both' })
    for (let i = 0; i < 30; i++) rec.record(gaze(i))
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.insertGazeEvents).toHaveBeenCalledTimes(1)
    expect(written[0].events).toHaveLength(30)
    await rec.end()
  })

  it('ignores events when no session is open', async () => {
    const { store } = fakeStore()
    const rec = new SessionRecorder(store)
    rec.record(gaze(1))
    await rec.flush()
    expect(store.insertGazeEvents).not.toHaveBeenCalled()
    expect(await rec.end()).toBeNull()
  })

  it('end() flushes remaining events, closes the session and stops the timer', async () => {
    const { store, written } = fakeStore()
    const rec = new SessionRecorder(store)
    await rec.begin({ trackingMode: 'realtime' })
    rec.record(gaze(1))

    expect(await rec.end()).toBe('s1')
    expect(written).toHaveLength(1)
    expect(store.closeSession).toHaveBeenCalledWith('s1')
    expect(rec.activeSessionId).toBeNull()

    rec.record(gaze(2))
    await vi.advanceTimersByTimeAsync(5000)
    expect(store.insertGazeEvents).toHaveBeenCalledTimes(1)
  })

  it('begin() closes a session that is still open', async () => {
    const { store } = fakeStore()
    store.createSession.mockResolvedValueOnce('a').mockResolvedValueOnce('b')
    const rec = new SessionRecorder(store)
    await rec.begin({ trackingMode: 'both' })
    await rec.begin({ trackingMode: 'both' })
    expect(store.closeSession).toHaveBeenCalledWith('a')
    expect(rec.activeSessionId).toBe('b')
    await rec.end()
  })

  it('forwards meeting metadata updates to the open session only', async () => {
    const { store } = fakeStore()
    const rec = new SessionRecorder(store)
    await rec.updateMeta({ subject: 'ignored' })
    expect(store.updateSessionMeeting).not.toHaveBeenCalled()
    await rec.begin({ trackingMode: 'both' })
    await rec.updateMeta({ subject: 'Sync' })
    expect(store.updateSessionMeeting).toHaveBeenCalledWith('s1', { subject: 'Sync' })
    await rec.end()
  })

  it('survives a failing write without throwing or leaking the timer', async () => {
    const { store } = fakeStore()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    store.insertGazeEvents.mockRejectedValueOnce(new Error('disk full'))
    const rec = new SessionRecorder(store)
    await rec.begin({ trackingMode: 'both' })
    rec.record(gaze(1))
    await vi.advanceTimersByTimeAsync(300)
    rec.record(gaze(2))
    await expect(rec.end()).resolves.toBe('s1')
    expect(store.insertGazeEvents).toHaveBeenCalledTimes(2)
  })
})
