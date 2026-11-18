import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateKeyPair } from 'jose'
import { buildApp } from '../src/app.js'
import { SessionStore } from '../src/store.js'
import { ALICE, BOB, CLIENT, SESSION_ID, TENANT, createTestApp, sampleSession } from './helpers.js'

type Ctx = Awaited<ReturnType<typeof createTestApp>>
let ctx: Ctx

beforeEach(async () => {
  ctx = await createTestApp()
})
afterEach(async () => {
  await ctx.app.close()
  await ctx.db.close()
})

const auth = async (oid?: string) => ({
  authorization: `Bearer ${await ctx.token(oid ? { oid } : {})}`
})

describe('authentication', () => {
  it('rejects a missing token with 401 and a Bearer challenge', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/api/sessions' })
    expect(res.statusCode).toBe(401)
    expect(res.headers['www-authenticate']).toBe('Bearer')
    expect(res.json()).toEqual({ error: 'Unauthorized' })
  })

  it.each(['Basic abc', 'Bearer', 'Bearer a b', 'bearer abc', 'Bearer \u0000'])(
    'rejects a malformed Authorization header %j',
    async (header) => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/api/sessions',
        headers: { authorization: header }
      })
      expect(res.statusCode).toBe(401)
    }
  )

  it('rejects a token signed by an unknown key', async () => {
    const other = await generateKeyPair('RS256')
    const bad = await ctx.token({}, other.privateKey)
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${bad}` }
    })
    expect(res.statusCode).toBe(401)
  })

  it.each([
    ['wrong audience', { aud: 'api://99999999-9999-4999-8999-999999999999' }],
    ['wrong tenant issuer', { iss: 'https://login.microsoftonline.com/other/v2.0' }],
    ['expired', { expiresIn: '-1h' }],
    ['no oid claim', { oid: undefined }],
    ['non-uuid oid', { oid: "x'; DROP TABLE sessions;--" }]
  ])('rejects a token with %s', async (_name, opts) => {
    const t = await ctx.token(opts)
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${t}` }
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects a valid token without the required scope with 403', async () => {
    const t = await ctx.token({ scp: 'User.Read' })
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${t}` }
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejects app-only tokens (roles, no scp)', async () => {
    const t = await ctx.token({ scp: undefined, roles: ['Sessions.ReadWrite'] })
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${t}` }
    })
    expect(res.statusCode).toBe(403)
  })

  it('accepts the v1 issuer and the bare client-id audience', async () => {
    const t = await ctx.token({ iss: `https://sts.windows.net/${TENANT}/`, aud: CLIENT })
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { authorization: `Bearer ${t}` }
    })
    expect(res.statusCode).toBe(200)
  })

  it('leaves /healthz open', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/healthz' })
    expect(res.statusCode).toBe(200)
  })
})

describe('POST /api/sessions', () => {
  it('stores a session and returns 201', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: await auth(),
      payload: sampleSession()
    })
    expect(res.statusCode).toBe(201)
    expect(res.json()).toEqual({ id: SESSION_ID, created: true })
  })

  it('is idempotent: a repeat upload returns 200 and stores nothing new', async () => {
    const headers = await auth()
    await ctx.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers,
      payload: sampleSession()
    })
    const again = await ctx.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers,
      payload: sampleSession({ subject: 'changed' })
    })
    expect(again.statusCode).toBe(200)
    expect(again.json()).toEqual({ id: SESSION_ID, created: false })

    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/api/sessions/${SESSION_ID}`,
      headers
    })
    expect(detail.json().subject).toBe('Weekly sync')
    expect(detail.json().timeline).toHaveLength(3)
  })

  it('ignores a client-supplied user id (strict schema rejects it)', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: await auth(ALICE),
      payload: sampleSession({ userId: BOB, oid: BOB })
    })
    expect(res.statusCode).toBe(400)
  })

  it.each([
    ['unknown zone', { segments: [{ start: 0, duration: 1, zone: 'ceiling' }] }],
    ['negative duration', { segments: [{ start: 0, duration: -1, zone: 'camera' }] }],
    ['zero duration', { segments: [{ start: 0, duration: 0, zone: 'camera' }] }],
    ['NaN-like string', { segments: [{ start: 'x', duration: 1, zone: 'camera' }] }],
    [
      'overlapping segments',
      {
        segments: [
          { start: 0, duration: 5, zone: 'camera' },
          { start: 2, duration: 5, zone: 'away' }
        ]
      }
    ],
    [
      'segment past the end of the session',
      { segments: [{ start: 590, duration: 100, zone: 'camera' }] }
    ],
    ['end before start', { endedAt: 1_700_000_000 }],
    ['session over 24 h', { endedAt: 1_800_000_000 + 90_000 }],
    ['bad id', { id: 'not-a-uuid' }],
    ['bad tracking mode', { trackingMode: 'always' }],
    ['oversized subject', { subject: 'x'.repeat(501) }],
    ['extra field', { extra: true }]
  ])('rejects %s with 400 and a generic message', async (_name, override) => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: await auth(),
      payload: sampleSession(override)
    })
    expect(res.statusCode).toBe(400)
    expect(res.json()).toEqual({ error: 'Invalid request' })
  })

  it('accepts a session with no speaking time', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: await auth(),
      payload: sampleSession({ segments: [] })
    })
    expect(res.statusCode).toBe(201)
    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/api/sessions/${SESSION_ID}`,
      headers: await auth()
    })
    expect(detail.json().speakingSeconds).toBe(0)
    expect(detail.json().cameraPercent).toBe(0)
  })

  it('rejects an oversized body with 413', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: { ...(await auth()), 'content-type': 'application/json' },
      payload: JSON.stringify({ subject: 'x'.repeat(3 * 1024 * 1024) })
    })
    expect(res.statusCode).toBe(413)
  })

  it('treats SQL metacharacters in text fields as data', async () => {
    const evil = "'); DROP TABLE sessions; --"
    const headers = await auth()
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers,
      payload: sampleSession({ subject: evil, meetingId: evil })
    })
    expect(res.statusCode).toBe(201)
    const detail = await ctx.app.inject({
      method: 'GET',
      url: `/api/sessions/${SESSION_ID}`,
      headers
    })
    expect(detail.json().subject).toBe(evil)
  })
})

