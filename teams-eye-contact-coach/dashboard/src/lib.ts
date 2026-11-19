import type { SessionItem, Zone } from './api'

export const ZONE_COLORS: Record<Zone, string> = {
  camera: '#2e9e5b',
  screen: '#e0a100',
  away: '#d64545'
}

export const ZONE_LABELS: Record<Zone, string> = {
  camera: 'Camera',
  screen: 'Screen',
  away: 'Away'
}

export const ZONE_ORDER: readonly Zone[] = ['camera', 'screen', 'away']

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${sec.toString().padStart(2, '0')}s`
  return `${sec}s`
}

export const formatPercent = (value: number): string => `${Math.round(value)}%`

export function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })
}

export interface TimelineBucket {
  /** Bucket start, seconds since the session began. */
  start: number
  camera: number
  screen: number
  away: number
}

export interface TimelineSegmentLike {
  start: number
  end: number
  zone: Zone
}

/**
 * Splits the session into equal buckets and sums, per bucket, how many seconds of speaking time
 * were spent in each zone. Segments that straddle a bucket boundary are divided between buckets.
 */
export function bucketTimeline(
  timeline: readonly TimelineSegmentLike[],
  durationSeconds: number,
  bucketCount = 40
): TimelineBucket[] {
  const total = Math.max(durationSeconds, ...timeline.map((s) => s.end), 0)
  if (total <= 0 || bucketCount < 1) return []
  const size = total / bucketCount
  const buckets: TimelineBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    start: i * size,
    camera: 0,
    screen: 0,
    away: 0
  }))
  for (const seg of timeline) {
    const first = Math.min(bucketCount - 1, Math.floor(seg.start / size))
    const last = Math.min(bucketCount - 1, Math.floor(Math.max(seg.start, seg.end - 1e-9) / size))
    for (let i = first; i <= last; i++) {
      const bucket = buckets[i]
      if (!bucket) continue
      const overlap = Math.min(seg.end, bucket.start + size) - Math.max(seg.start, bucket.start)
      if (overlap > 0) bucket[seg.zone] += overlap
    }
  }
  return buckets
}

export interface TrendPoint {
  id: string
  startedAt: number
  cameraPercent: number
}

/** Oldest first, and only sessions in which the user actually spoke (otherwise 0% is meaningless). */
export function toTrend(sessions: readonly SessionItem[]): TrendPoint[] {
  return sessions
    .filter((s) => s.speakingSeconds > 0)
    .map((s) => ({ id: s.id, startedAt: s.startedAt, cameraPercent: s.cameraPercent }))
    .sort((a, b) => a.startedAt - b.startedAt)
}

/** Change between the average of the first and last third of points, in percentage points. */
export function trendDelta(points: readonly TrendPoint[]): number | null {
  if (points.length < 4) return null
  const n = Math.max(1, Math.floor(points.length / 3))
  const avg = (xs: readonly TrendPoint[]): number =>
    xs.reduce((sum, p) => sum + p.cameraPercent, 0) / xs.length
  return avg(points.slice(-n)) - avg(points.slice(0, n))
}
