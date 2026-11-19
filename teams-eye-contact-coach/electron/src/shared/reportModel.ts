import { MAX_EVENT_GAP_S, ZONES, type Zone } from './hudModel'

/** Pure post-session report logic (tips, timeline, assembly). No Electron or database access. */

/** A session with less tracked time than this is not worth a report window. */
export const MIN_REPORT_SECONDS = 5
/** Below this much tracked time the numbers are too noisy to coach on. */
export const MIN_TIPS_SECONDS = 30
/** Minimum speaking time for the report to describe speaking time rather than the whole call. */
export const MIN_SPEAKING_SECONDS = 10
export const TIMELINE_BUCKETS = 40
const MAX_TIPS = 3

export type ReportBasis = 'speaking' | 'call'

export interface ZoneShare {
  seconds: number
  /** 0-100 */
  percent: number
}

/** Structural subset of the repository's breakdown (shared code must not import main). */
export interface BreakdownLike {
  trackedSeconds: number
  zones: Record<Zone, ZoneShare>
  cameraPercent: number
}

export interface SummaryLike extends BreakdownLike {
  subject: string | null
  trackingMode: string
  startedAt: number
  durationSeconds: number
  speaking: BreakdownLike
}

export interface TimelineEvent {
  /** Unix seconds */
  ts: number
  zone: Zone
  speaking: boolean
}

export interface Timeline {
  bucketSeconds: number
  /** Seconds spent in each zone within each equal slice of the session. */
  buckets: Record<Zone, number>[]
  longestOffCameraSeconds: number
}

export type TipLevel = 'good' | 'info' | 'improve'

export interface Tip {
  id: string
  level: TipLevel
  text: string
}

export interface ReportData {
  subject: string | null
  startedAt: number
  durationSeconds: number
  trackingMode: string
  basis: ReportBasis
  trackedSeconds: number
  cameraPercent: number
  zones: Record<Zone, ZoneShare>
  timeline: Timeline
  tips: Tip[]
  /** True when a dashboard URL is configured, so the report can link to it. */
  canViewHistory: boolean
}

export function shouldShowReport(summary: Pick<BreakdownLike, 'trackedSeconds'>): boolean {
  return summary.trackedSeconds >= MIN_REPORT_SECONDS
}

/** Speaking time when there is enough of it; otherwise the whole call. */
export function pickBasis(summary: Pick<SummaryLike, 'speaking'>): ReportBasis {
  return summary.speaking.trackedSeconds >= MIN_SPEAKING_SECONDS ? 'speaking' : 'call'
}

const emptyBuckets = (n: number): Record<Zone, number>[] =>
  Array.from({ length: n }, () => ({ camera: 0, screen: 0, away: 0 }))

/**
 * Splits the session into equal slices and sums the seconds spent in each zone. As in the
 * session summary, an event lasts until the next one, capped at MAX_EVENT_GAP_S, and the final
 * event contributes no time. With basis 'speaking' only events tagged speaking are counted.
 * Also finds the longest uninterrupted stretch spent off camera.
 */
export function buildTimeline(
  events: readonly TimelineEvent[],
  startedAt: number,
  durationSeconds: number,
  basis: ReportBasis,
  bucketCount = TIMELINE_BUCKETS
): Timeline {
  const sorted = [...events].sort((a, b) => a.ts - b.ts)
  const spans: { start: number; end: number; zone: Zone }[] = []
  let longest = 0
  let run = 0

  sorted.forEach((event, i) => {
    const next = sorted[i + 1]
    const gap = next ? next.ts - event.ts : 0
    const dur = Math.min(Math.max(gap, 0), MAX_EVENT_GAP_S)
    const counted = basis === 'call' || event.speaking

    if (counted && dur > 0) {
      const start = event.ts - startedAt
      spans.push({ start, end: start + dur, zone: event.zone })
    }
    if (counted && event.zone !== 'camera') {
      run += dur
      longest = Math.max(longest, run)
    } else {
      run = 0
    }
    if (gap > MAX_EVENT_GAP_S) run = 0 // untracked time breaks a stretch
  })

  const lastEnd = spans.reduce((max, s) => Math.max(max, s.end), 0)
  const total = Math.max(durationSeconds, lastEnd)
  if (total <= 0 || bucketCount < 1) {
    return { bucketSeconds: 0, buckets: [], longestOffCameraSeconds: longest }
  }

  const size = total / bucketCount
  const buckets = emptyBuckets(bucketCount)
  for (const span of spans) {
    const start = Math.max(0, span.start)
    const first = Math.min(bucketCount - 1, Math.floor(start / size))
    const last = Math.min(bucketCount - 1, Math.floor(Math.max(start, span.end - 1e-9) / size))
    for (let i = first; i <= last; i++) {
      const bucket = buckets[i]
      if (!bucket) continue
      const overlap = Math.min(span.end, (i + 1) * size) - Math.max(start, i * size)
      if (overlap > 0) bucket[span.zone] += overlap
    }
  }
  return { bucketSeconds: size, buckets, longestOffCameraSeconds: longest }
}