describe('GET /api/sessions and /api/sessions/:id', () => {
  beforeEach(async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: await auth(ALICE),
      payload: sampleSession()
    })
  })

  it('reports speaking-time breakdown and a timeline', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/sessions/${SESSION_ID}`,
      headers: await auth(ALICE)
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.durationSeconds).toBe(600)
    expect(body.speakingSeconds).toBe(10)
    expect(body.zones.camera).toEqual({ seconds: 6, percent: 60 })
    expect(body.zones.screen).toEqual({ seconds: 3, percent: 30 })
    expect(body.zones.away).toEqual({ seconds: 1, percent: 10 })
    expect(body.cameraPercent).toBe(60)
    expect(body.timeline).toEqual([
      { start: 10, end: 16, zone: 'camera' },
      { start: 16, end: 19, zone: 'screen' },
      { start: 19, end: 20, zone: 'away' }
    ])
  })

  it('lists only the caller’s own sessions', async () => {
    const mine = await ctx.app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: await auth(ALICE)
    })
    expect(mine.json().sessions.map((s: { id: string }) => s.id)).toEqual([SESSION_ID])

    const theirs = await ctx.app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: await auth(BOB)
    })
    expect(theirs.json()).toEqual({ sessions: [] })
  })

  it('returns 404, not 403, for another user’s session id', async () => {
    const other = await ctx.app.inject({
      method: 'GET',
      url: `/api/sessions/${SESSION_ID}`,
      headers: await auth(BOB)
    })
    const missing = await ctx.app.inject({
      method: 'GET',
      url: '/api/sessions/dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      headers: await auth(BOB)
    })
    expect(other.statusCode).toBe(404)
    expect(other.json()).toEqual(missing.json())
    expect(other.body).not.toContain('Weekly sync')
  })

  it('does not let a query parameter select another user (400)', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/sessions?userId=${ALICE}`,
      headers: await auth(BOB)
    })
    expect(res.statusCode).toBe(400)
  })

  it('does not let one user overwrite or block another user’s session id', async () => {
    const bobUpload = await ctx.app.inject({
      method: 'POST',
      url: '/api/sessions',
      headers: await auth(BOB),
      payload: sampleSession({ subject: 'Bob’s talk' })
    })
    expect(bobUpload.statusCode).toBe(201)
    const alice = await ctx.app.inject({
      method: 'GET',
      url: `/api/sessions/${SESSION_ID}`,
      headers: await auth(ALICE)
    })
    expect(alice.json().subject).toBe('Weekly sync')
  })

  it('returns 404 for a malformed id', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: "/api/sessions/1'%20OR%20'1'='1",
      headers: await auth(ALICE)
    })
    expect(res.statusCode).toBe(404)
  })

  it('pages newest-first with limit and before', async () => {
    const headers = await auth(ALICE)
    for (const [n, started] of [
      ['1', 1_800_001_000],
      ['2', 1_800_002_000]
    ] as const) {
      await ctx.app.inject({
        method: 'POST',
        url: '/api/sessions',
        headers,
        payload: sampleSession({
          id: `eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee${n}`,
          startedAt: started,
          endedAt: started + 60,
          segments: []
        })
      })
    }
    const page1 = await ctx.app.inject({ method: 'GET', url: '/api/sessions?limit=2', headers })
    const starts = page1.json().sessions.map((s: { startedAt: number }) => s.startedAt)
    expect(starts).toEqual([1_800_002_000, 1_800_001_000])

    const page2 = await ctx.app.inject({
      method: 'GET',
      url: `/api/sessions?limit=2&before=${starts[1]}`,
      headers
    })
    expect(page2.json().sessions.map((s: { id: string }) => s.id)).toEqual([SESSION_ID])
  })

  it.each(['limit=0', 'limit=1000', 'limit=abc', 'before=abc'])(
    'rejects invalid query %s',
    async (q) => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: `/api/sessions?${q}`,
        headers: await auth(ALICE)
      })
      expect(res.statusCode).toBe(400)
    }
  )
})

describe('headers and errors', () => {
  it('sets security headers and no CORS for unknown origins', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: { ...(await auth()), origin: 'https://evil.example' }
    })
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.headers['access-control-allow-origin']).toBeUndefined()
  })

  it('returns a generic 404 for unknown routes', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'Not found' })
  })

  it('returns a generic 500 and never leaks internals', async () => {
    const broken = await buildApp({
      store: new SessionStore({
        query: () => Promise.reject(new Error('connection to db.internal:5432 refused')),
        transaction: () => Promise.reject(new Error('boom')),
        close: () => Promise.resolve()
      }),
      verifier: ctx.verifier,
      logLevel: 'silent'
    })
    const res = await broken.inject({
      method: 'GET',
      url: '/api/sessions',
      headers: await auth()
    })
    expect(res.statusCode).toBe(500)
    expect(res.json()).toEqual({ error: 'Internal server error' })
    expect(res.body).not.toContain('db.internal')
    await broken.close()
  })
})
