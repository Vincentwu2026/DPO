/** Pure gaze analysis used by the API. All data here is speaking time only. */

export const ZONES = ['camera', 'screen', 'away'] as const
export type Zone = (typeof ZONES)[number]

/**
 * A contiguous stretch of speaking time spent looking at one zone. `start` is seconds since the
 * session started, so the data does not depend on the client's clock.
 */
export interface Segment {
  start: number
  duration: number
  zone: Zone
}

export interface TimelineSegment {
  start: number
  end: number
  zone: Zone
}

export type ZoneSeconds = Record<Zone, number>

export interface ZoneShare {
  seconds: number
  /** Share of speaking time, 0–100 */
  percent: number
}

export interface Breakdown {
  speakingSeconds: number
  zones: Record<Zone, ZoneShare>
  cameraPercent: number
}

export const emptyZoneSeconds = (): ZoneSeconds => ({ camera: 0, screen: 0, away: 0 })

export function sumZones(segments: readonly Pick<Segment, 'zone' | 'duration'>[]): ZoneSeconds {
  const totals = emptyZoneSeconds()
  for (const s of segments) totals[s.zone] += s.duration
  return totals
}

export function breakdown(seconds: ZoneSeconds): Breakdown {
  const speakingSeconds = ZONES.reduce((sum, z) => sum + seconds[z], 0)
  const share = (z: Zone): ZoneShare => ({
    seconds: seconds[z],
    percent: speakingSeconds > 0 ? (seconds[z] / speakingSeconds) * 100 : 0
  })
  const zones = { camera: share('camera'), screen: share('screen'), away: share('away') }
  return { speakingSeconds, zones, cameraPercent: zones.camera.percent }
}

export const toTimeline = (segments: readonly Segment[]): TimelineSegment[] =>
  segments.map((s) => ({ start: s.start, end: s.start + s.duration, zone: s.zone }))

/** Segments must be ordered and must not overlap (rounding slack allows for float noise). */
export function segmentsAreConsistent(segments: readonly Segment[]): boolean {
  let end = 0
  for (const s of segments) {
    if (s.start < end - 0.01) return false
    end = s.start + s.duration
  }
  return true
}
