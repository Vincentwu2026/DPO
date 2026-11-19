import { z } from 'zod'

const uuid = z.uuid()

/** Only https, or http on loopback for local development. */
export function isAllowedApiUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  } catch {
    return false
  }
}

const envSchema = z.object({
  VITE_AZURE_TENANT_ID: uuid,
  VITE_DASHBOARD_CLIENT_ID: uuid,
  VITE_API_SCOPE: z.string().min(1),
  VITE_API_BASE_URL: z.string().refine(isAllowedApiUrl)
})

export interface DashboardConfig {
  tenantId: string
  clientId: string
  apiScope: string
  /** No trailing slash. */
  apiBaseUrl: string
}

/** Throws an Error naming the bad variables (never their values). */
export function loadConfig(env: Record<string, unknown>): DashboardConfig {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((i) => String(i.path[0])))]
    throw new Error(`Invalid configuration: ${names.join(', ')}`)
  }
  const e = parsed.data
  return {
    tenantId: e.VITE_AZURE_TENANT_ID,
    clientId: e.VITE_DASHBOARD_CLIENT_ID,
    apiScope: e.VITE_API_SCOPE,
    apiBaseUrl: e.VITE_API_BASE_URL.replace(/\/+$/, '')
  }
}
