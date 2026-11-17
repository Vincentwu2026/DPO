import {
  PublicClientApplication,
  type AccountInfo,
  type ICachePlugin,
  type TokenCacheContext
} from '@azure/msal-node'
import * as keytar from 'keytar'

export const KEYCHAIN_SERVICE = 'teams-eye-coach'
export const KEYCHAIN_ACCOUNT = 'msal-account'

export const GRAPH_SCOPES = [
  'https://graph.microsoft.com/OnlineMeetings.Read',
  'https://graph.microsoft.com/Presence.Read',
  'https://graph.microsoft.com/CallRecords.Read.All'
]

export interface SignedInUser {
  name: string
  username: string
}

export interface AuthServiceOptions {
  clientId?: string
  tenantId?: string
  /** Opens the sign-in URL in the system browser (injected from the Electron main process). */
  openBrowser: (url: string) => Promise<void>
}

/** MSAL token cache persisted exclusively in the OS keychain via keytar. */
const keychainCachePlugin: ICachePlugin = {
  async beforeCacheAccess(context: TokenCacheContext): Promise<void> {
    const serialized = await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
    if (serialized) context.tokenCache.deserialize(serialized)
  },
  async afterCacheAccess(context: TokenCacheContext): Promise<void> {
    if (context.cacheHasChanged) {
      await keytar.setPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT, context.tokenCache.serialize())
    }
  }
}

export class AuthService {
  private app: PublicClientApplication | null = null
  private account: AccountInfo | null = null

  constructor(private readonly options: AuthServiceOptions) {}

  /** Created lazily so the app can start (and show its tray) before Azure AD is configured. */
  private getApp(): PublicClientApplication {
    if (this.app) return this.app
    const clientId = this.options.clientId ?? process.env['AZURE_CLIENT_ID']
    const tenantId = this.options.tenantId ?? process.env['AZURE_TENANT_ID']
    if (!clientId || !tenantId) {
      throw new Error('AZURE_CLIENT_ID and AZURE_TENANT_ID must be set')
    }
    this.app = new PublicClientApplication({
      auth: { clientId, authority: `https://login.microsoftonline.com/${tenantId}` },
      cache: { cachePlugin: keychainCachePlugin }
    })
    return this.app
  }

  /** Interactive sign-in in the system browser. Returns the access token. */
  async signIn(scopes: string[] = GRAPH_SCOPES): Promise<string> {
    const result = await this.getApp().acquireTokenInteractive({
      scopes,
      openBrowser: async (url) => {
        // Only ever hand HTTPS URLs to the system browser.
        if (new URL(url).protocol !== 'https:')
          throw new Error('Refusing to open non-HTTPS sign-in URL')
        await this.options.openBrowser(url)
      }
    })
    this.account = result.account
    return result.accessToken
  }

  /** Silent acquisition first; falls back to interactive sign-in when it fails. */
  async getAccessToken(scopes: string[] = GRAPH_SCOPES): Promise<string> {
    const account = await this.getCachedAccount()
    if (account) {
      try {
        const result = await this.getApp().acquireTokenSilent({ account, scopes })
        this.account = result.account ?? account
        return result.accessToken
      } catch {
        // Expired refresh token, consent required, etc. — fall through to interactive.
      }
    }
    return this.signIn(scopes)
  }

  async signOut(): Promise<void> {
    if (this.app) this.app.clearCache()
    this.account = null
    await keytar.deletePassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
  }

  async getSignedInUser(): Promise<SignedInUser | null> {
    const account = await this.getCachedAccount()
    if (!account) return null
    return { name: account.name ?? account.username, username: account.username }
  }

  /** Entra object ID of the signed-in user (used for Graph presence lookups). Main process only. */
  async getUserId(): Promise<string | null> {
    return (await this.getCachedAccount())?.localAccountId ?? null
  }

  private async getCachedAccount(): Promise<AccountInfo | null> {
    if (this.account) return this.account
    // Don't require Azure AD configuration just to ask "is anyone signed in?".
    if (!this.app && !(await keytar.getPassword(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT))) return null
    const accounts = await this.getApp().getAllAccounts()
    this.account = accounts[0] ?? null
    return this.account
  }
}
