import { beforeEach, describe, expect, it, vi } from 'vitest'

// In-memory stand-in for electron-store: honours `defaults`, no disk or Electron needed.
vi.mock('electron-store', () => ({
  default: class MemoryStore<T extends Record<string, unknown>> {
    private data: T
    constructor(options: { defaults: T }) {
      this.data = { ...options.defaults }
    }
    get<K extends keyof T>(key: K): T[K] {
      return this.data[key]
    }
    set<K extends keyof T>(key: K, value: T[K]): void {
      this.data[key] = value
    }
  }
}))

import { DEFAULT_SETTINGS, isSettingsKey, SettingsService } from '../settings/SettingsService'

describe('SettingsService', () => {
  let settings: SettingsService

  beforeEach(() => {
    settings = new SettingsService()
  })

  it('returns the documented defaults', () => {
    expect(settings.getAll()).toEqual({
      trackingMode: 'both',
      cameraIndex: 0,
      alertThresholdSeconds: 5,
      alertAudioEnabled: true,
      alertVisualEnabled: true,
      gazeStability: 'balanced',
      coachingHintsEnabled: true
    })
    expect(settings.getAll()).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips each setting through typed setters and getters', () => {
    settings.setTrackingMode('postcall')
    settings.setCameraIndex(2)
    settings.setAlertThresholdSeconds(12)
    settings.setAlertAudioEnabled(false)
    settings.setAlertVisualEnabled(false)
    settings.set('gazeStability', 'steady')
    settings.set('coachingHintsEnabled', false)

    expect(settings.getTrackingMode()).toBe('postcall')
    expect(settings.getCameraIndex()).toBe(2)
    expect(settings.getAlertThresholdSeconds()).toBe(12)
    expect(settings.getAlertAudioEnabled()).toBe(false)
    expect(settings.getAlertVisualEnabled()).toBe(false)
    expect(settings.getGazeStability()).toBe('steady')
    expect(settings.getCoachingHintsEnabled()).toBe(false)
  })

  it('supports generic get/set by key (used by the IPC handlers)', () => {
    settings.set('trackingMode', 'realtime')
    expect(settings.get('trackingMode')).toBe('realtime')
  })

  describe('validation of untrusted values', () => {
    it.each([
      ['trackingMode', 'sometimes'],
      ['trackingMode', 3],
      ['cameraIndex', -1],
      ['cameraIndex', 1.5],
      ['cameraIndex', '0'],
      ['alertThresholdSeconds', 0],
      ['alertThresholdSeconds', 31],
      ['alertThresholdSeconds', Number.NaN],
      ['alertAudioEnabled', 'yes'],
      ['alertVisualEnabled', 1],
      ['gazeStability', 'extreme'],
      ['gazeStability', 2],
      ['coachingHintsEnabled', 'on']
    ] as const)('rejects %s = %j and leaves the stored value unchanged', (key, value) => {
      const before = settings.get(key)
      expect(() => settings.set(key, value)).toThrow(/Invalid value/)
      expect(settings.get(key)).toBe(before)
    })

    it('accepts boundary values', () => {
      settings.set('alertThresholdSeconds', 1)
      settings.set('alertThresholdSeconds', 30)
      expect(settings.getAlertThresholdSeconds()).toBe(30)
    })
  })

  describe('isSettingsKey', () => {
    it('accepts known keys only', () => {
      expect(isSettingsKey('trackingMode')).toBe(true)
      expect(isSettingsKey('__proto__')).toBe(false)
      expect(isSettingsKey('toString')).toBe(false)
      expect(isSettingsKey(42)).toBe(false)
    })
  })
})
