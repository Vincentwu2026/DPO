export interface HomeStatusInput {
  userName: string | null
  /** Meeting detection needs the relay URL and client state to be configured. */
  meetingConfigured: boolean
  cloudConfigured: boolean
  calibrated: boolean
}

export interface HomeStatus {
  signedIn: boolean
  /** True when signing in would enable call detection. */
  canSignIn: boolean
  userName: string | null
  /** One line on whether calls will be detected. */
  meetingLine: string
  cloudLine: string
  calibrationLine: string
  /** What the user should do next, or null when everything is set up. */
  nextStep: string | null
}

/** Builds the plain-language status shown in the launch window. Pure, so it is easy to test. */
export function buildHomeStatus(input: HomeStatusInput): HomeStatus {
  const signedIn = input.userName !== null
  let meetingLine: string
  if (!input.meetingConfigured) {
    meetingLine = 'Call detection is not set up in this build. Ask your admin for the app settings.'
  } else if (!signedIn) {
    meetingLine = 'Sign in to start detecting your Teams calls.'
  } else {
    meetingLine = 'Watching for Teams calls. Tracking starts when a call begins.'
  }

  const cloudLine = input.cloudConfigured
    ? 'Speaking-time summaries sync to your dashboard after each call.'
    : 'Cloud dashboard is not configured. Sessions stay on this computer.'

  const calibrationLine = input.calibrated
    ? 'Calibrated to your camera and screen.'
    : 'Not calibrated. Calibrating takes about a minute and makes eye-contact results more accurate.'

  let nextStep: string | null = null
  if (!signedIn && input.meetingConfigured) nextStep = 'Sign in with your Microsoft account.'
  else if (!input.calibrated) nextStep = 'Calibrate your camera for accurate results.'

  return {
    signedIn,
    canSignIn: !signedIn && input.meetingConfigured,
    userName: input.userName,
    meetingLine,
    cloudLine,
    calibrationLine,
    nextStep
  }
}
