import { describe, expect, it } from 'vitest'
import {
  coachingHint,
  formatElapsed,
  GazeAccumulator,
  gaugeDashOffset,
  MAX_EVENT_GAP_S,
  NUDGE_AFTER_S,
  OffCameraTimer
} from '../../shared/hudModel'

describe('GazeAccumulator', () => {
  it('reports null until time has been tracked', () => {
    const acc = new GazeAccumulator()
    expect(acc.cameraPercent).toBeNull()
    acc.add({ ts: 10, zone: 'camera' })
    expect(acc.cameraPercent).toBeNull() // a single event covers no time yet
    expect(acc.currentZone).toBe('camera')
  })

  it('computes time-weighted camera percentage', () => {
    const acc = new GazeAccumulator()
    ;(
      [
        [0, 'camera'],
        [1, 'camera'],
        [2, 'screen'],
        [3, 'away'],
        [4, 'camera']
      ] as const
    ).forEach(([ts, zone]) => acc.add({ ts, zone }))
    expect(acc.trackedSeconds).toBe(4)
    expect(acc.cameraPercent).toBe(25 + 25) // camera 0-2 of 4 s
  })

  it('caps gaps and ignores out-of-order timestamps', () => {
    const acc = new GazeAccumulator()
    acc.add({ ts: 0, zone: 'camera' })
    acc.add({ ts: 100, zone: 'screen' })
    expect(acc.trackedSeconds).toBe(MAX_EVENT_GAP_S)
    acc.add({ ts: 50, zone: 'away' }) // earlier than the last event
    expect(acc.trackedSeconds).toBe(MAX_EVENT_GAP_S)
  })

  it('reports the share of time in each zone, or null before any tracking', () => {
    const acc = new GazeAccumulator()
    expect(acc.zonePercents).toBeNull()
    ;(
      [
        [0, 'camera'],
        [1, 'screen'],
        [2, 'screen'],
        [3, 'away'],
        [4, 'away']
      ] as const
    ).forEach(([ts, zone]) => acc.add({ ts, zone }))
    expect(acc.zonePercents).toEqual({ camera: 25, screen: 50, away: 25 })
  })

  it('reset clears everything', () => {
    const acc = new GazeAccumulator()
    acc.add({ ts: 0, zone: 'camera' })
    acc.add({ ts: 1, zone: 'camera' })
    acc.reset()
    expect(acc.cameraPercent).toBeNull()
    expect(acc.currentZone).toBeNull()
  })
})

describe('formatElapsed', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [5_000, '0:05'],
    [65_000, '1:05'],
    [3_599_000, '59:59'],
    [3_600_000, '1:00:00'],
    [3_723_000, '1:02:03'],
    [-5, '0:00'],
    [NaN, '0:00']
  ])('%d ms -> %s', (ms, text) => expect(formatElapsed(ms)).toBe(text))
})

describe('gaugeDashOffset', () => {
  it('maps percent to the undrawn part of the circle', () => {
    expect(gaugeDashOffset(0, 100)).toBe(100)
    expect(gaugeDashOffset(50, 100)).toBe(50)
    expect(gaugeDashOffset(100, 100)).toBe(0)
  })
  it('clamps and handles null/NaN', () => {
    expect(gaugeDashOffset(150, 100)).toBe(0)
    expect(gaugeDashOffset(-10, 100)).toBe(100)
    expect(gaugeDashOffset(null, 100)).toBe(100)
    expect(gaugeDashOffset(NaN, 100)).toBe(100)
  })
})

describe('coachingHint', () => {
  it('praises eye contact and waits for the first event', () => {
    expect(coachingHint(null, 0, false)).toEqual({ text: 'Waiting for camera', level: 'idle' })
    expect(coachingHint('camera', 0, false)).toEqual({ text: 'Good eye contact', level: 'good' })
  })

  it('stays calm for a short glance, then nudges', () => {
    expect(coachingHint('screen', 0.5, false).level).toBe('idle')
    expect(coachingHint('screen', NUDGE_AFTER_S, false)).toEqual({
      text: 'Look at the camera',
      level: 'nudge'
    })
  })

  it('tells someone who turned away to face the camera', () => {
    expect(coachingHint('away', 0.1, false).text).toBe('Face the camera')
    expect(coachingHint('away', 3, false).level).toBe('nudge')
  })

  it('escalates to an alert, which wins over the nudge', () => {
    expect(coachingHint('screen', 6, true)).toEqual({
      text: 'Look at the camera now',
      level: 'alert'
    })
  })

  it('never shows an alert hint while on camera', () => {
    expect(coachingHint('camera', 0, true).level).toBe('good')
  })
})

describe('OffCameraTimer', () => {
  it('counts consecutive off-camera time and resets on camera', () => {
    const t = new OffCameraTimer()
    expect(t.update(10, 'camera')).toBe(0)
    expect(t.update(11, 'screen')).toBe(0)
    expect(t.update(12.5, 'away')).toBeCloseTo(1.5)
    expect(t.update(13, 'camera')).toBe(0)
    expect(t.update(14, 'screen')).toBe(0)
  })

  it('reset() forgets the current look-away', () => {
    const t = new OffCameraTimer()
    t.update(1, 'screen')
    t.reset()
    expect(t.update(5, 'screen')).toBe(0)
  })
})
