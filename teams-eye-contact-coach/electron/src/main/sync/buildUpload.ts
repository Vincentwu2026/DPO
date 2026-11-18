import { MAX_EVENT_GAP_S, type Zone } from '../../shared/hudModel'
import type { SyncSource } from '../sessions/SessionRepository'

/** Mirrors the backend's upload schema (backend/src/schemas.ts). Speaking time only. */
export interface SessionUpload {
  id: string
  meetingId: string | null
  subject: string | null
  trackingMode: 'realtime' | 'postcall' | 'both'
  startedAt: number
  endedAt: number
  segments: { start: number; duration: number; zone: Zone }[]
}

/** Must stay in step with MAX_SEGMENTS on the server. */
export const MAX_UPLOAD_SEGMENTS = 20_000

/** Runs closer together than this are one segment (absorbs float noise). */
const JOIN_TOLERANCE_S = 0.05

const round3 = (n: number): number => Math.round(n * 1000) / 1000

/**
 * Turns raw gaze events into run-length encoded speaking-time segments, using the same timing
 * rules as the local summary: an event lasts until the next one (capped at MAX_EVENT_GAP_S), the
 * last event lasts nothing, and time counts as speaking when the event itself was tagged speaking.
 * Segment starts are relative to the session start so the server never depends on the client clock.
 */
export function buildUpload(source: SyncSource): SessionUpload {
  const { meta, events } = source
  const segments: SessionUpload['segments'] = []
  let lastEnd = 0

  for (let i = 0; i < events.length - 1; i++) {
    const e = events[i]
    const next = events[i + 1]
    if (!e || !next || !e.speaking) continue

    const rawStart = e.ts - meta.startedAt
    const rawDuration = Math.min(next.ts - e.ts, MAX_EVENT_GAP_S)
    // Clamp to the session: nothing before its start, nothing before the previous segment's end.
    const start = round3(Math.max(rawStart, 0, lastEnd))
    const end = round3(Math.min(rawStart + rawDuration, meta.endedAt - meta.startedAt))
    const duration = round3(end - start)
    if (duration <= 0) continue

    const prev = segments[segments.length - 1]
    if (prev && prev.zone === e.zone && start - (prev.start + prev.duration) <= JOIN_TOLERANCE_S) {
      prev.duration = round3(end - prev.start)
    } else {
      segments.push({ start, duration, zone: e.zone })
    }
    lastEnd = end
  }

  return {
    id: meta.id,
    meetingId: meta.meetingId,
    subject: meta.subject,
    trackingMode: meta.trackingMode,
    startedAt: meta.startedAt,
    endedAt: meta.endedAt,
    segments
  }
}
