import {
  GazeAccumulator,
  ZONES,
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

const accumulator = new GazeAccumulator()
let state: HudState = { sessionStartedAt: null, speakerActive: false, collapsed: false }

// ---- rendering -------------------------------------------------------------------------------

function renderGaze(): void {
  const zone = accumulator.currentZone
  hudEl.dataset['zone'] = zone ?? 'none'
  zoneLabel.textContent = zone ? ZONE_LABEL[zone] : 'Waiting'

  const percent = accumulator.cameraPercent
  gaugeText.textContent = percent === null ? '--' : `${Math.round(percent)}%`
  gaugeArc.style.strokeDashoffset = String(gaugeDashOffset(percent, GAUGE_CIRCUMFERENCE))
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
    renderGaze()
    clearAlert()
  }
  state = next
  renderState()
}

// ---- gaze feed -------------------------------------------------------------------------------

window.gazeTracker.onUpdate((event) => {
  // The payload crossed an IPC boundary; accept only what the model understands.
  if (!event || typeof event.ts !== 'number' || !ZONES.includes(event.zone)) return
  accumulator.add({ ts: event.ts, zone: event.zone })
  renderGaze()
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

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('button')) return
    start = { x: e.screenX, y: e.screenY }
    moved = false
    dragging = true
    handle.setPointerCapture(e.pointerId)
    window.hud.dragStart()
  })
  handle.addEventListener('pointermove', (e) => {
    if (!start) return
    const dx = e.screenX - start.x
    const dy = e.screenY - start.y
    if (Math.hypot(dx, dy) >= DRAG_CLICK_THRESHOLD_PX) moved = true
    if (moved) window.hud.dragMove(dx, dy)
  })
  const finish = (e: PointerEvent): void => {
    if (!start) return
    start = null
    dragging = false
    if (handle.hasPointerCapture(e.pointerId)) handle.releasePointerCapture(e.pointerId)
    window.hud.dragEnd()
    if (!handle.matches(':hover')) window.hud.setIgnoreMouse(true)
    if (!moved && e.type === 'pointerup') onClick?.()
  }
  handle.addEventListener('pointerup', finish)
  handle.addEventListener('pointercancel', finish)
}

attachDrag(gripEl)
attachDrag(miniEl, () => window.hud.setCollapsed(false))
collapseBtn.addEventListener('click', () => window.hud.setCollapsed(true))

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
  hudEl.classList.remove('alert')
}

window.hud.onAlertFire((payload: AlertPayload) => {
  if (payload?.visual === true) hudEl.classList.add('alert')
  if (payload?.audio === true) void playPing()
})
window.hud.onAlertReset(clearAlert)

// ---- init ------------------------------------------------------------------------------------

window.hud.onState(applyState)
void window.hud.getState().then(applyState)
renderGaze()
