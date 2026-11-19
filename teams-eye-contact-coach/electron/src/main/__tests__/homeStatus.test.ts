import { describe, expect, it } from 'vitest'
import { buildHomeStatus } from '../../shared/homeStatus'

const manual = {
  userName: null,
  meetingConfigured: false,
  cloudConfigured: false,
  calibrated: true
}

describe('buildHomeStatus', () => {
  it('has no next step when calibrated', () => {
    expect(buildHomeStatus(manual).nextStep).toBeNull()
  })

  it('suggests calibration when not calibrated', () => {
    expect(buildHomeStatus({ ...manual, calibrated: false }).nextStep).toMatch(/Calibrate/)
  })

  it('tells the user to start sessions by hand, and never asks to sign in', () => {
    const s = buildHomeStatus({ ...manual, calibrated: false })
    expect(s.meetingLine).toMatch(/Start Session/)
    expect(`${s.meetingLine} ${s.nextStep}`).not.toMatch(/sign in/i)
  })

  it('still says calls are watched when an earlier sign-in is active and configured', () => {
    const s = buildHomeStatus({ ...manual, userName: 'Ada', meetingConfigured: true })
    expect(s.meetingLine).toMatch(/Watching for Teams calls/)
  })

  it('says sessions stay local without a cloud configuration', () => {
    expect(buildHomeStatus(manual).cloudLine).toMatch(/stay on this computer/)
  })
})
