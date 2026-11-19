import type { HomeStatus } from '../../shared/homeStatus'

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const signInButton = $<HTMLButtonElement>('sign-in')
const errorLine = $('error')

function render(status: HomeStatus): void {
  // textContent only: these strings include the user's name.
  $('user').textContent = status.userName ? `Signed in as ${status.userName}` : 'Not signed in'
  $('meeting-line').textContent = status.meetingLine
  $('calibration-line').textContent = status.calibrationLine
  $('cloud-line').textContent = status.cloudLine
  $('next-text').textContent = status.nextStep ?? ''
  $('next').hidden = status.nextStep === null
  signInButton.hidden = !status.canSignIn
}

async function refresh(): Promise<void> {
  try {
    render(await window.home.getStatus())
  } catch {
    errorLine.textContent = 'Could not load the app status.'
  }
}

signInButton.addEventListener('click', () => {
  errorLine.textContent = ''
  signInButton.disabled = true
  window.auth
    .signIn()
    .catch(() => {
      errorLine.textContent = 'Sign-in did not complete. Please try again.'
    })
    .finally(() => {
      signInButton.disabled = false
      void refresh()
    })
})
$('calibrate').addEventListener('click', () => void window.home.openCalibration())
$('settings').addEventListener('click', () => void window.home.openSettings())

// Pick up changes made elsewhere (tray sign-in, a finished calibration) when the window regains focus.
window.addEventListener('focus', () => void refresh())
void refresh()
