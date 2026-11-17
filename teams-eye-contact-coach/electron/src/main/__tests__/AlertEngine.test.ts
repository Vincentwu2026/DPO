import { beforeEach, describe, expect, it } from 'vitest'
import { AlertEngine, type AlertTransition } from '../alerts/AlertEngine'
import type { Zone } from '../../shared/hudModel'

/** Feeds one event per second starting at t0, returning the transition (if any) per event. */
function run(engine: AlertEngine, zones: Zone[], t0 = 1000): (AlertTransition | null)[] {
  return zones.map((zone, i) => engine.update({ ts: t0 + i, zone }))
}

const off = (n: number, zone: Zone = 'screen'): Zone[] => Array<Zone>(n).fill(zone)

describe('AlertEngine', () => {
  let engine: AlertEngine
  beforeEach(() => {
    engine = new AlertEngine({ thresholdSeconds: 5 })
  })

  it('does not fire while the presenter is looking at the camera', () => {
    expect(run(engine, off(30, 'camera')).every((t) => t === null)).toBe(true)
    expect(engine.isFiring).toBe(false)
  })

  it('fires once after the threshold of consecutive off-camera seconds (after the grace period)', () => {
    // 10 s of camera first so the 3 s grace period is long over; look away from t=10.
    const result = run(engine, [...off(10, 'camera'), ...off(8, 'screen')])
    // off-camera starts at index 10 (t=1010); 5 s later is index 15
    expect(result.indexOf('fire')).toBe(15)
    expect(result.filter((t) => t === 'fire')).toHaveLength(1) // only once per look-away
    expect(engine.isFiring).toBe(true)
  })

  it('treats screen and away the same', () => {
    const zones: Zone[] = [
      ...off(5, 'camera'),
      'screen',
      'away',
      'screen',
      'away',
      'screen',
      'away'
    ]
    expect(run(engine, zones).filter((t) => t === 'fire')).toHaveLength(1)
  })

  it('resets immediately when the presenter returns to the camera', () => {
    const result = run(engine, [...off(5, 'camera'), ...off(7, 'away'), 'camera', 'camera'])
    expect(result[result.length - 2]).toBe('reset')
    expect(result[result.length - 1]).toBeNull()
    expect(engine.isFiring).toBe(false)
  })

  it('a brief return to camera restarts the consecutive count', () => {
    const result = run(engine, [
      ...off(5, 'camera'),
      ...off(4, 'screen'),
      'camera',
      ...off(4, 'screen'),
      ...off(1, 'camera')
    ])
    expect(result).not.toContain('fire')
  })

  it('re-arms after a reset and fires again on the next look-away', () => {
    const result = run(engine, [
      ...off(5, 'camera'),
      ...off(6, 'screen'),
      'camera',
      ...off(6, 'screen')
    ])
    expect(result.filter((t) => t === 'fire')).toHaveLength(2)
    expect(result.filter((t) => t === 'reset')).toHaveLength(1)
  })

  describe('grace period', () => {
    it('never fires in the first 3 s of a session, even with a 1 s threshold', () => {
      const e = new AlertEngine({ thresholdSeconds: 1 })
      const result = run(e, off(6)) // t = 0..5 relative to session start
      expect(result.indexOf('fire')).toBe(3)
      expect(result.slice(0, 3)).toEqual([null, null, null])
    })

    it('is configurable', () => {
      const e = new AlertEngine({ thresholdSeconds: 1, graceSeconds: 6 })
      expect(run(e, off(10)).indexOf('fire')).toBe(6)
    })

    it('restarts for each new session', () => {
      const e = new AlertEngine({ thresholdSeconds: 1 })
      run(e, off(10))
      expect(e.isFiring).toBe(true)

      e.startSession()
      expect(e.isFiring).toBe(false)
      const result = run(e, off(5), 5000)
      expect(result.indexOf('fire')).toBe(3)
    })
  })

  it('restarts counting after a gap in events (tracker restart / camera swap)', () => {
    run(engine, off(5, 'camera'))
    engine.update({ ts: 1005, zone: 'screen' })
    engine.update({ ts: 1006, zone: 'screen' })
    // 20 s of silence: the old off-camera streak must not carry over (it would fire right away)
    expect(engine.update({ ts: 1026, zone: 'screen' })).toBeNull()
    for (const ts of [1027, 1028, 1029, 1030]) {
      expect(engine.update({ ts, zone: 'screen' })).toBeNull()
    }
    expect(engine.update({ ts: 1031, zone: 'screen' })).toBe('fire') // 5 s after the restart
  })

  it('a hole longer than the gap cap in the middle of a streak restarts it', () => {
    run(engine, off(5, 'camera'))
    engine.update({ ts: 1005, zone: 'screen' })
    engine.update({ ts: 1009, zone: 'screen' }) // 4 s gap > MAX_EVENT_GAP_S
    expect(engine.update({ ts: 1010, zone: 'screen' })).toBeNull() // only 1 s into the new streak
  })

  it('applies a new threshold to the ongoing session', () => {
    const e = new AlertEngine({ thresholdSeconds: 30 })
    run(e, [...off(4, 'camera'), ...off(8, 'screen')])
    expect(e.isFiring).toBe(false)
    e.setThresholdSeconds(5)
    expect(e.update({ ts: 1012, zone: 'screen' })).toBe('fire')
  })

  it('uses event timestamps, not the wall clock', () => {
    // Events one second apart in event-time fire as expected regardless of how fast we feed them.
    const t0 = performance.now()
    const result = run(engine, [...off(5, 'camera'), ...off(6, 'away')])
    expect(result).toContain('fire')
    expect(performance.now() - t0).toBeLessThan(500)
  })
})
