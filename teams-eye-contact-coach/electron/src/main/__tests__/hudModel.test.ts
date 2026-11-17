import { describe, expect, it } from 'vitest'
import {
  formatElapsed,
  GazeAccumulator,
  gaugeDashOffset,
  MAX_EVENT_GAP_S
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
