import { buildUpload, MAX_UPLOAD_SEGMENTS } from './buildUpload'
import type { SyncSource } from '../sessions/SessionRepository'

/** The slice of SessionRepository the sync service needs (lets tests use a fake). */
export interface SyncStore {
  listUnsyncedSessionIds(): Promise<string[]>
  getSyncSource(sessionId: string): Promise<SyncSource | null>
  markSynced(sessionId: string): Promise<void>
}

export interface SyncServiceOptions {
  store: SyncStore
  /** Base URL of the dashboard API, e.g. https://coach-api.example.com */
  apiBaseUrl: string
  /** Delegated scope for the API, e.g. api://<client-id>/Sessions.ReadWrite */
  scope: string
  /** Silent token for `scope`; null when the user is signed out. Must never open UI. */
  getToken: (scopes: string[]) => Promise<string | null>
  fetch?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  /** Attempts per session within one sync, including the first. Default 3. */
  maxAttempts?: number
  /** First back-off delay; doubles each retry. Default 1000 ms. */
  baseDelayMs?: number
  requestTimeoutMs?: number
}

export type SyncOutcome = 'synced' | 'skipped' | 'retry-later' | 'rejected'

const defaultSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Throws unless the URL is HTTPS (plain HTTP only for loopback development). */
export function parseApiBaseUrl(raw: string): string {
  const url = new URL(raw)
  const loopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('API_BASE_URL must use https')
  }
  return url.origin
}

/**
 * Uploads closed sessions (speaking-time segments only) to the cloud API. Idempotent on the
 * server, so a retry after an ambiguous failure never creates a duplicate.
 */
export class SyncService {
  private readonly fetchFn: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly maxAttempts: number
  private readonly baseDelayMs: number
  private readonly timeoutMs: number
  private readonly endpoint: string
  /** Sessions the server refused outright; not retried until the app restarts. */
  private readonly rejected = new Set<string>()
  private running: Promise<void> = Promise.resolve()

  constructor(private readonly options: SyncServiceOptions) {
    this.fetchFn = options.fetch ?? fetch
    this.sleep = options.sleep ?? defaultSleep
    this.maxAttempts = options.maxAttempts ?? 3
    this.baseDelayMs = options.baseDelayMs ?? 1000
    this.timeoutMs = options.requestTimeoutMs ?? 15_000
    this.endpoint = `${parseApiBaseUrl(options.apiBaseUrl)}/api/sessions`
  }

  /** Uploads one session. Calls are queued so uploads never overlap. */
  syncSession(sessionId: string): Promise<SyncOutcome> {
    const result = this.running.then(() => this.upload(sessionId))
    this.running = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  /** Uploads every closed session not yet synced (startup, sign-in, back online). */
  async syncPending(): Promise<SyncOutcome[]> {
    const ids = await this.options.store.listUnsyncedSessionIds()
    const outcomes: SyncOutcome[] = []
    for (const id of ids) outcomes.push(await this.syncSession(id))
    return outcomes
  }

  private async upload(sessionId: string): Promise<SyncOutcome> {
    if (this.rejected.has(sessionId)) return 'rejected'
    const source = await this.options.store.getSyncSource(sessionId)
    if (!source) return 'skipped'

    const body = buildUpload(source)
    if (body.segments.length > MAX_UPLOAD_SEGMENTS) {
      this.rejected.add(sessionId)
      return 'rejected'
    }
    const payload = JSON.stringify(body)

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      // A fresh silent token each attempt: it may have expired during back-off.
      const token = await this.options.getToken([this.options.scope])
      if (!token) return 'retry-later' // signed out; try again after the next sign-in

      const status = await this.post(payload, token)
      if (status === 200 || status === 201) {
        await this.options.store.markSynced(sessionId)
        return 'synced'
      }
      if (status !== null && !isRetryable(status)) {
        // 400/413: the server will never accept this payload. 401/403: re-auth or consent needed.
        if (status === 401 || status === 403) return 'retry-later'
        this.rejected.add(sessionId)
        return 'rejected'
      }
      if (attempt < this.maxAttempts) await this.sleep(this.baseDelayMs * 2 ** (attempt - 1))
    }
    return 'retry-later'
  }

  /** Returns the HTTP status, or null on a network error/timeout. Never logs the body or token. */
  private async post(payload: string, token: string): Promise<number | null> {
    try {
      const res = await this.fetchFn(this.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: payload,
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error'
      })
      return res.status
    } catch {
      return null
    }
  }
}

const isRetryable = (status: number): boolean =>
  status === 408 || status === 429 || (status >= 500 && status <= 599)
