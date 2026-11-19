import { describe, expect, it } from 'vitest'
import type { SessionItem } from '../src/api'
import {
  bucketTimeline,
  formatDuration,
  formatPercent,
  toTrend,
  trendDelta,
  type TrendPoint
} from '../src/lib'

const item = (over: Partial<SessionItem>): SessionItem => ({
  id: '11111111-1111-4111-8111-111111111111',
  meetingId: null,
  subject: null,
  trackingMode: 'both',
  startedAt: 1000,
  endedAt: 2000,
  durationSeconds: 1000,
  speakingSeconds: 100,
  zones: {
    camera: { seconds: 50, percent: 50 },
    screen: { seconds: 30, percent: 30 },
    away: { seconds: 20, percent: 20 }
  },
  cameraPercent: 50,
  ...over
})

describe('formatDuration', () => {
  it('formats seconds, minutes and hours', () => {
    expect(formatDuration(0)).toBe('0s')
    expect(formatDuration(45)).toBe('45s')
    expect(formatDuration(125)).toBe('2m 05s')
    expect(formatDuration(3725)).toBe('1h 2m')
  })

  it('clamps negatives to zero', () => {
    expect(formatDuration(-5)).toBe('0s')
  })
})

describe('formatPercent', () => {
  it('rounds to a whole percent', () => {
    expect(formatPercent(66.6)).toBe('67%')
  })
})

describe('bucketTimeline', () => {
  it('returns nothing for an empty session', () => {
    expect(bucketTimeline([], 0)).toEqual([])
  })

  it('sums seconds per zone and conserves total time', () => {
    const timeline = [
      { start: 0, end: 30, zone: 'camera' as const },
      { start: 30, end: 50, zone: 'screen' as const },
      { start: 50, end: 60, zone: 'away' as const }
    ]
    const buckets = bucketTimeline(timeline, 60, 6)
    expect(buckets).toHaveLength(6)
    const total = (z: 'camera' | 'screen' | 'away') => buckets.reduce((s, b) => s + b[z], 0)
    expect(total('camera')).toBeCloseTo(30)
    expect(total('screen')).toBeCloseTo(20)
    expect(total('away')).toBeCloseTo(10)
    expect(buckets[0]?.camera).toBeCloseTo(10)
  })

  it('splits a segment that straddles a bucket boundary', () => {
    const buckets = bucketTimeline([{ start: 5, end: 15, zone: 'screen' }], 20, 2)
    expect(buckets[0]?.screen).toBeCloseTo(5)
    expect(buckets[1]?.screen).toBeCloseTo(5)
  })

  it('extends the range if a segment ends after the stated duration', () => {
    const buckets = bucketTimeline([{ start: 0, end: 10, zone: 'camera' }], 5, 2)
    expect(buckets.reduce((s, b) => s + b.camera, 0)).toBeCloseTo(10)
  })
})

describe('toTrend', () => {
  it('drops sessions without speaking time and sorts oldest first', () => {
    const trend = toTrend([
      item({ id: 'b', startedAt: 300, cameraPercent: 80 }),
      item({ id: 'silent', startedAt: 200, speakingSeconds: 0, cameraPercent: 0 }),
      item({ id: 'a', startedAt: 100, cameraPercent: 40 })
    ])
    expect(trend.map((p) => p.id)).toEqual(['a', 'b'])
  })
})

describe('trendDelta', () => {
  const points = (values: number[]): TrendPoint[] =>
    values.map((v, i) => ({ id: String(i), startedAt: i, cameraPercent: v }))

  it('needs at least four points', () => {
    expect(trendDelta(points([10, 20, 30]))).toBeNull()
  })

  it('compares the last third to the first third', () => {
    expect(trendDelta(points([20, 20, 50, 50, 60, 60]))).toBeCloseTo(40)
    expect(trendDelta(points([60, 60, 50, 50, 20, 20]))).toBeCloseTo(-40)
  })
})
