import { PGlite } from '@electric-sql/pglite'
import { exportJWK, generateKeyPair, SignJWT, createLocalJWKSet, type JWK } from 'jose'
import { buildApp } from '../src/app.js'
import { createTokenVerifier } from '../src/auth.js'
import { migrate, type Database } from '../src/db.js'
import { SessionStore } from '../src/store.js'

export const TENANT = '11111111-1111-4111-8111-111111111111'
export const CLIENT = '22222222-2222-4222-8222-222222222222'
export const SCOPE = 'Sessions.ReadWrite'
export const ALICE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const BOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

/** A real Postgres (WASM) behind the same interface the server uses with `pg`. */
export async function createTestDb(): Promise<Database> {
  const pg = new PGlite()
  const db: Database = {
    query: async (text, params) => {
      const r = await pg.query(text, params)
      return { rows: r.rows as never[] }
    },
    transaction: (fn) =>
      pg.transaction((tx) =>
        fn({
          query: async (text, params) => {
            // Multi-statement migrations need exec(); parameterised queries use query().
            if (!params) {
              const results = await tx.exec(text)
              return { rows: (results[results.length - 1]?.rows ?? []) as never[] }
            }
            const r = await tx.query(text, params)
            return { rows: r.rows as never[] }
          }
        })
      ),
    close: () => pg.close()
  }
  await migrate(db)
  return db
}

export interface TokenOptions {
  oid?: string | undefined
  scp?: string | undefined
  aud?: string
  iss?: string
  expiresIn?: string
  roles?: string[]
}

export async function createTestAuth() {
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const jwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }
  const verifier = createTokenVerifier({
    tenantId: TENANT,
    clientId: CLIENT,
    requiredScope: SCOPE,
    keys: createLocalJWKSet({ keys: [jwk] })
  })

  async function token(opts: TokenOptions = {}, key = privateKey): Promise<string> {
    const claims: Record<string, unknown> = {}
    if (!('oid' in opts && opts.oid === undefined)) claims['oid'] = opts.oid ?? ALICE
    if (!('scp' in opts && opts.scp === undefined)) claims['scp'] = opts.scp ?? SCOPE
    if (opts.roles) claims['roles'] = opts.roles
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(opts.iss ?? `https://login.microsoftonline.com/${TENANT}/v2.0`)
      .setAudience(opts.aud ?? `api://${CLIENT}`)
      .setIssuedAt()
      .setExpirationTime(opts.expiresIn ?? '5m')
      .sign(key)
  }
  return { verifier, token }
}

export async function createTestApp() {
  const db = await createTestDb()
  const auth = await createTestAuth()
  const app = await buildApp({
    store: new SessionStore(db),
    verifier: auth.verifier,
    logLevel: 'silent',
    rateLimitPerMinute: 10_000
  })
  return { app, db, ...auth }
}

export const SESSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

export function sampleSession(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    meetingId: 'meeting-1',
    subject: 'Weekly sync',
    trackingMode: 'realtime',
    startedAt: 1_800_000_000,
    endedAt: 1_800_000_600,
    segments: [
      { start: 10, duration: 6, zone: 'camera' },
      { start: 16, duration: 3, zone: 'screen' },
      { start: 19, duration: 1, zone: 'away' }
    ],
    ...overrides
  }
}
