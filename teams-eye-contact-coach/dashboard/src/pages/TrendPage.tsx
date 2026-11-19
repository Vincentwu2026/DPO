import { useMemo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import { useApp } from '../context'
import { formatPercent, toTrend, trendDelta } from '../lib'
import { LoadState } from '../LoadState'
import { useLoad } from '../useLoad'

const dateLabel = (unixSeconds: number): string =>
  new Date(unixSeconds * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

export function TrendPage() {
  const { api } = useApp()
  const result = useLoad(() => api.listSessions(100), [api])

  return (
    <section>
      <h1>Trend</h1>
      <p className="muted">Camera eye contact while speaking, across your recent sessions.</p>
      <LoadState result={result}>{(sessions) => <Trend sessions={sessions} />}</LoadState>
    </section>
  )
}

function Trend({ sessions }: { sessions: Parameters<typeof toTrend>[0] }) {
  const points = useMemo(() => toTrend(sessions), [sessions])
  const delta = trendDelta(points)
  if (points.length === 0) return <p>No sessions with speaking time yet.</p>

  const data = points.map((p) => ({
    date: dateLabel(p.startedAt),
    cameraPercent: Math.round(p.cameraPercent * 10) / 10
  }))

  return (
    <>
      {delta !== null && (
        <p className="headline">
          {delta >= 0 ? '+' : '−'}
          {Math.abs(Math.round(delta))} pts
          <span> from your first sessions to your latest</span>
        </p>
      )}
      <p className="muted">
        Latest: {formatPercent(points[points.length - 1]?.cameraPercent ?? 0)} across{' '}
        {points.length} session{points.length === 1 ? '' : 's'}.
      </p>
      <div className="chart" role="img" aria-label="Camera eye contact percentage over time">
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="date" />
            <YAxis domain={[0, 100]} unit="%" />
            <Tooltip formatter={(v) => `${String(v)}%`} />
            <Line
              type="monotone"
              dataKey="cameraPercent"
              name="Camera"
              stroke="#2e9e5b"
              strokeWidth={2}
              dot
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}
