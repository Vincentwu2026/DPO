import {
  GazeAccumulator,
  OffCameraTimer,
  ZONES,
  coachingHint,
  formatElapsed,
  gaugeDashOffset,
  type Zone
} from '../../shared/hudModel'
import type { AlertPayload, HudState } from '../../preload/index.d'

/** 2 * PI * r for the gauge circle (r = 26); must match --gauge-circumference in hud.css. */
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * 26
const DRAG_CLICK_THRESHOLD_PX = 3

const ZONE_LABEL: Record<Zone, string> = {
  camera: 'Camera',
  screen: 'Screen',
  away: 'Away'
}

function el<T extends HTMLElement | SVGElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing #${id}`)
  return node as unknown as T
}

const hudEl = el<HTMLDivElement>('hud')
const gripEl = el<HTMLDivElement>('grip')
const collapseBtn = el<HTMLButtonElement>('collapse')
const miniEl = el<HTMLDivElement>('mini')
const gaugeArc = el<SVGCircleElement>('gauge-arc')
const gaugeText = el<HTMLSpanElement>('gauge-text')
const zoneLabel = el<HTMLSpanElement>('zone-label')
const timerEl = el<HTMLDivElement>('timer')
const presenterEl = el<HTMLDivElement>('presenter')
const hintEl = el<HTMLDivElement>('hint')
const muteBtn = el<HTMLButtonElement>('mute')
const muteSlash = el<SVGPathElement>('mute-slash')
const muteWaves = el<SVGPathElement>('mute-waves')

const accumulator = new GazeAccumulator()
const offCamera = new OffCameraTimer()
let offCameraSeconds = 0
let alerting = false
let muted = false // HUD-local override of the saved audio setting; resets with the HUD
let state: HudState = {
  sessionStartedAt: null,
  speakerActive: false,
  collapsed: false,
  hintsEnabled: true
}

// ---- rendering -------------------------------------------------------------------------------

function renderGaze(): void {
  const zone = accumulator.currentZone
  hudEl.dataset['zone'] = zone ?? 'none'
  zoneLabel.textContent = zone ? ZONE_LABEL[zone] : 'Waiting'

  const percent = accumulator.cameraPercent
  gaugeText.textContent = percent === null ? '--' : `${Math.round(percent)}%`
  gaugeArc.style.strokeDashoffset = String(gaugeDashOffset(percent, GAUGE_CIRCUMFERENCE))
  renderHint()
}

function renderHint(): void {
  const hint = coachingHint(accumulator.currentZone, offCameraSeconds, alerting)
  hintEl.hidden = !state.hintsEnabled
  hintEl.textContent = hint.text
  hintEl.dataset['level'] = hint.level
  // Amber glow while nudging; the red pulse (alert) takes over after that.
  hudEl.classList.toggle('nudge', state.hintsEnabled && hint.level === 'nudge' && !alerting)
}

function renderMute(): void {
  muteBtn.setAttribute('aria-pressed', String(muted))
  muteBtn.title = muted ? 'Unmute alert sound' : 'Mute alert sound'
  muteBtn.setAttribute('aria-label', muteBtn.title)
  muteSlash.setAttribute('visibility', muted ? 'visible' : 'hidden')
  muteWaves.setAttribute('visibility', muted ? 'hidden' : 'visible')
}

function renderTimer(): void {
  timerEl.textContent = formatElapsed(
    state.sessionStartedAt === null ? 0 : Date.now() - state.sessionStartedAt
  )
}

function renderState(): void {
  hudEl.classList.toggle('collapsed', state.collapsed)
  presenterEl.hidden = !state.speakerActive
  collapseBtn.setAttribute('aria-expanded', String(!state.collapsed))
  renderTimer()
}

function applyState(next: HudState): void {
  if (next.sessionStartedAt !== state.sessionStartedAt) {
    accumulator.reset() // a new session starts from a clean gauge
    offCamera.reset()
    offCameraSeconds = 0
    clearAlert()
    renderGaze()
    renderMute()
  }
  state = next
  renderState()
  renderHint()
}

