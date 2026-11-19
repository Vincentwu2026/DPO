import { ZONES, formatElapsed, type Zone } from '../../shared/hudModel'
import type { ReportData } from '../../shared/reportModel'

const ZONE_LABEL: Record<Zone, string> = { camera: 'Camera', screen: 'Screen', away: 'Away' }
const ZONE_COLOR: Record<Zone, string> = {
  camera: '#22a559',
  screen: '#e8a000',
  away: '#d64545'
}
const MODE_LABEL: Record<string, string> = {
  realtime: 'Real-time',
  postcall: 'Post-call',
  both: 'Real-time + post-call'
}
const SVG_NS = 'http://www.w3.org/2000/svg'

function el<T extends HTMLElement | SVGElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing #${id}`)
  return node as unknown as T
}

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag)
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v))
  return node
}

const formatDuration = (seconds: number): string => formatElapsed(seconds * 1000)

function renderDonut(report: ReportData): void {
  const donut = el<SVGSVGElement>('donut')
  donut.replaceChildren()
  const r = 44
  const circumference = 2 * Math.PI * r
  donut.append(
    svg('circle', { cx: 60, cy: 60, r, fill: 'none', stroke: '#e5e7eb', 'stroke-width': 16 })
  )
  const total = ZONES.reduce((sum, z) => sum + report.zones[z].seconds, 0)
  if (total <= 0) return
  let offset = 0
  for (const zone of ZONES) {
    const length = (report.zones[zone].seconds / total) * circumference
    if (length <= 0) continue
    donut.append(
      svg('circle', {
        cx: 60,
        cy: 60,
        r,
        fill: 'none',
        stroke: ZONE_COLOR[zone],
        'stroke-width': 16,
        'stroke-dasharray': `${length} ${circumference - length}`,
        'stroke-dashoffset': -offset,
        transform: 'rotate(-90 60 60)'
      })
    )
    offset += length
  }
}

function renderLegend(report: ReportData): void {
  el('legend').replaceChildren(
    ...ZONES.map((zone) => {
      const li = document.createElement('li')
      const swatch = document.createElement('span')
      swatch.className = 'swatch'
      swatch.dataset['zone'] = zone
      const text = document.createElement('span')
      const share = report.zones[zone]
      text.textContent = `${ZONE_LABEL[zone]}: ${Math.round(share.percent)}% (${formatDuration(share.seconds)})`
      li.append(swatch, text)
      return li
    })
  )
}

function renderTimeline(report: ReportData): void {
  const chart = el<SVGSVGElement>('timeline')
  chart.replaceChildren()
  const { buckets, bucketSeconds } = report.timeline
  if (buckets.length === 0) return
  const width = 400
  const height = 140
  const slot = width / buckets.length
  const peak = Math.max(1e-9, bucketSeconds, ...buckets.map((b) => b.camera + b.screen + b.away))
  buckets.forEach((bucket, i) => {
    let y = height
    for (const zone of ZONES) {
      const h = (bucket[zone] / peak) * (height - 4)
      if (h <= 0) continue
      y -= h
      chart.append(
        svg('rect', {
          x: i * slot + 0.5,
          y,
          width: Math.max(slot - 1, 0.5),
          height: h,
          fill: ZONE_COLOR[zone]
        })
      )
    }
  })
  el('axis-end').textContent = formatDuration(bucketSeconds * buckets.length)
}

function render(report: ReportData): void {
  // textContent only: the subject comes from Teams and must never be parsed as markup.
  el('title').textContent = report.subject ?? 'Eye contact report'
  el('meta').textContent = `${new Date(report.startedAt * 1000).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  })} · ${formatDuration(report.durationSeconds)} call`
  el('mode-badge').textContent = `Tracking mode: ${MODE_LABEL[report.trackingMode] ?? 'Unknown'}`

  el('headline-value').textContent = `${Math.round(report.cameraPercent)}%`
  el('headline-label').textContent =
    report.basis === 'speaking'
      ? `of your speaking time (${formatDuration(report.trackedSeconds)}) was on camera`
      : `of the call (${formatDuration(report.trackedSeconds)}) was on camera. You were not the active speaker for long, so this covers the whole call.`

  renderDonut(report)
  renderLegend(report)
  renderTimeline(report)

  el('tips').replaceChildren(
    ...report.tips.map((tip) => {
      const li = document.createElement('li')
      li.dataset['level'] = tip.level
      li.textContent = tip.text
      return li
    })
  )
  el<HTMLButtonElement>('history').hidden = !report.canViewHistory
}

function setStatus(text: string): void {
  el('status').textContent = text
}

async function init(): Promise<void> {
  let report: ReportData | null
  try {
    report = await window.report.get()
  } catch {
    report = null
  }
  el<HTMLElement>('loading').hidden = true
  if (!report) {
    el<HTMLElement>('empty').hidden = false
    return
  }
  render(report)
  el<HTMLElement>('content').hidden = false
}

el('close').addEventListener('click', () => void window.report.close())
el('history').addEventListener('click', () => {
  void window.report.openHistory().then((opened) => {
    if (!opened) setStatus('The dashboard is not available.')
  })
})
el<HTMLButtonElement>('export').addEventListener('click', (event) => {
  const button = event.currentTarget as HTMLButtonElement
  button.disabled = true
  setStatus('Saving…')
  void window.report
    .exportPdf()
    .then((result) =>
      setStatus(result.ok ? `Saved ${result.fileName} to Downloads.` : 'Could not save the PDF.')
    )
    .catch(() => setStatus('Could not save the PDF.'))
    .finally(() => {
      button.disabled = false
    })
})

void init()
