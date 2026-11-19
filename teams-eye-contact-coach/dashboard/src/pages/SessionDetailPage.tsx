import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts'
import type { SessionDetail } from '../api'
import { useApp } from '../context'
import {
  ZONE_COLORS,
  ZONE_LABELS,
  ZONE_ORDER,
  bucketTimeline,
  formatDate,
  formatDuration,
  formatPercent
} from '../lib'
import { LoadState } from '../LoadState'
import { useLoad } from '../useLoad'

export function SessionDetailPage() {
  const { api } = useApp()
  const { id = '' } = useParams()
  const result = useLoad(() => api.getSession(id), [api, id])

  return (
    <section>
      <p>
        <Link to="/">← All sessions</Link>
      </p>
      <LoadState result={result}>{(session) => <Detail session={session} />}</LoadState>
    </section>
  )
}

function Detail({ session }: { session: SessionDetail }) {
  const donut = ZONE_ORDER.map((zone) => ({
    zone,
    name: ZONE_LABELS[zone],
    value: Math.round(session.zones[zone].seconds * 10) / 10
  }))
  const buckets = useMemo(
    () =>
      bucketTimeline(session.timeline, session.durationSeconds).map((b) => ({
        minute: Math.round((b.start / 60) * 10) / 10,
        camera: round1(b.camera),
        screen: round1(b.screen),
        away: round1(b.away)
      })),
    [session]
  )
  const hasData = session.speakingSeconds > 0

  return (
    <>
      <h1>{session.subject ?? '(no subject)'}</h1>
      <p className="muted">
        {formatDate(session.startedAt)} · {formatDuration(session.durationSeconds)} call ·{' '}
        {formatDuration(session.speakingSeconds)} speaking
      </p>

      {!hasData ? (
        <p>You did not speak in this session, so there is no eye-contact data.</p>
      ) : (
        <>
          <p className="headline" aria-label="Camera eye contact">
            {formatPercent(session.cameraPercent)}
            <span> of your speaking time on camera</span>
          </p>

          <h2>Where you looked</h2>
          <div className="chart" role="img" aria-label="Share of speaking time by gaze zone">
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  data={donut}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={60}
                  outerRadius={95}
                  isAnimationActive={false}
                >
                  {donut.map((d) => (
                    <Cell key={d.zone} fill={ZONE_COLORS[d.zone]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => `${String(v)} s`} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <h2>Over the session</h2>
          <p className="muted">Seconds of speaking time per slice of the call.</p>
          <div className="chart" role="img" aria-label="Gaze zones over the session">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={buckets}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="minute" unit=" min" />
                <YAxis />
                <Tooltip />
                <Legend />
                {ZONE_ORDER.map((zone) => (
                  <Bar
                    key={zone}
                    dataKey={zone}
                    name={ZONE_LABELS[zone]}
                    stackId="gaze"
                    fill={ZONE_COLORS[zone]}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </>
  )
}

const round1 = (n: number): number => Math.round(n * 10) / 10