// ---- gaze feed -------------------------------------------------------------------------------

window.gazeTracker.onUpdate((event) => {
  // The payload crossed an IPC boundary; accept only what the model understands.
  if (!event || typeof event.ts !== 'number' || !ZONES.includes(event.zone)) return
  accumulator.add({ ts: event.ts, zone: event.zone })
  offCameraSeconds = offCamera.update(event.ts, event.zone)
  renderGaze()
  renderMute()
})

setInterval(renderTimer, 500)

// ---- click-through ---------------------------------------------------------------------------
// The window ignores the mouse (forwarding moves so hover still fires); it only becomes
// clickable while the pointer is over a control, then returns to click-through.

let dragging = false
const interactive = [gripEl, miniEl]
for (const node of interactive) {
  node.addEventListener('mouseenter', () => window.hud.setIgnoreMouse(false))
  node.addEventListener('mouseleave', () => {
    if (!dragging) window.hud.setIgnoreMouse(true)
  })
}

// ---- drag (grip when expanded, whole dot when collapsed) ------------------------------------

function attachDrag(handle: HTMLElement, onClick?: () => void): void {
  let start: { x: number; y: number } | null = null
  let moved = false

  // Move/up are tracked on `window` for the duration of the drag rather than relying on pointer
  // capture: the window itself moves under the cursor, and a missed pointerup must never leave
  // the HUD stuck in drag mode.
  const onMove = (e: PointerEvent): void => {
    if (!start) return
    const dx = e.screenX - start.x
    const dy = e.screenY - start.y
    if (Math.hypot(dx, dy) >= DRAG_CLICK_THRESHOLD_PX) moved = true
    if (moved) window.hud.dragMove(dx, dy)
  }
  const finish = (e: PointerEvent): void => {
    if (!start) return
    start = null
    dragging = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', finish)
    window.removeEventListener('pointercancel', finish)
    window.removeEventListener('blur', cancel)
    window.hud.dragEnd()
    if (!handle.matches(':hover')) window.hud.setIgnoreMouse(true)
    if (!moved && e.type === 'pointerup') onClick?.()
  }
  const cancel = (): void => finish(new PointerEvent('pointercancel'))

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('button')) return
    start = { x: e.screenX, y: e.screenY }
    moved = false
    dragging = true
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('blur', cancel)
    window.hud.dragStart()
  })
}

attachDrag(gripEl)
attachDrag(miniEl, () => window.hud.setCollapsed(false))
collapseBtn.addEventListener('click', () => window.hud.setCollapsed(true))
muteBtn.addEventListener('click', () => {
  muted = !muted
  renderMute()
})

// ---- alerts ----------------------------------------------------------------------------------

let audioContext: AudioContext | null = null
let pingBuffer: AudioBuffer | null = null

async function loadPing(): Promise<void> {
  if (pingBuffer) return
  const bytes = await window.hud.getAlertSound()
  if (!bytes) return
  audioContext ??= new AudioContext()
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  pingBuffer = await audioContext.decodeAudioData(copy as ArrayBuffer)
}

async function playPing(): Promise<void> {
  try {
    await loadPing()
    if (!audioContext || !pingBuffer) return
    if (audioContext.state === 'suspended') await audioContext.resume()
    const source = audioContext.createBufferSource()
    source.buffer = pingBuffer
    source.connect(audioContext.destination)
    source.start()
  } catch {
    // Audio is best-effort; the visual alert still shows.
  }
}

function clearAlert(): void {
  alerting = false
  hudEl.classList.remove('alert')
  renderHint()
}

window.hud.onAlertFire((payload: AlertPayload) => {
  alerting = true
  if (payload?.visual === true) hudEl.classList.add('alert')
  if (payload?.audio === true && !muted) void playPing()
  renderHint()
})
window.hud.onAlertReset(clearAlert)

// ---- init ------------------------------------------------------------------------------------

window.hud.onState(applyState)
void window.hud.getState().then(applyState)
renderGaze()
renderMute()
