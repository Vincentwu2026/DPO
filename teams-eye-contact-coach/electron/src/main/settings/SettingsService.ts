import Store from 'electron-store'

export type TrackingMode = 'realtime' | 'postcall' | 'both'
export type Stability = 'responsive' | 'balanced' | 'steady'

export interface Settings {
  trackingMode: TrackingMode
  cameraIndex: number
  alertThresholdSeconds: number
  alertAudioEnabled: boolean
  alertVisualEnabled: boolean
  /** How strongly the camera/screen/away zone is smoothed (steadier = slower to react). */
  gazeStability: Stability
  /** Show the real-time "look at the camera" coaching line on the HUD. */
  coachingHintsEnabled: boolean
}

export type SettingsKey = keyof Settings

export const DEFAULT_SETTINGS: Settings = {
  trackingMode: 'both',
  cameraIndex: 0,
  alertThresholdSeconds: 5,
  alertAudioEnabled: true,
  alertVisualEnabled: true,
  gazeStability: 'balanced',
  coachingHintsEnabled: true
}

const TRACKING_MODES: readonly TrackingMode[] = ['realtime', 'postcall', 'both']
export const STABILITY_PRESETS: readonly Stability[] = ['responsive', 'balanced', 'steady']

/** Server-side validation: values arrive from the renderer over IPC and must not be trusted. */
const validators: { [K in SettingsKey]: (value: unknown) => value is Settings[K] } = {
  trackingMode: (v): v is TrackingMode => TRACKING_MODES.includes(v as TrackingMode),
  // The Python tracker probes camera indices 0-9 only.
  cameraIndex: (v): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 9,
  alertThresholdSeconds: (v): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 1 && v <= 30,
  alertAudioEnabled: (v): v is boolean => typeof v === 'boolean',
  alertVisualEnabled: (v): v is boolean => typeof v === 'boolean',
  gazeStability: (v): v is Stability => STABILITY_PRESETS.includes(v as Stability),
  coachingHintsEnabled: (v): v is boolean => typeof v === 'boolean'
}

export function isSettingsKey(key: unknown): key is SettingsKey {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(validators, key)
}

export class SettingsService {
  private readonly store: Store<Settings>

  constructor() {
    this.store = new Store<Settings>({ name: 'settings', defaults: DEFAULT_SETTINGS })
  }

  get<K extends SettingsKey>(key: K): Settings[K] {
    return this.store.get(key)
  }

  set<K extends SettingsKey>(key: K, value: unknown): void {
    if (!isSettingsKey(key) || !validators[key](value)) {
      throw new Error(`Invalid value for setting "${String(key)}"`)
    }
    this.store.set(key, value)
  }

  getAll(): Settings {
    return {
      trackingMode: this.get('trackingMode'),
      cameraIndex: this.get('cameraIndex'),
      alertThresholdSeconds: this.get('alertThresholdSeconds'),
      alertAudioEnabled: this.get('alertAudioEnabled'),
      alertVisualEnabled: this.get('alertVisualEnabled'),
      gazeStability: this.get('gazeStability'),
      coachingHintsEnabled: this.get('coachingHintsEnabled')
    }
  }

  getTrackingMode(): TrackingMode {
    return this.get('trackingMode')
  }
  setTrackingMode(mode: TrackingMode): void {
    this.set('trackingMode', mode)
  }

  getCameraIndex(): number {
    return this.get('cameraIndex')
  }
  setCameraIndex(index: number): void {
    this.set('cameraIndex', index)
  }

  getAlertThresholdSeconds(): number {
    return this.get('alertThresholdSeconds')
  }
  setAlertThresholdSeconds(seconds: number): void {
    this.set('alertThresholdSeconds', seconds)
  }

  getAlertAudioEnabled(): boolean {
    return this.get('alertAudioEnabled')
  }
  setAlertAudioEnabled(enabled: boolean): void {
    this.set('alertAudioEnabled', enabled)
  }

  getAlertVisualEnabled(): boolean {
    return this.get('alertVisualEnabled')
  }
  setAlertVisualEnabled(enabled: boolean): void {
    this.set('alertVisualEnabled', enabled)
  }

  getGazeStability(): Stability {
    return this.get('gazeStability')
  }

  getCoachingHintsEnabled(): boolean {
    return this.get('coachingHintsEnabled')
  }
}
