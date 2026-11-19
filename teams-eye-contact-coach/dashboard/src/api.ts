import { z } from 'zod'

const zone = z.enum(['camera', 'screen', 'away'])
export type Zone = z.infer<typeof zone>

const zoneShare = z.object({ seconds: z.number(), percent: z.number() })

const sessionItem = z.object({
  id: z.uuid(),
  meetingId: z.string().nullable(),
  subject: z.string().nullable(),
  trackingMode: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  durationSeconds: z.number(),
  speakingSeconds: z.number(),
  zones: z.object({ camera: zoneShare, screen: zoneShare, away: zoneShare }),
  cameraPercent: z.number()
})
export type SessionItem = z.infer<typeof sessionItem>

const sessionDetail = sessionItem.extend({
  timeline: z.array(z.object({ start: z.number(), end: z.number(), zone }))
})
export type SessionDetail = z.infer<typeof sessionDetail>

const listResponse = z.object({ sessions: z.array(sessionItem) })

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`Request failed (${status})`)
  }
}

export type TokenProvider = () => Promise<string>

export interface ApiClient {
  listSessions(limit?: number, before?: number): Promise<SessionItem[]>
  getSession(id: string): Promise<SessionDetail>
}

const TIMEOUT_MS = 15_000

export function createApiClient(baseUrl: string, getToken: TokenProvider): ApiClient {
  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T> {
    const token = await getToken()
    const res = await fetch(`${baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) throw new ApiError(res.status)
    // A response that does not match the contract is treated as a failure, not rendered.
    const parsed = schema.safeParse(await res.json())
    if (!parsed.success) throw new ApiError(502)
    return parsed.data
  }

  return {
    async listSessions(limit = 100, before) {
      const params = new URLSearchParams({ limit: String(limit) })
      if (before !== undefined) params.set('before', String(before))
      return (await get(`/api/sessions?${params.toString()}`, listResponse)).sessions
    },
    getSession(id) {
      return get(`/api/sessions/${encodeURIComponent(id)}`, sessionDetail)
    }
  }
}
