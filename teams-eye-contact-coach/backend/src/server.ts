import { buildApp } from './app.js'
import { createTokenVerifier } from './auth.js'
import { loadConfig } from './config.js'
import { openDatabase } from './pg.js'
import { SessionStore } from './store.js'

async function main(): Promise<void> {
  const config = loadConfig()
  const db = await openDatabase({ url: config.databaseUrl, ssl: config.databaseSsl })
  const app = await buildApp({
    store: new SessionStore(db),
    verifier: createTokenVerifier({
      tenantId: config.tenantId,
      clientId: config.clientId,
      requiredScope: config.requiredScope
    }),
    corsOrigins: config.corsOrigins,
    trustProxy: config.trustProxy,
    logLevel: config.logLevel
  })

  const shutdown = (): void => {
    void app
      .close()
      .then(() => db.close())
      .finally(() => process.exit(0))
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)

  await app.listen({ host: config.host, port: config.port })
}

main().catch((err: unknown) => {
  // Config errors name variables only; never print the error object (it could echo a secret).
  console.error('Failed to start:', err instanceof Error ? err.message : 'unknown error')
  process.exit(1)
})
