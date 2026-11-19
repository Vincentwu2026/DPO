import { createContext, useContext } from 'react'
import type { AccountInfo } from '@azure/msal-browser'
import type { ApiClient } from './api'
import type { AuthClient } from './auth'

export interface AppContextValue {
  auth: AuthClient
  api: ApiClient
  account: AccountInfo | null
}

export const AppContext = createContext<AppContextValue | null>(null)

export function useApp(): AppContextValue {
  const value = useContext(AppContext)
  if (!value) throw new Error('AppContext is missing')
  return value
}
