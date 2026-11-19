import { describe, expect, it } from 'vitest'
import {
  liveHint,
  phaseProgress,
  samplesFor,
  summarizeFit,
  TARGET_SAMPLES
} from '../../shared/calibrationModel'
import type { CalibrationUpdate } from '../tracker/protocol'

const update = (patch: Partial<CalibrationUpdate> = {}): CalibrationUpdate => ({
  face: true,
  h: 0.5,
  v: 0,
  yaw: 0,
  pitch: 0,
  zone: 'camera',
  phase: 'camera',
  cameraSamples: 10,
  screenSamples: 4,
  preview: null,
  ...patch
})

const fit = (cameraHit: number, screenHit: number, good: boolean) => ({
  good,
  cameraSamples: 60,
  screenSamples: 60,
  cameraHit,
  screenHit
})

describe('phaseProgress', () => {
  it('is 0 to 1 and clamped', () => {
    expect(phaseProgress(0)).toBe(0)
    expect(phaseProgress(-5)).toBe(0)
    expect(phaseProgress(NaN)).toBe(0)
    expect(phaseProgress(TARGET_SAMPLES / 2)).toBe(0.5)
    expect(phaseProgress(TARGET_SAMPLES)).toBe(1)
    expect(phaseProgress(TARGET_SAMPLES * 3)).toBe(1)
  })
})

describe('samplesFor', () => {
  it('reads the counter of the requested look', () => {
    expect(samplesFor(update(), 'camera')).toBe(10)
    expect(samplesFor(update(), 'screen')).toBe(4)
  })
})

describe('liveHint', () => {
  it('asks for a working camera when nothing has arrived or the feed went stale', () => {
    expect(liveHint(null, false)).toMatch(/No video/)
    expect(liveHint(update(), true)).toMatch(/No video/)
  })
  it('asks the user to face the camera when no face is found', () => {
    expect(liveHint(update({ face: false }), false)).toMatch(/cannot see your face/)
  })
  it('is silent when all is well', () => {
    expect(liveHint(update(), false)).toBeNull()
  })
})

describe('summarizeFit', () => {
  it('explains missing data', () => {
    expect(summarizeFit(null)).toMatchObject({ level: 'warn', title: 'Not enough face data' })
  })
  it('reports a good fit with the recognition rates', () => {
    const s = summarizeFit(fit(0.97, 0.9, true))
    expect(s).toEqual({
      level: 'good',
      title: 'Calibration looks good',
      detail: 'Camera looks recognised 97%, screen looks 90%.'
    })
  })
  it('blames an unsteady lens look when camera frames were missed', () => {
    expect(summarizeFit(fit(0.6, 0.9, false)).title).toBe('Your look at the lens was not steady')
  })
  it('reports lens and screen looking alike when the screen look is missed', () => {
    expect(summarizeFit(fit(0.95, 0.4, false)).title).toBe('Lens and screen looked almost the same')
  })
})
