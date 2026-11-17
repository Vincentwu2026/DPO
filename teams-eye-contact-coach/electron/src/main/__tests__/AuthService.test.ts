import { beforeEach, describe, expect, it, vi } from 'vitest'

const msal = vi.hoisted(() => ({
  acquireTokenInteractive: vi.fn(),
  acquireTokenSilent: vi.fn(),
  getAllAccounts: vi.fn(),
  clearCache: vi.fn(),
  config: undefined as unknown
}))

const keychain = vi.hoisted(() => ({
  getPassword: vi.fn(),
  setPassword: vi.fn(),
  deletePassword: vi.fn()
}))

vi.mock('@azure/msal-node', () => ({
  PublicClientApplication: class {
    constructor(config: unknown) {
      msal.config = config
    }
    acquireTokenInteractive = msal.acquireTokenInteractive
    acquireTokenSilent = msal.acquireTokenSilent
    getAllAccounts = msal.getAllAccounts
    clearCache = msal.clearCache
  }
}))
vi.mock('keytar', () => keychain)

import { AuthService, GRAPH_SCOPES, KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE } from '../auth/AuthService'

const account = { name: 'Ada Lovelace', username: 'ada@example.com', localAccountId: 'user-1' }

function makeService(): AuthService {
  return new AuthService({
    clientId: 'client-id',
    tenantId: 'tenant-id',
    openBrowser: vi.fn().mockResolvedValue(undefined)
  })
}

describe('AuthService', () => {
  beforeEach(() => {
    vi.resetAllMocks() // clearAllMocks would keep per-test mockResolvedValue implementations
    keychain.getPassword.mockResolvedValue(null)
    msal.getAllAccounts.mockResolvedValue([])
  })

  it('signIn acquires an interactive token with the Graph scopes and returns it', async () => {
    msal.acquireTokenInteractive.mockResolvedValue({ accessToken: 'tok-1', account })

    await expect(makeService().signIn()).resolves.toBe('tok-1')

    expect(msal.acquireTokenInteractive).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: GRAPH_SCOPES })
    )
  })

  it('persists the MSAL cache in the keychain via the cache plugin, not on disk', async () => {
    makeService()
    msal.acquireTokenInteractive.mockResolvedValue({ accessToken: 't', account })
    await makeService().signIn()

    const plugin = (
      msal.config as { cache: { cachePlugin: Record<string, (c: unknown) => Promise<void>> } }
    ).cache.cachePlugin
    const deserialize = vi.fn()
    keychain.getPassword.mockResolvedValue('serialized-cache')
    await plugin['beforeCacheAccess']({ tokenCache: { deserialize } })
    expect(keychain.getPassword).toHaveBeenCalledWith(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
    expect(deserialize).toHaveBeenCalledWith('serialized-cache')

    await plugin['afterCacheAccess']({
      cacheHasChanged: true,
      tokenCache: { serialize: () => 'new-cache' }
    })
    expect(keychain.setPassword).toHaveBeenCalledWith(
      KEYCHAIN_SERVICE,
      KEYCHAIN_ACCOUNT,
      'new-cache'
    )
  })

  it('refuses to open a non-HTTPS sign-in URL', async () => {
    const openBrowser = vi.fn()
    const service = new AuthService({ clientId: 'c', tenantId: 't', openBrowser })
    msal.acquireTokenInteractive.mockImplementation(
      async (req: { openBrowser: (u: string) => Promise<void> }) => {
        await req.openBrowser('http://evil.example/login')
        return { accessToken: 'x', account }
      }
    )

    await expect(service.signIn()).rejects.toThrow(/non-HTTPS/)
    expect(openBrowser).not.toHaveBeenCalled()
  })

  describe('getAccessToken', () => {
    it('returns the silently acquired token when a cached account exists', async () => {
      msal.getAllAccounts.mockResolvedValue([account])
      keychain.getPassword.mockResolvedValue('cache')
      msal.acquireTokenSilent.mockResolvedValue({ accessToken: 'silent-tok', account })

      await expect(makeService().getAccessToken()).resolves.toBe('silent-tok')

      expect(msal.acquireTokenSilent).toHaveBeenCalledWith({ account, scopes: GRAPH_SCOPES })
      expect(msal.acquireTokenInteractive).not.toHaveBeenCalled()
    })

    it('falls back to interactive sign-in when silent acquisition fails', async () => {
      msal.getAllAccounts.mockResolvedValue([account])
      keychain.getPassword.mockResolvedValue('cache')
      msal.acquireTokenSilent.mockRejectedValue(new Error('interaction_required'))
      msal.acquireTokenInteractive.mockResolvedValue({ accessToken: 'interactive-tok', account })

      await expect(makeService().getAccessToken()).resolves.toBe('interactive-tok')

      expect(msal.acquireTokenSilent).toHaveBeenCalledTimes(1)
      expect(msal.acquireTokenInteractive).toHaveBeenCalledTimes(1)
    })

    it('goes straight to interactive sign-in when nobody is signed in', async () => {
      msal.acquireTokenInteractive.mockResolvedValue({ accessToken: 'first-tok', account })

      await expect(makeService().getAccessToken()).resolves.toBe('first-tok')

      expect(msal.acquireTokenSilent).not.toHaveBeenCalled()
    })
  })

  describe('signOut', () => {
    it('clears the MSAL cache and deletes the keychain entry', async () => {
      msal.acquireTokenInteractive.mockResolvedValue({ accessToken: 't', account })
      const service = makeService()
      await service.signIn()

      await service.signOut()

      expect(msal.clearCache).toHaveBeenCalled()
      expect(keychain.deletePassword).toHaveBeenCalledWith(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT)
      await expect(service.getSignedInUser()).resolves.toBeNull()
    })
  })

  describe('getSignedInUser', () => {
    it('returns name and username of the cached account', async () => {
      msal.getAllAccounts.mockResolvedValue([account])
      keychain.getPassword.mockResolvedValue('cache')

      await expect(makeService().getSignedInUser()).resolves.toEqual({
        name: 'Ada Lovelace',
        username: 'ada@example.com'
      })
    })

    it('returns null when there is no cached account and does not need Azure AD config', async () => {
      const service = new AuthService({ openBrowser: vi.fn() })
      await expect(service.getSignedInUser()).resolves.toBeNull()
    })
  })
})
