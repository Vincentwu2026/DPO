import { Link } from 'react-router-dom'
import { useApp } from '../context'
import { formatDate, formatDuration, formatPercent } from '../lib'
import { LoadState } from '../LoadState'
import { useLoad } from '../useLoad'

export function SessionListPage() {
  const { api } = useApp()
  const result = useLoad(() => api.listSessions(100), [api])

  return (
    <section>
      <h1>Sessions</h1>
      <p className="muted">Eye contact is measured only while you were the active speaker.</p>
      <LoadState result={result}>
        {(sessions) =>
          sessions.length === 0 ? (
            <p>No sessions yet. They appear here after a Teams call in which you spoke.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Meeting</th>
                  <th className="num">Speaking time</th>
                  <th className="num">Camera eye contact</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <Link to={`/sessions/${s.id}`}>{formatDate(s.startedAt)}</Link>
                    </td>
                    {/* React escapes text, so a hostile meeting subject cannot inject markup. */}
                    <td>{s.subject ?? '(no subject)'}</td>
                    <td className="num">{formatDuration(s.speakingSeconds)}</td>
                    <td className="num">
                      {s.speakingSeconds > 0 ? formatPercent(s.cameraPercent) : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </LoadState>
    </section>
  )
}
