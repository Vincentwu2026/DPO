import {
  COUNTDOWN_SECONDS,
  liveHint,
  phaseProgress,
  samplesFor,
  STALE_AFTER_MS,
  summarizeFit,
  ZONE_LABELS
} from '../../shared/calibrationModel'
import type { CalibrationUpdate } from '../../main/tracker/protocol'

type Look = 'camera' | 'screen'
type Step = 'intro' | Look | 'fitting' | 'result'

const INSTRUCTIONS: Record<Step, string> = {
  intro:
    'I will learn how your eyes look when you face the camera and when you read your screen, so the coach fits you and your setup. It takes about 20 seconds.',
  camera:
    'Step 1 of 2. Look straight at the camera lens, the glowing target at the top of this window.',
  screen:
    'Step 2 of 2. Now look at the middle of your screen, where you normally watch the other people in a call.',
  fitting: 'Working out your personal settings…',
  result: ''
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing element #${id}`)
  return node as T
}

let step: Step = 'intro'
let latest: CalibrationUpdate | null = null
let lastUpdateAt = 0
/** Bumped on every step change so a late timer or reply from an old step is ignored. */
let token = 0
let busy = false
/** The look whose frames are being collected right now; null between steps. */
let sampling: Look | null = null

function setStatus(text: string): void {
  el('status').textContent = text
}

function showStep(next: Step): void {
  step = next
  sampling = null
  document.body.dataset['step'] = next
  el('instruction').textContent = INSTRUCTIONS[next]
  const intro = next === 'intro'
  const result = next === 'result'
  el('start').hidden = !intro
  el('save').hidden = true
  el('retry').hidden = !result
  el('result').hidden = !result
  el('close').textContent = intro || result ? 'Close' : 'Cancel'
  el('reset').hidden = !intro || !el('saved').dataset['calibrated']
  if (!result) setStatus('')
  render()
}

function render(): void {
  const stale = Date.now() - lastUpdateAt > STALE_AFTER_MS
  const hint = step === 'result' ? null : liveHint(latest, lastUpdateAt === 0 ? false : stale)
  const hintBox = el('face-hint')
  hintBox.hidden = hint === null || (lastUpdateAt === 0 && step === 'intro')
  hintBox.textContent = hint ?? ''

  if (step === 'camera' || step === 'screen') {
    // Counts from an earlier run linger in the tracker until the look really starts.
    const samples = latest && sampling === step ? samplesFor(latest, step) : 0
    el('bar').style.width = `${Math.round(phaseProgress(samples) * 100)}%`
  }
}

function onUpdate(update: CalibrationUpdate): void {
  latest = update
  lastUpdateAt = Date.now()
  if (update.preview) {
    // The main process already checked this is plain base64; it is only ever used as image data.
    el<HTMLImageElement>('preview').src = `data:image/jpeg;base64,${update.preview}`
  }
  el('r-zone').textContent = update.face
    ? ZONE_LABELS[update.zone].replace('Looking ', '')
    : 'no face'
  const num = (value: number | null, digits: number, suffix = ''): string =>
    value === null ? '–' : `${value.toFixed(digits)}${suffix}`
  el('r-h').textContent = num(update.h, 2)
  el('r-v').textContent = num(update.v, 2)
  el('r-yaw').textContent = num(update.yaw, 0, '°')
  el('r-pitch').textContent = num(update.pitch, 0, '°')

  render()
  if (sampling !== null && sampling === step && update.phase === step) {
    if (phaseProgress(samplesFor(update, step)) >= 1) void finishLook(step)
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function runCountdown(mine: number): Promise<boolean> {
  const box = el('countdown')
  box.hidden = false
  for (let n = COUNTDOWN_SECONDS; n >= 1; n--) {
    box.textContent = String(n)
    await sleep(1000)
    if (mine !== token) return false
  }
  box.hidden = true
  return true
}

async function beginLook(look: Look): Promise<void> {
  showStep(look)
  const mine = token
  el('bar').style.width = '0%'
  if (!(await runCountdown(mine))) return
  await window.calibration.setPhase(look)
  if (mine === token) sampling = look
}

async function finishLook(look: Look): Promise<void> {
  // Updates keep arriving while this runs; only the first one may finish the look.
  if (sampling !== look) return
  sampling = null
  token++ // ignore stale countdowns and replies from this look
  await window.calibration.setPhase(null)
  if (look === 'camera') {
    await beginLook('screen')
  } else {
    await runFit()
  }
}

async function runFit(): Promise<void> {
  showStep('fitting')
  const mine = token
  const fit = await window.calibration.fit()
  if (mine !== token) return
  const summary = summarizeFit(fit)
  showStep('result')
  el('title').textContent = 'Calibrate eye contact'
  el('result').dataset['level'] = summary.level
  el('result-title').textContent = summary.title
  el('result-detail').textContent = summary.detail
  el('save').hidden = summary.level !== 'good'
}

async function refreshSaved(): Promise<void> {
  const info = await window.calibration.getInfo().catch(() => null)
  const saved = el('saved')
  if (info) {
    saved.dataset['calibrated'] = '1'
    saved.textContent = `Calibrated on ${new Date(info.calibratedAt).toLocaleDateString()}.`
  } else {
    delete saved.dataset['calibrated']
    saved.textContent = 'Using the default settings (not calibrated yet).'
  }
  if (step === 'intro') el('reset').hidden = !info
}

async function guarded(action: () => Promise<void>): Promise<void> {
  if (busy) return
  busy = true
  try {
    await action()
  } catch {
    setStatus('Something went wrong. Please try again.')
  } finally {
    busy = false
  }
}

el('start').addEventListener('click', () => void guarded(() => beginLook('camera')))
el('retry').addEventListener('click', () => {
  token++
  void guarded(() => beginLook('camera'))
})
el('save').addEventListener(
  'click',
  () =>
    void guarded(async () => {
      if (await window.calibration.apply()) {
        await window.calibration.close()
      } else {
        setStatus('Could not save the calibration.')
      }
    })
)
el('reset').addEventListener(
  'click',
  () =>
    void guarded(async () => {
      await window.calibration.reset()
      await refreshSaved()
      setStatus('Back to the default settings.')
    })
)
el('close').addEventListener('click', () => void window.calibration.close())

window.calibration.onUpdate(onUpdate)
setInterval(render, 1000)
showStep('intro')
void refreshSaved()
