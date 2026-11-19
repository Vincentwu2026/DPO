import type { HomeStatus } from '../../shared/homeStatus'
import {
  GazeAccumulator,
  OffCameraTimer,
  ZONES,
  coachingHint,
  formatElapsed,
  gaugeDashOffset,
  type Zone
} from '../../shared/hudModel'
import type { LiveState } from '../../preload/index.d'

/** 2 * PI * r for the gauge circle (r = 26); must match --gauge-circumference in home.css. */
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 26

const ZONE_LABEL: Record<Zone, string> = {
  camera: 'Camera',
  screen: 'Screen',
  away: 'Away'
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const errorLine = $('error')
const liveEl = $('live')
const gaugeArc = document.getElementById('gauge-arc') as unknown as SVGCircleElement
const toggleBtn = $<HTMLButtonElement>('session-toggle')

const accumulator = new GazeAccumulator()
const offCamera = new OffCameraTimer()
let offCameraSeconds = 0
let alerting = false
let live: LiveState = { active: false, startedAt: null, trackingMode: 'realtime' }

// ---- live panel ------------------------------------------------------------------------------

function renderGaze(): void {
  const zone = accumulator.currentZone
  liveEl.dataset['zone'] = zone ?? 'none'
  $('zone-label').textContent = zone ? ZONE_LABEL[zone] : 'Waiting'

  const percent = accumulator.cameraPercent
  $('gauge-text').textContent = percent === null ? '--' : `${Math.round(percent)}%`
  gaugeArc.style.strokeDashoffset = String(gaugeDashOffset(percent, GAUGE_CIRCUMFERENCE))

  const zones = accumulator.zonePercents
  for (const z of ZONES) {
    const value = zones ? zones[z] : null
    $(`bar-${z}`).style.width = `${value === null ? 0 : Math.round(value)}%`
    $(`pct-${z}`).textContent = value === null ? '--' : `${Math.round(value)}%`
  }
  renderHint()
}

function renderHint(): void {
  const hintEl = $('hint')
  if (!live.active) {
    hintEl.textContent = 'Start a session to begin tracking'
    hintEl.dataset['level'] = 'idle'
    liveEl.classList.remove('alert')
    return
  }
  const hint = coachingHint(accumulator.currentZone, offCameraSeconds, alerting)
  hintEl.textContent = hint.text
  hintEl.dataset['level'] = hint.level
  liveEl.dataset['level'] = hint.level
  liveEl.classList.toggle('alert', alerting)
}

function renderTimer(): void {
  $('timer').textContent = formatElapsed(live.startedAt === null ? 0 : Date.now() - live.startedAt)
}

function renderLive(): void {
  toggleBtn.textContent = live.active ? 'Stop session' : 'Start session'
  toggleBtn.classList.toggle('stop', live.active)
  $('session-state').textContent = live.active ? 'Session running' : 'No session running'
  renderTimer()
  renderHint()
}

function applyLive(next: LiveState): void {
  if (next.startedAt !== live.startedAt) {
    accumulator.reset() // every session starts from a clean gauge
    offCamera.reset()
    offCameraSeconds = 0
    alerting = false
    renderGaze()
  }
  live = next
  renderLive()
}

window.gazeTracker.onUpdate((event) => {
  // The payload crossed an IPC boundary; accept only what the model understands.
  if (!event || typeof event.ts !== 'number' || !ZONES.includes(event.zone)) return
  if (!live.active) return // the tracker may run outside a session; only a session is shown
  accumulator.add({ ts: event.ts, zone: event.zone })
  offCameraSeconds = offCamera.update(event.ts, event.zone)
  renderGaze()
})

window.hud.onAlertFire(() => {
  alerting = true
  renderHint()
})
window.hud.onAlertReset(() => {
  alerting = false
  renderHint()
})

window.home.onLiveState(applyLive)
void window.home.getLiveState().then(applyLive)
setInterval(renderTimer, 500)

toggleBtn.addEventListener('click', () => {
  toggleBtn.disabled = true
  window.home
    .toggleSession()
    .then(applyLive)
    .catch(() => {
      errorLine.textContent = 'Could not start or stop the session.'
    })
    .finally(() => {
      toggleBtn.disabled = false
    })
})

// ---- status list -----------------------------------------------------------------------------

function render(status: HomeStatus): void {
  $('meeting-line').textContent = status.meetingLine
  $('calibration-line').textContent = status.calibrationLine
  $('cloud-line').textContent = status.cloudLine
  $('next-text').textContent = status.nextStep ?? ''
  $('next').hidden = status.nextStep === null
}

async function refresh(): Promise<void> {
  try {
    render(await window.home.getStatus())
  } catch {
    errorLine.textContent = 'Could not load the app status.'
  }
}

$('calibrate').addEventListener('click', () => void window.home.openCalibration())
$('settings').addEventListener('click', () => void window.home.openSettings())

// Pick up changes made elsewhere (a finished calibration) when the window regains focus.
window.addEventListener('focus', () => void refresh())
void refresh()
renderGaze()
