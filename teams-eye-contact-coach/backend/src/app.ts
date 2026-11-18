import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import Fastify, { type FastifyInstance } from 'fastify'
import { AuthError, parseBearer, type AuthenticatedUser, type TokenVerifier } from './auth.js'
import { listQuerySchema, sessionIdSchema, sessionUploadSchema } from './schemas.js'
import type { SessionStore } from './store.js'

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser
  }
}

export interface AppOptions {
  store: SessionStore
  verifier: TokenVerifier
  corsOrigins?: string[]
  trustProxy?: boolean
  logLevel?: string
  /** Requests per minute per client IP. */
  rateLimitPerMinute?: number
}

/** Upload size cap: 20 000 segments is roughly 1.5 MB of JSON. */
const BODY_LIMIT_BYTES = 2 * 1024 * 1024

export async function buildApp(opts: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: opts.logLevel ?? 'info',
      // Never write credentials or request bodies (gaze data) to the logs.
      redact: ['req.headers.authorization', 'req.headers.cookie']
    },
    trustProxy: opts.trustProxy ?? false,
    bodyLimit: BODY_LIMIT_BYTES
  })

  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"] } } })
  await app.register(cors, {
    origin: opts.corsOrigins && opts.corsOrigins.length > 0 ? opts.corsOrigins : false,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type'],
    maxAge: 600
  })
  await app.register(rateLimit, { max: opts.rateLimitPerMinute ?? 120, timeWindow: '1 minute' })

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AuthError) {
      if (err.status === 401) void reply.header('WWW-Authenticate', 'Bearer')
      return reply.code(err.status).send({ error: err.message })
    }
    const status = (err as { statusCode?: number }).statusCode
    if (status === 429) return reply.code(429).send({ error: 'Too many requests' })
    if (status === 413) return reply.code(413).send({ error: 'Payload too large' })
    if (status && status >= 400 && status < 500) {
      return reply.code(400).send({ error: 'Invalid request' })
    }
    // Detail stays in the server log only.
    const info = err instanceof Error ? { name: err.name, message: err.message } : {}
    req.log.error({ err: info }, 'Unhandled error')
    return reply.code(500).send({ error: 'Internal server error' })
  })
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ error: 'Not found' }))

  app.get('/healthz', async () => ({ status: 'ok' }))

  await app.register(
    async (api) => {
      // Every /api request must carry a valid token; identity comes from it and nowhere else.
      api.addHook('onRequest', async (req) => {
        const token = parseBearer(req.headers.authorization)
        if (!token) throw new AuthError(401)
        req.user = await opts.verifier.verify(token)
      })

      api.post('/sessions', async (req, reply) => {
        const body = sessionUploadSchema.safeParse(req.body)
        if (!body.success) return reply.code(400).send({ error: 'Invalid request' })
        const { created } = await opts.store.save((req.user as AuthenticatedUser).oid, body.data)
        return reply.code(created ? 201 : 200).send({ id: body.data.id, created })
      })

      api.get('/sessions', async (req, reply) => {
        // `userId` is deliberately not accepted: strictObject rejects it with a 400.
        const query = listQuerySchema.safeParse(req.query)
        if (!query.success) return reply.code(400).send({ error: 'Invalid request' })
        const sessions = await opts.store.list(
          (req.user as AuthenticatedUser).oid,
          query.data.limit,
          query.data.before
        )
        return { sessions }
      })

      api.get('/sessions/:id', async (req, reply) => {
        const id = sessionIdSchema.safeParse((req.params as { id: string }).id)
        if (!id.success) return reply.code(404).send({ error: 'Not found' })
        const session = await opts.store.get((req.user as AuthenticatedUser).oid, id.data)
        // Someone else's session looks exactly like a missing one.
        if (!session) return reply.code(404).send({ error: 'Not found' })
        return session
      })
    },
    { prefix: '/api' }
  )

  return app
}
