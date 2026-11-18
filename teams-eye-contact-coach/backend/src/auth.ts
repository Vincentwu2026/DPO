import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose'

export interface AuthenticatedUser {
  /** Entra object ID from the validated token. The only source of user identity. */
  oid: string
}

export interface TokenVerifier {
  /** Resolves to the user, or throws AuthError. */
  verify(token: string): Promise<AuthenticatedUser>
}

/** 401 = no valid token; 403 = valid token without the required scope. */
export class AuthError extends Error {
  constructor(readonly status: 401 | 403) {
    super(status === 401 ? 'Unauthorized' : 'Forbidden')
  }
}

export interface TokenVerifierOptions {
  tenantId: string
  /** Client ID of the API app registration (the token audience). */
  clientId: string
  /** Delegated scope that must appear in the token's `scp` claim. */
  requiredScope: string
  /** Signing keys; defaults to the tenant's published JWKS (cached, rotated by jose). */
  keys?: JWTVerifyGetKey
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createTokenVerifier(opts: TokenVerifierOptions): TokenVerifier {
  const keys =
    opts.keys ??
    createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${opts.tenantId}/discovery/v2.0/keys`),
      { timeoutDuration: 5000 }
    )
  // Both issuers are pinned to our tenant: v2 tokens, and v1 tokens (the default access token
  // version for new app registrations).
  const issuer = [
    `https://login.microsoftonline.com/${opts.tenantId}/v2.0`,
    `https://sts.windows.net/${opts.tenantId}/`
  ]
  const audience = [opts.clientId, `api://${opts.clientId}`]

  return {
    async verify(token) {
      let payload
      try {
        ;({ payload } = await jwtVerify(token, keys, {
          algorithms: ['RS256'],
          issuer,
          audience,
          clockTolerance: 30,
          requiredClaims: ['exp', 'oid']
        }))
      } catch {
        throw new AuthError(401)
      }
      const oid = payload['oid']
      if (typeof oid !== 'string' || !UUID.test(oid)) throw new AuthError(401)

      // Delegated user tokens carry `scp`; app-only tokens (`roles`) have none and are rejected.
      const scp = payload['scp']
      const scopes = typeof scp === 'string' ? scp.split(' ') : []
      if (!scopes.includes(opts.requiredScope)) throw new AuthError(403)

      return { oid: oid.toLowerCase() }
    }
  }
}

const BEARER = /^Bearer ([A-Za-z0-9\-._~+/]+=*)$/

/** Extracts the token from an Authorization header value, or null if malformed. */
export function parseBearer(header: string | undefined): string | null {
  if (!header || header.length > 8192) return null
  return BEARER.exec(header)?.[1] ?? null
}
