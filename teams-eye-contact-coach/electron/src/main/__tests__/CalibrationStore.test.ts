import { describe, expect, it } from 'vitest'
import { CalibrationStore, type CalibrationBacking } from '../calibration/CalibrationStore'
import type { GazeThresholds } from '../tracker/thresholds'

const GOOD: GazeThresholds = {
  h_center: 0.56,
  h_tolerance: 0.07,
  v_center: 0.03,
  v_tolerance: 0.04,
  yaw_center: 12,
  pitch_center: -8,
  camera_max_yaw: 12,
  camera_max_pitch: 10,
  away_yaw: 40,
  away_pitch: 35
}

function backing(): CalibrationBacking & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>()
  return {
    map,
    get: (k) => map.get(k),
    set: (k, v) => void map.set(k, v),
    delete: (k) => void map.delete(k)
  }
}

describe('CalibrationStore', () => {
  it('starts empty', () => {
    const store = new CalibrationStore(backing())
    expect(store.getThresholds()).toBeNull()
    expect(store.getInfo()).toBeNull()
  })

  it('saves and reads back thresholds with the calibration time', () => {
    const store = new CalibrationStore(backing())
    expect(store.save(GOOD, 1234)).toBe(true)
    expect(store.getThresholds()).toEqual(GOOD)
    expect(store.getInfo()).toEqual({ calibratedAt: 1234 })
  })

  it('refuses invalid thresholds and keeps what was saved before', () => {
    const store = new CalibrationStore(backing())
    store.save(GOOD, 1)
    expect(store.save({ ...GOOD, h_center: 5 }, 2)).toBe(false)
    expect(store.save({ ...GOOD, extra: 1 }, 2)).toBe(false)
    expect(store.save(null, 2)).toBe(false)
    expect(store.getThresholds()).toEqual(GOOD)
    expect(store.getInfo()).toEqual({ calibratedAt: 1 })
  })

  it('ignores tampered stored values', () => {
    const b = backing()
    b.map.set('thresholds', { ...GOOD, away_yaw: 'x' })
    b.map.set('calibratedAt', 5)
    const store = new CalibrationStore(b)
    expect(store.getThresholds()).toBeNull()
    expect(store.getInfo()).toBeNull()
  })

  it('clear removes everything', () => {
    const store = new CalibrationStore(backing())
    store.save(GOOD)
    store.clear()
    expect(store.getThresholds()).toBeNull()
    expect(store.getInfo()).toBeNull()
  })
})
