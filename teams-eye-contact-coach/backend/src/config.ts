import { z } from 'zod'

const bool = z.enum(['true', 'false']).transform((v) => v === 'true')

const envSchema = z.object({
  /** Entra tenant (single-tenant only: the issuer is pinned to it). */
  AZURE_TENANT_ID: z.uuid(),
  /** Client ID of the API's own app registration; tokens must be issued for it. */
  API_CLIENT_ID: z.uuid(),
  /** Delegated scope the desktop app / dashboard must request, e.g. api://<client>/Sessions.ReadWrite */
  REQUIRED_SCOPE: z.string().min(1).default('Sessions.ReadWrite'),
  /** Secret: supply via the environment / a vault, never commit it. */
  DATABASE_URL: z.string().min(1),
  DATABASE_SSL: bool.default(true),
  HOST: z.string().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  /** Comma-separated exact origins allowed by CORS (the dashboard). Empty = no browser origins. */
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: bool.default(false),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info')
})

export interface Config {
  tenantId: string
  clientId: string
  requiredScope: string
  databaseUrl: string
  databaseSsl: boolean
  host: string
  port: number
  corsOrigins: string[]
  trustProxy: boolean
  logLevel: string
}

function isExactOrigin(value: string): boolean {
  try {
    return new URL(value).origin === value
  } catch {
    return false
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    // Name the offending variables, never their values (DATABASE_URL holds a credential).
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))]
    throw new Error(`Invalid configuration: ${names.join(', ')}`)
  }
  const e = parsed.data
  const corsOrigins = e.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  if (['0.0.0.0', '::', '[::]', '0:0:0:0:0:0:0:0'].includes(e.HOST)) {
    throw new Error('Invalid configuration: HOST (binding to all interfaces is not allowed)')
  }
  for (const origin of corsOrigins) {
    if (!isExactOrigin(origin)) throw new Error('Invalid configuration: CORS_ORIGINS')
  }
  return {
    tenantId: e.AZURE_TENANT_ID,
    clientId: e.API_CLIENT_ID,
    requiredScope: e.REQUIRED_SCOPE,
    databaseUrl: e.DATABASE_URL,
    databaseSsl: e.DATABASE_SSL,
    host: e.HOST,
    port: e.PORT,
    corsOrigins,
    trustProxy: e.TRUST_PROXY,
    logLevel: e.LOG_LEVEL
  }
}
