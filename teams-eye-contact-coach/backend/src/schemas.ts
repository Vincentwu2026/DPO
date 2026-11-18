import { z } from 'zod'
import { ZONES, segmentsAreConsistent } from './analysis.js'

/** Upper bound on one session. Anything longer is rejected rather than stored. */
const MAX_SESSION_S = 24 * 60 * 60
export const MAX_SEGMENTS = 20_000

const unixSeconds = z.number().finite().min(0).max(4_102_444_800) // up to year 2100

const segmentSchema = z.strictObject({
  start: z.number().finite().min(0).max(MAX_SESSION_S),
  duration: z.number().finite().gt(0).max(MAX_SESSION_S),
  zone: z.enum(ZONES)
})

export const sessionUploadSchema = z
  .strictObject({
    /** Generated on the device; makes the upload idempotent per user. */
    id: z.uuid(),
    meetingId: z.string().min(1).max(512).nullable().optional(),
    subject: z.string().max(500).nullable().optional(),
    trackingMode: z.enum(['realtime', 'postcall', 'both']),
    startedAt: unixSeconds,
    endedAt: unixSeconds,
    /** Speaking-time segments only. */
    segments: z.array(segmentSchema).max(MAX_SEGMENTS)
  })
  .refine((s) => s.endedAt >= s.startedAt && s.endedAt - s.startedAt <= MAX_SESSION_S, {
    message: 'invalid session length',
    path: ['endedAt']
  })
  .refine((s) => segmentsAreConsistent(s.segments), {
    message: 'segments overlap or are out of order',
    path: ['segments']
  })
  .refine(
    (s) => s.segments.every((seg) => seg.start + seg.duration <= s.endedAt - s.startedAt + 1),
    { message: 'segment outside the session', path: ['segments'] }
  )

export type SessionUpload = z.infer<typeof sessionUploadSchema>

export const sessionIdSchema = z.uuid()

export const listQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Cursor: only sessions that started before this unix time (seconds). */
  before: z.coerce.number().finite().min(0).optional()
})
