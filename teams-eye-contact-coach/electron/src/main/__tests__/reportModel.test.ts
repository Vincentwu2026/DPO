import { describe, expect, it } from 'vitest'
import {
  MIN_REPORT_SECONDS,
  assembleReport,
  buildTimeline,
  generateTips,
  pickBasis,
  shouldShowReport,
  type BreakdownLike,
  type SummaryLike,
  type TimelineEvent,
  type TipInput
} from '../../shared/reportModel'
import type { Zone } from '../../shared/hudModel'

const zones = (camera: number, screen: number, away: number): TipInput['zones'] => {
  const total = camera + screen + away
  const share = (seconds: number) => ({ seconds, percent: total ? (seconds / total) * 100 : 0 })
  return { camera: share(camera), screen: share(screen), away: share(away) }
}

const tipInput = (camera: number, screen: number, away: number, longest = 0): TipInput => {
  const z = zones(camera, screen, away)
  return {
    basis: 'speaking',
    trackedSeconds: camera + screen + away,
    cameraPercent: z.camera.percent,
    zones: z,
    longestOffCameraSeconds: longest
  }
}

const breakdown = (camera: number, screen: number, away: number): BreakdownLike => {
  const z = zones(camera, screen, away)
  return { trackedSeconds: camera + screen + away, zones: z, cameraPercent: z.camera.percent }
}

/** One event per second, so each lasts exactly 1 s. */
const events = (zonesBySecond: Zone[], speaking = true, start = 1000): TimelineEvent[] =>
  zonesBySecond.map((zone, i) => ({ ts: start + i, zone, speaking }))

describe('generateTips', () => {
  it('declines to coach on a short session', () => {
    expect(generateTips(tipInput(5, 5, 5))).toMatchInlineSnapshot(`
      [
        {
          "id": "too-short",
          "level": "info",
          "text": "This session was too short for coaching tips. Longer sessions give more reliable feedback.",
        },
      ]
    `)
  })

  it('praises strong eye contact', () => {
    expect(generateTips(tipInput(80, 10, 10))).toMatchInlineSnapshot(`
      [
        {
          "id": "strong",
          "level": "good",
          "text": "Strong eye contact: you looked at the camera for 80% of your speaking time. Keep it up.",
        },
      ]
    `)
  })

  it('flags reading from the screen', () => {
    expect(generateTips(tipInput(30, 60, 10))).toMatchInlineSnapshot(`
      [
        {
          "id": "reading-screen",
          "level": "improve",
          "text": "You spent 60% of your speaking time looking at your screen. If you are reading, try short bullet points, or put your notes next to the camera.",
        },
      ]
    `)
  })

  it('flags turning away and long stretches, with the strongest message first', () => {
    const tips = generateTips(tipInput(40, 20, 40, 22))
    expect(tips.map((t) => t.id)).toEqual(['turned-away', 'long-stretch'])
    expect(tips[1]?.text).toContain('22 seconds')
  })

  it('never returns more than three tips', () => {
    expect(generateTips(tipInput(30, 36, 34, 30))).toHaveLength(3)
  })

  it('talks about "the call" instead of speaking time on the whole-call basis', () => {
    const tips = generateTips({ ...tipInput(30, 60, 10), basis: 'call' })
    expect(tips[0]?.text).toContain('of the call')
    expect(tips[0]?.text).not.toContain('speaking time')
  })

  it('always gives at least one tip for a long enough session', () => {
    // Anything that triggers no warning has more than 50% camera, so a gentle tip is given.
    for (const [c, s, a] of [
      [60, 30, 10],
      [56, 30, 14],
      [51, 34, 14]
    ] as const) {
      expect(generateTips(tipInput(c, s, a)).length).toBeGreaterThan(0)
    }
    expect(generateTips(tipInput(60, 30, 10)).map((t) => t.id)).toEqual(['good-start'])
  })
})

