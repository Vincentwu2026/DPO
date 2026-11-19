import { useEffect, useState } from 'react'

export type Loadable<T> =
  { state: 'loading' } | { state: 'error'; status: number | null } | { state: 'ready'; data: T }

/** Runs `load` on mount and whenever `deps` change; ignores results from stale runs. */
export function useLoad<T>(load: () => Promise<T>, deps: readonly unknown[]): Loadable<T> {
  const [result, setResult] = useState<Loadable<T>>({ state: 'loading' })
  useEffect(() => {
    let cancelled = false
    setResult({ state: 'loading' })
    load().then(
      (data) => {
        if (!cancelled) setResult({ state: 'ready', data })
      },
      (err: unknown) => {
        const status =
          typeof err === 'object' && err !== null && 'status' in err
            ? Number((err as { status: unknown }).status)
            : null
        if (!cancelled) setResult({ state: 'error', status })
      }
    )
    return () => {
      cancelled = true
    }
  }, deps)
  return result
}