export interface TipInput {
  basis: ReportBasis
  trackedSeconds: number
  cameraPercent: number
  zones: Record<Zone, ZoneShare>
  longestOffCameraSeconds: number
}

/** Rule-based coaching: at most three tips, the most useful first. */
export function generateTips(input: TipInput): Tip[] {
  if (input.trackedSeconds < MIN_TIPS_SECONDS) {
    return [
      {
        id: 'too-short',
        level: 'info',
        text: 'This session was too short for coaching tips. Longer sessions give more reliable feedback.'
      }
    ]
  }

  const what = input.basis === 'speaking' ? 'your speaking time' : 'the call'
  const camera = Math.round(input.cameraPercent)
  const screen = Math.round(input.zones.screen.percent)
  const away = Math.round(input.zones.away.percent)
  const longest = Math.round(input.longestOffCameraSeconds)

  const improve: Tip[] = []
  if (screen >= 35) {
    improve.push({
      id: 'reading-screen',
      level: 'improve',
      text: `You spent ${screen}% of ${what} looking at your screen. If you are reading, try short bullet points, or put your notes next to the camera.`
    })
  }
  if (away >= 15) {
    improve.push({
      id: 'turned-away',
      level: 'improve',
      text: `Your face was turned away for ${away}% of ${what}. Check that your camera is at eye level, and face it when you make a key point.`
    })
  }
  if (longest >= 15) {
    improve.push({
      id: 'long-stretch',
      level: 'improve',
      text: `Your longest stretch away from the camera was ${longest} seconds. Try coming back to the camera at the end of each point.`
    })
  }

  const tips: Tip[] = []
  if (camera >= 70) {
    tips.push({
      id: 'strong',
      level: 'good',
      text: `Strong eye contact: you looked at the camera for ${camera}% of ${what}. Keep it up.`
    })
  }
  tips.push(...improve)
  // No warning fired, so screen < 35% and away < 15%: camera is necessarily over 50%.
  if (tips.length === 0) {
    tips.push({
      id: 'good-start',
      level: 'info',
      text: `You were on camera for ${camera}% of ${what}. To raise it, look at the camera as you open and close each point.`
    })
  }
  return tips.slice(0, MAX_TIPS)
}

/** Builds everything the report window shows. */
export function assembleReport(
  summary: SummaryLike,
  events: readonly TimelineEvent[],
  canViewHistory: boolean
): ReportData {
  const basis = pickBasis(summary)
  const breakdown = basis === 'speaking' ? summary.speaking : summary
  const timeline = buildTimeline(events, summary.startedAt, summary.durationSeconds, basis)
  const zones = Object.fromEntries(
    ZONES.map((z) => [
      z,
      { seconds: breakdown.zones[z].seconds, percent: breakdown.zones[z].percent }
    ])
  ) as Record<Zone, ZoneShare>

  return {
    subject: summary.subject,
    startedAt: summary.startedAt,
    durationSeconds: summary.durationSeconds,
    trackingMode: summary.trackingMode,
    basis,
    trackedSeconds: breakdown.trackedSeconds,
    cameraPercent: breakdown.cameraPercent,
    zones,
    timeline,
    tips: generateTips({
      basis,
      trackedSeconds: breakdown.trackedSeconds,
      cameraPercent: breakdown.cameraPercent,
      zones,
      longestOffCameraSeconds: timeline.longestOffCameraSeconds
    }),
    canViewHistory
  }
}