describe('shouldShowReport / pickBasis', () => {
  it('needs a few seconds of tracked time', () => {
    expect(shouldShowReport({ trackedSeconds: MIN_REPORT_SECONDS - 1 })).toBe(false)
    expect(shouldShowReport({ trackedSeconds: MIN_REPORT_SECONDS })).toBe(true)
  })

  it('uses speaking time only when there is enough of it', () => {
    expect(pickBasis({ speaking: breakdown(8, 0, 0) })).toBe('call')
    expect(pickBasis({ speaking: breakdown(10, 0, 0) })).toBe('speaking')
  })
})

describe('buildTimeline', () => {
  it('conserves tracked time and splits it by zone', () => {
    const evts = events([
      ...Array<Zone>(10).fill('camera'),
      ...Array<Zone>(6).fill('screen'),
      ...Array<Zone>(4).fill('away'),
      'camera' // the last event contributes no time
    ])
    const t = buildTimeline(evts, 1000, 20, 'call', 4)
    const sum = (z: Zone) => t.buckets.reduce((s, b) => s + b[z], 0)
    expect(t.buckets).toHaveLength(4)
    expect(sum('camera')).toBeCloseTo(10)
    expect(sum('screen')).toBeCloseTo(6)
    expect(sum('away')).toBeCloseTo(4)
  })

  it('counts only speaking events on the speaking basis', () => {
    const mixed = [
      ...events(Array<Zone>(5).fill('camera'), false, 1000),
      ...events(Array<Zone>(5).fill('screen'), true, 1005)
    ]
    const t = buildTimeline(mixed, 1000, 10, 'speaking', 2)
    const sum = (z: Zone) => t.buckets.reduce((s, b) => s + b[z], 0)
    expect(sum('camera')).toBe(0)
    expect(sum('screen')).toBeCloseTo(4) // the final event contributes no time
  })

  it('measures the longest off-camera stretch and resets it on return', () => {
    const evts = events([
      'camera',
      'screen',
      'screen',
      'away',
      'camera',
      'screen',
      'camera',
      'camera'
    ])
    expect(buildTimeline(evts, 1000, 8, 'call').longestOffCameraSeconds).toBe(3)
  })

  it('does not count a recording gap as time or as an off-camera stretch', () => {
    const evts: TimelineEvent[] = [
      { ts: 1000, zone: 'screen', speaking: true },
      { ts: 1001, zone: 'screen', speaking: true },
      { ts: 1100, zone: 'screen', speaking: true },
      { ts: 1101, zone: 'camera', speaking: true }
    ]
    const t = buildTimeline(evts, 1000, 101, 'call', 10)
    expect(t.buckets.reduce((s, b) => s + b.screen, 0)).toBeCloseTo(1 + 2 + 1)
    expect(t.longestOffCameraSeconds).toBeLessThanOrEqual(3)
  })

  it('handles an empty session', () => {
    expect(buildTimeline([], 1000, 0, 'call')).toEqual({
      bucketSeconds: 0,
      buckets: [],
      longestOffCameraSeconds: 0
    })
  })
})

describe('assembleReport', () => {
  const summary = (speaking: BreakdownLike): SummaryLike => ({
    ...breakdown(30, 20, 10),
    subject: 'Weekly sync',
    trackingMode: 'both',
    startedAt: 1000,
    durationSeconds: 60,
    speaking
  })

  it('reports speaking time when the user spoke', () => {
    const report = assembleReport(summary(breakdown(20, 5, 5)), events(['camera']), true)
    expect(report.basis).toBe('speaking')
    expect(report.trackedSeconds).toBe(30)
    expect(report.cameraPercent).toBeCloseTo((20 / 30) * 100)
    expect(report.canViewHistory).toBe(true)
  })

  it('falls back to the whole call when the user barely spoke', () => {
    const report = assembleReport(summary(breakdown(2, 0, 0)), events(['camera']), false)
    expect(report.basis).toBe('call')
    expect(report.trackedSeconds).toBe(60)
    expect(report.subject).toBe('Weekly sync')
    expect(report.canViewHistory).toBe(false)
  })
})
