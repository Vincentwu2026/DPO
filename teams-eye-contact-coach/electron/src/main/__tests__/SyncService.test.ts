import { describe, expect, it, vi } from 'vitest'
import type { SyncSource } from '../sessions/SessionRepository'
import { parseApiBaseUrl, SyncService, type SyncStore } from '../sync/SyncService'

const SCOPE = 'api://abc/Sessions.ReadWrite'

const source = (id: string): SyncSource => ({
  meta: {
    id,
    meetingId: null,
    subject: 'Secret subject',
    trackingMode: 'realtime',
    startedAt: 1000,
    endedAt: 1100
  },
  events: [
    { ts: 1010, zone: 'camera', speaking: true },
    { ts: 1011, zone: 'camera', speaking: true }
  ]
})

function fakeStore(ids: string[]): SyncStore & { synced: string[] } {
  const synced: string[] = []
  return {
    synced,
    listUnsyncedSessionIds: async () => ids.filter((i) => !synced.includes(i)),
    getSyncSource: async (id) => (ids.includes(id) ? source(id) : null),
    markSynced: async (id) => {
      synced.push(id)
    }
  }
}

const respond = (status: number): Response => new Response('{}', { status })

function make(opts: {
  store?: ReturnType<typeof fakeStore>
  responses: (Response | Error)[]
  token?: string | null
}) {
  const store = opts.store ?? fakeStore(['s1'])
  const queue = [...opts.responses]
  const calls: { url: string; init: RequestInit }[] = []
  const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const next = queue.shift() ?? respond(500)
    if (next instanceof Error) throw next
    return next
  }) as unknown as typeof fetch
  const sleeps: number[] = []
  const getToken = vi.fn(async () => (opts.token === undefined ? 'tok' : opts.token))
  const service = new SyncService({
    store,
    apiBaseUrl: 'https://api.example.com',
    scope: SCOPE,
    getToken,
    fetch: fetchFn,
    sleep: async (ms) => {
      sleeps.push(ms)
    }
  })
  return { service, store, calls, sleeps, getToken }
}

describe('SyncService', () => {
  it('posts the session with a bearer token and marks it synced', async () => {
    const { service, store, calls, getToken } = make({ responses: [respond(201)] })
    expect(await service.syncSession('s1')).toBe('synced')
    expect(store.synced).toEqual(['s1'])
    expect(getToken).toHaveBeenCalledWith([SCOPE])
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://api.example.com/api/sessions')
    const init = calls[0]?.init as RequestInit & { headers: Record<string, string> }
    expect(init.method).toBe('POST')
    expect(init.headers['Authorization']).toBe('Bearer tok')
    expect(init.redirect).toBe('error')
    const body = JSON.parse(init.body as string)
    expect(body.id).toBe('s1')
    expect(body.segments).toEqual([{ start: 10, duration: 1, zone: 'camera' }])
    expect(body).not.toHaveProperty('userId')
  })

  it('treats 200 (already uploaded) as success', async () => {
    const { service, store } = make({ responses: [respond(200)] })
    expect(await service.syncSession('s1')).toBe('synced')
    expect(store.synced).toEqual(['s1'])
  })

  it('retries 5xx and network errors with exponential back-off, then succeeds', async () => {
    const { service, store, calls, sleeps } = make({
      responses: [respond(503), new Error('offline'), respond(201)]
    })
    expect(await service.syncSession('s1')).toBe('synced')
    expect(calls).toHaveLength(3)
    expect(sleeps).toEqual([1000, 2000])
    expect(store.synced).toEqual(['s1'])
  })

  it('gives up after 3 attempts and leaves the session unsynced', async () => {
    const { service, store, calls, sleeps } = make({
      responses: [respond(500), respond(502), respond(503), respond(201)]
    })
    expect(await service.syncSession('s1')).toBe('retry-later')
    expect(calls).toHaveLength(3)
    expect(sleeps).toEqual([1000, 2000]) // no sleep after the final attempt
    expect(store.synced).toEqual([])
  })

  it('retries 429', async () => {
    const { service } = make({ responses: [respond(429), respond(201)] })
    expect(await service.syncSession('s1')).toBe('synced')
  })

  it('does not retry a 400 and does not try that session again this run', async () => {
    const { service, store, calls } = make({ responses: [respond(400), respond(201)] })
    expect(await service.syncSession('s1')).toBe('rejected')
    expect(await service.syncSession('s1')).toBe('rejected')
    expect(calls).toHaveLength(1)
    expect(store.synced).toEqual([])
  })

  it.each([401, 403])('stops on %i without hammering the server', async (status) => {
    const { service, calls } = make({ responses: [respond(status)] })
    expect(await service.syncSession('s1')).toBe('retry-later')
    expect(calls).toHaveLength(1)
  })

  it('makes no request when signed out', async () => {
    const { service, calls } = make({ responses: [respond(201)], token: null })
    expect(await service.syncSession('s1')).toBe('retry-later')
    expect(calls).toHaveLength(0)
  })

  it('skips sessions that are missing or still open', async () => {
    const { service, calls } = make({ responses: [] })
    expect(await service.syncSession('nope')).toBe('skipped')
    expect(calls).toHaveLength(0)
  })

  it('syncPending uploads every unsynced session in order', async () => {
    const store = fakeStore(['a', 'b', 'c'])
    const { service } = make({ store, responses: [respond(201), respond(201), respond(201)] })
    expect(await service.syncPending()).toEqual(['synced', 'synced', 'synced'])
    expect(store.synced).toEqual(['a', 'b', 'c'])
  })

  it('never uploads two sessions at once', async () => {
    const store = fakeStore(['a', 'b'])
    let active = 0
    let peak = 0
    const fetchFn = (async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active--
      return respond(201)
    }) as unknown as typeof fetch
    const service = new SyncService({
      store,
      apiBaseUrl: 'https://api.example.com',
      scope: SCOPE,
      getToken: async () => 't',
      fetch: fetchFn
    })
    await Promise.all([service.syncSession('a'), service.syncSession('b')])
    expect(peak).toBe(1)
  })

  it('never puts the token, subject or payload in thrown or logged output', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const { service } = make({ responses: [new Error('Secret subject tok'), respond(500)] })
    await service.syncSession('s1')
    expect(spy).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
    spy.mockRestore()
    log.mockRestore()
  })
})

describe('parseApiBaseUrl', () => {
  it('accepts https and loopback http, and returns the origin only', () => {
    expect(parseApiBaseUrl('https://api.example.com/some/path?x=1')).toBe('https://api.example.com')
    expect(parseApiBaseUrl('http://127.0.0.1:3000')).toBe('http://127.0.0.1:3000')
    expect(parseApiBaseUrl('http://localhost:3000')).toBe('http://localhost:3000')
  })

  it.each(['http://api.example.com', 'ftp://x', 'not a url', ''])('rejects %j', (url) => {
    expect(() => parseApiBaseUrl(url)).toThrow()
  })
})
