import type { HomeStatus } from '../../shared/homeStatus'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const errorLine = $('error')

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
