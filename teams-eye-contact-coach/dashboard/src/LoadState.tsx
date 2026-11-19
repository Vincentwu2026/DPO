import type { ReactNode } from 'react'
import type { Loadable } from './useLoad'

export function LoadState<T>(props: {
  result: Loadable<T>
  children: (data: T) => ReactNode
}): ReactNode {
  const { result } = props
  if (result.state === 'loading') return <p className="muted">Loading…</p>
  if (result.state === 'error') {
    // Generic message only; the status is not useful to the reader and never includes data.
    return (
      <p className="error" role="alert">
        {result.status === 403
          ? 'Your account is not permitted to read this data.'
          : 'Could not load data. Please try again later.'}
      </p>
    )
  }
  return props.children(result.data)
}
