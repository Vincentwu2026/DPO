import type { SettingsValues } from '../../preload/index.d'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const cameraSelect = $<HTMLSelectElement>('cameraIndex')
const threshold = $<HTMLInputElement>('alertThresholdSeconds')
const thresholdLabel = $<HTMLSpanElement>('thresholdLabel')
const audio = $<HTMLInputElement>('alertAudioEnabled')
const visual = $<HTMLInputElement>('alertVisualEnabled')
const hints = $<HTMLInputElement>('coachingHintsEnabled')
const stability = $<HTMLSelectElement>('gazeStability')
const modeRadios = document.querySelectorAll<HTMLInputElement>('input[name="trackingMode"]')

function selectedMode(): SettingsValues['trackingMode'] {
  const checked = Array.from(modeRadios).find((r) => r.checked)
  return (checked?.value ?? 'both') as SettingsValues['trackingMode']
}

async function load(): Promise<void> {
  const [values, devices] = await Promise.all([
    window.settings.getAll(),
    window.settings.getCameraDevices()
  ])

  cameraSelect.replaceChildren(
    ...devices.map((d) => {
      const option = document.createElement('option')
      option.value = String(d.index)
      option.textContent = d.label // textContent: never innerHTML
      return option
    })
  )
  cameraSelect.value = String(values.cameraIndex)
  modeRadios.forEach((r) => (r.checked = r.value === values.trackingMode))
  threshold.value = String(values.alertThresholdSeconds)
  thresholdLabel.textContent = threshold.value
  audio.checked = values.alertAudioEnabled
  visual.checked = values.alertVisualEnabled
  hints.checked = values.coachingHintsEnabled
  stability.value = values.gazeStability
}

threshold.addEventListener('input', () => {
  thresholdLabel.textContent = threshold.value
})

$('save').addEventListener('click', () => {
  void window.settings
    .save({
      trackingMode: selectedMode(),
      cameraIndex: Number(cameraSelect.value),
      alertThresholdSeconds: Number(threshold.value),
      alertAudioEnabled: audio.checked,
      alertVisualEnabled: visual.checked,
      coachingHintsEnabled: hints.checked,
      gazeStability: stability.value as SettingsValues['gazeStability']
    })
    .then(() => window.close())
})

$('close').addEventListener('click', () => window.close())

void load()
