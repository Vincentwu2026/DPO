import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom'
import type { AccountInfo } from '@azure/msal-browser'
import { createApiClient } from './api'
import { createAuthClient } from './auth'
import { loadConfig } from './config'
import { AppContext } from './context'
import { LoginPage } from './pages/LoginPage'
import { SessionListPage } from './pages/SessionListPage'

// The chart pages pull in Recharts; load them only when visited.
const SessionDetailPage = lazy(() =>
  import('./pages/SessionDetailPage').then((m) => ({ default: m.SessionDetailPage }))
)
const TrendPage = lazy(() => import('./pages/TrendPage').then((m) => ({ default: m.TrendPage })))

type Boot =
  | { state: 'starting' }
  | { state: 'misconfigured' }
  | { state: 'ready'; account: AccountInfo | null }

export function App() {
  const config = useMemo(() => {
    try {
      return loadConfig(import.meta.env as Record<string, unknown>)
    } catch {
      return null
    }
  }, [])
  const auth = useMemo(() => (config ? createAuthClient(config) : null), [config])
  const api = useMemo(
    () => (config && auth ? createApiClient(config.apiBaseUrl, () => auth.getAccessToken()) : null),
    [config, auth]
  )
  const [boot, setBoot] = useState<Boot>(
    config ? { state: 'starting' } : { state: 'misconfigured' }
  )

  useEffect(() => {
    if (!auth) return
    let cancelled = false
    auth.init().then(
      (account) => {
        if (!cancelled) setBoot({ state: 'ready', account })
      },
      () => {
        if (!cancelled) setBoot({ state: 'ready', account: null })
      }
    )
    return () => {
      cancelled = true
    }
  }, [auth])

  if (boot.state === 'misconfigured' || !auth || !api) {
    return (
      <main className="login">
        <h1>Eye Contact Coach</h1>
        <p className="error" role="alert">
          The dashboard is not configured. See dashboard/.env.example.
        </p>
      </main>
    )
  }
  if (boot.state === 'starting') return <p className="muted pad">Loading…</p>
  if (!boot.account) return <LoginPage onSignIn={() => void auth.signIn()} />

  return (
    <AppContext.Provider value={{ auth, api, account: boot.account }}>
      <BrowserRouter>
        <header className="bar">
          <strong>Eye Contact Coach</strong>
          <nav aria-label="Main">
            <NavLink to="/" end>
              Sessions
            </NavLink>
            <NavLink to="/trend">Trend</NavLink>
          </nav>
          <span className="spacer" />
          <span className="muted">{boot.account.name ?? boot.account.username}</span>
          <button type="button" onClick={() => void auth.signOut()}>
            Sign out
          </button>
        </header>
        <main className="page">
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <Routes>
              <Route path="/" element={<SessionListPage />} />
              <Route path="/sessions/:id" element={<SessionDetailPage />} />
              <Route path="/trend" element={<TrendPage />} />
              <Route path="*" element={<p>Page not found.</p>} />
            </Routes>
          </Suspense>
        </main>
      </BrowserRouter>
    </AppContext.Provider>
  )
}
