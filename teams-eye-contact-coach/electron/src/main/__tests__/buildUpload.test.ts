import { describe, expect, it } from 'vitest'
import type { SyncSource } from '../sessions/SessionRepository'
import { buildUpload } from '../sync/buildUpload'

const START = 1_800_000_000

function source(
  events: [number, 'camera' | 'screen' | 'away', boolean][],
  endedAt = START + 600
): SyncSource {
  return {
    meta: {
      id: 'c0ffee00-0000-4000-8000-000000000001',
      meetingId: 'm1',
      subject: 'Sync',
      trackingMode: 'realtime',
      startedAt: START,
      endedAt
    },
    events: events.map(([offset, zone, speaking]) => ({ ts: START + offset, zone, speaking }))
  }
}

describe('buildUpload', () => {
  it('keeps session metadata and emits no segments when nobody spoke', () => {
    const up = buildUpload(
      source([
        [0, 'camera', false],
        [1, 'screen', false],
        [2, 'away', false]
      ])
    )
    expect(up).toMatchObject({ id: 'c0ffee00-0000-4000-8000-000000000001', subject: 'Sync' })
    expect(up.segments).toEqual([])
  })

  it('credits each speaking event with the time until the next, capped at 2 s', () => {
    const up = buildUpload(
      source([
        [10, 'camera', true],
        [11, 'screen', true],
        [20, 'away', true], // 9 s gap: only 2 s credited to the screen event
        [21, 'camera', true] // last event contributes no time
      ])
    )
    expect(up.segments).toEqual([
      { start: 10, duration: 1, zone: 'camera' },
      { start: 11, duration: 2, zone: 'screen' },
      { start: 20, duration: 1, zone: 'away' }
    ])
  })

  it('merges adjacent same-zone events into one run', () => {
    const events: [number, 'camera' | 'screen' | 'away', boolean][] = []
    for (let i = 0; i < 30; i++) events.push([5 + i / 30, 'camera', true])
    events.push([6, 'screen', true], [7, 'screen', true])
    const up = buildUpload(source(events))
    expect(up.segments).toHaveLength(2)
    expect(up.segments[0]).toMatchObject({ start: 5, zone: 'camera' })
    expect(up.segments[0]?.duration).toBeCloseTo(1, 2)
    expect(up.segments[1]).toEqual({ start: 6, duration: 1, zone: 'screen' })
  })

  it('splits runs when speaking pauses, and skips non-speaking time', () => {
    const up = buildUpload(
      source([
        [0, 'camera', true],
        [1, 'camera', false],
        [2, 'camera', false],
        [3, 'camera', true],
        [4, 'camera', true]
      ])
    )
    expect(up.segments).toEqual([
      { start: 0, duration: 1, zone: 'camera' },
      { start: 3, duration: 1, zone: 'camera' }
    ])
  })

  it('never produces segments outside the session', () => {
    const up = buildUpload(
      source(
        [
          [-5, 'camera', true], // clock skew: before the start
          [1, 'screen', true],
          [9, 'away', true],
          [11, 'away', true]
        ],
        START + 10
      )
    )
    for (const s of up.segments) {
      expect(s.start).toBeGreaterThanOrEqual(0)
      expect(s.start + s.duration).toBeLessThanOrEqual(10)
      expect(s.duration).toBeGreaterThan(0)
    }
  })

  it('produces ordered, non-overlapping segments', () => {
    const events: [number, 'camera' | 'screen' | 'away', boolean][] = []
    const zones = ['camera', 'screen', 'away'] as const
    for (let i = 0; i < 200; i++) events.push([i * 0.37, zones[i % 3] ?? 'camera', i % 7 !== 0])
    const up = buildUpload(source(events))
    let end = 0
    for (const s of up.segments) {
      expect(s.start).toBeGreaterThanOrEqual(end - 1e-9)
      end = s.start + s.duration
    }
  })

  it('handles empty and single-event sessions', () => {
    expect(buildUpload(source([])).segments).toEqual([])
    expect(buildUpload(source([[0, 'camera', true]])).segments).toEqual([])
  })

  it('totals match the local speaking breakdown rules', () => {
    const up = buildUpload(
      source([
        [0, 'camera', true],
        [1, 'camera', true],
        [2, 'screen', true],
        [3, 'screen', false],
        [4, 'away', true],
        [5, 'away', true]
      ])
    )
    const total = (z: string): number =>
      up.segments.filter((s) => s.zone === z).reduce((n, s) => n + s.duration, 0)
    expect(total('camera')).toBe(2)
    expect(total('screen')).toBe(1)
    expect(total('away')).toBe(1)
  })
})
