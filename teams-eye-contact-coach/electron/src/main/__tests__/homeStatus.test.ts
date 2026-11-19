import { describe, expect, it } from 'vitest'
import { buildHomeStatus } from '../../shared/homeStatus'

const ready = { userName: 'Ada', meetingConfigured: true, cloudConfigured: true, calibrated: true }

describe('buildHomeStatus', () => {
  it('has no next step when everything is set up', () => {
    const s = buildHomeStatus(ready)
    expect(s.signedIn).toBe(true)
    expect(s.nextStep).toBeNull()
    expect(s.meetingLine).toMatch(/Watching for Teams calls/)
  })

  it('asks a signed-out user to sign in first', () => {
    const s = buildHomeStatus({ ...ready, userName: null, calibrated: false })
    expect(s.signedIn).toBe(false)
    expect(s.canSignIn).toBe(true)
    expect(s.nextStep).toMatch(/Sign in/)
    expect(s.meetingLine).toMatch(/Sign in/)
  })

  it('suggests calibration once signed in', () => {
    expect(buildHomeStatus({ ...ready, calibrated: false }).nextStep).toMatch(/Calibrate/)
  })

  it('does not ask to sign in when call detection is not configured', () => {
    const s = buildHomeStatus({ ...ready, userName: null, meetingConfigured: false })
    expect(s.meetingLine).toMatch(/not set up/)
    expect(s.nextStep).toBeNull()
    expect(s.canSignIn).toBe(false)
  })

  it('says sessions stay local without a cloud configuration', () => {
    expect(buildHomeStatus({ ...ready, cloudConfigured: false }).cloudLine).toMatch(
      /stay on this computer/
    )
  })
})
