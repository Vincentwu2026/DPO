export interface HomeStatusInput {
  /** Set only when a Microsoft sign-in from an earlier version is still active. */
  userName: string | null
  /** Meeting detection needs the relay URL and client state to be configured. */
  meetingConfigured: boolean
  cloudConfigured: boolean
  calibrated: boolean
}

export interface HomeStatus {
  /** One line on how calls are started. */
  meetingLine: string
  cloudLine: string
  calibrationLine: string
  /** What the user should do next, or null when everything is set up. */
  nextStep: string | null
}

/** Builds the plain-language status shown in the launch window. Pure, so it is easy to test. */
export function buildHomeStatus(input: HomeStatusInput): HomeStatus {
  const detecting = input.userName !== null && input.meetingConfigured
  const meetingLine = detecting
    ? 'Watching for Teams calls. Tracking starts when a call begins.'
    : 'Choose Start Session in the menu bar icon when your Teams call begins, and Stop Session when it ends.'

  const cloudLine = input.cloudConfigured
    ? 'Speaking-time summaries sync to your dashboard after each call.'
    : 'Cloud dashboard is not configured. Sessions stay on this computer.'

  const calibrationLine = input.calibrated
    ? 'Calibrated to your camera and screen.'
    : 'Not calibrated. Calibrating takes about a minute and makes eye-contact results more accurate.'

  return {
    meetingLine,
    cloudLine,
    calibrationLine,
    nextStep: input.calibrated ? null : 'Calibrate your camera for accurate results.'
  }
}
