import {
  BrowserCacheLocation,
  InteractionRequiredAuthError,
  PublicClientApplication,
  type AccountInfo
} from '@azure/msal-browser'
import type { DashboardConfig } from './config'

export interface AuthClient {
  /** Completes a pending redirect sign-in; resolves to the signed-in account, if any. */
  init(): Promise<AccountInfo | null>
  signIn(): Promise<void>
  signOut(): Promise<void>
  /** Access token for the API. Redirects to sign in again if silent renewal is impossible. */
  getAccessToken(): Promise<string>
}

export class SignInRequiredError extends Error {
  constructor() {
    super('Sign-in required')
  }
}

export function createAuthClient(config: DashboardConfig): AuthClient {
  const msal = new PublicClientApplication({
    auth: {
      clientId: config.clientId,
      authority: `https://login.microsoftonline.com/${config.tenantId}`,
      redirectUri: window.location.origin,
      postLogoutRedirectUri: window.location.origin
    },
    // sessionStorage: tokens do not outlive the browser tab, unlike localStorage.
    cache: { cacheLocation: BrowserCacheLocation.SessionStorage }
  })
  const scopes = [config.apiScope]

  const currentAccount = (): AccountInfo | null => {
    const accounts = msal.getAllAccounts()
    return accounts.length === 1 ? (accounts[0] ?? null) : null
  }

  return {
    async init() {
      await msal.initialize()
      const result = await msal.handleRedirectPromise()
      if (result?.account) msal.setActiveAccount(result.account)
      else msal.setActiveAccount(currentAccount())
      return msal.getActiveAccount()
    },

    async signIn() {
      await msal.loginRedirect({ scopes })
    },

    async signOut() {
      await msal.logoutRedirect({ account: msal.getActiveAccount() })
    },

    async getAccessToken() {
      const account = msal.getActiveAccount()
      if (!account) throw new SignInRequiredError()
      try {
        const result = await msal.acquireTokenSilent({ scopes, account })
        return result.accessToken
      } catch (err) {
        if (err instanceof InteractionRequiredAuthError) {
          await msal.acquireTokenRedirect({ scopes, account })
        }
        throw new SignInRequiredError()
      }
    }
  }
}
