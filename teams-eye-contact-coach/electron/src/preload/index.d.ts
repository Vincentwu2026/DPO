export interface PreloadApi {
  platform: NodeJS.Platform
}

export interface SettingsValues {
  trackingMode: 'realtime' | 'postcall' | 'both'
  cameraIndex: number
  cameraAuto: boolean
  alertThresholdSeconds: number
  alertAudioEnabled: boolean
  alertVisualEnabled: boolean
  gazeStability: 'responsive' | 'balanced' | 'steady'
  coachingHintsEnabled: boolean
}

export interface CameraDevice {
  index: number
  label: string
}

export interface SettingsApi {
  get<K extends keyof SettingsValues>(key: K): Promise<SettingsValues[K]>
  set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]): Promise<void>
  getAll(): Promise<SettingsValues>
  save(values: SettingsValues): Promise<void>
  getCameraDevices(): Promise<CameraDevice[]>
}

type Unsubscribe = () => void

export interface MeetingApi {
  onMeetingStarted(cb: () => void): Unsubscribe
  onMeetingEnded(cb: () => void): Unsubscribe
  onSpeakerActive(cb: () => void): Unsubscribe
  onSpeakerInactive(cb: () => void): Unsubscribe
  startTracking(): Promise<boolean>
  stopTracking(): Promise<boolean>
}

export type GazeZone = 'camera' | 'screen' | 'away'

export interface GazeEvent {
  /** Unix time in seconds */
  ts: number
  zone: GazeZone
  /** 0..1 */
  confidence: number
}

export interface TrackerDeviceInfo {
  index: number
  name: string
}

export interface TrackerError {
  message: string
  /** true once automatic restarts are exhausted */
  fatal: boolean
}

export interface GazeTrackerApi {
  onUpdate(cb: (event: GazeEvent) => void): Unsubscribe
  onError(cb: (error: TrackerError) => void): Unsubscribe
  onDevices(cb: (devices: TrackerDeviceInfo[]) => void): Unsubscribe
  /** Persists the choice and hot-swaps the running tracker; resolves false if no tracker is running. */
  setCamera(index: number): Promise<boolean>
  /** Index of the camera selected in Teams (0 if unknown). */
  getTeamsCameraIndex(): Promise<number>
}

export interface SessionMeta {
  id: string
  meetingId: string | null
  subject: string | null
  trackingMode: SettingsValues['trackingMode']
  /** Unix seconds */
  startedAt: number
  endedAt: number | null
}

export interface ZoneStat {
  seconds: number
  /** Share of tracked time, 0–100 */
  percent: number
  events: number
}

export interface ZoneBreakdown {
  trackedSeconds: number
  zones: Record<GazeZone, ZoneStat>
  cameraPercent: number
}

export interface SessionSummary extends SessionMeta, ZoneBreakdown {
  durationSeconds: number
  /** The same breakdown restricted to time the user was the active speaker. */
  speaking: ZoneBreakdown
}

export interface SessionsApi {
  list(): Promise<SessionMeta[]>
  getSummary(sessionId: string): Promise<SessionSummary | null>
}

export interface ReportApi {
  /** The report for the session main opened this window for; null if unavailable. */
  get(): Promise<import('../shared/reportModel').ReportData | null>
  exportPdf(): Promise<{ ok: true; fileName: string } | { ok: false }>
  /** Opens the cloud dashboard in the default browser; false if none is configured. */
  openHistory(): Promise<boolean>
  close(): Promise<void>
}

export interface CalibrationApi {
  /** Live reading (about 10 per second) while the window is open. */
  onUpdate(cb: (update: import('../main/tracker/protocol').CalibrationUpdate) => void): Unsubscribe
  /** Which look is being sampled; null pauses sampling. */
  setPhase(phase: 'camera' | 'screen' | null): Promise<boolean>
  /** Fits personal thresholds from the two looks; null if there was not enough face data. */
  fit(): Promise<import('../shared/calibrationModel').CalibrationFitStats | null>
  /** Saves the last good fit and starts using it. */
  apply(): Promise<boolean>
  /** Forgets the personal calibration and goes back to the built-in defaults. */
  reset(): Promise<void>
  getInfo(): Promise<{ calibratedAt: number } | null>
  close(): Promise<void>
}

export interface HomeApi {
  getStatus(): Promise<import('../shared/homeStatus').HomeStatus>
  openCalibration(): Promise<void>
  openSettings(): Promise<void>
}

export interface HudState {
  /** Epoch ms when the current session started; null while no session is open. */
  sessionStartedAt: number | null
  speakerActive: boolean
  collapsed: boolean
  hintsEnabled: boolean
}

export interface AlertPayload {
  visual: boolean
  audio: boolean
}

export interface HudApi {
  getState(): Promise<HudState>
  /** Bundled alert ping (WAV bytes), or null if it could not be read. */
  getAlertSound(): Promise<Uint8Array | null>
  onState(cb: (state: HudState) => void): Unsubscribe
  onAlertFire(cb: (payload: AlertPayload) => void): Unsubscribe
  onAlertReset(cb: () => void): Unsubscribe
  /** true = clicks pass through to the window beneath; false while hovering a control. */
  setIgnoreMouse(ignore: boolean): void
  dragStart(): void
  /** Screen-pixel offset from where the drag began. */
  dragMove(dx: number, dy: number): void
  dragEnd(): void
  setCollapsed(collapsed: boolean): void
}

declare global {
  interface Window {
    api: PreloadApi
    settings: SettingsApi
    meeting: MeetingApi
    gazeTracker: GazeTrackerApi
    hud: HudApi
    home: HomeApi
    report: ReportApi
    calibration: CalibrationApi
    sessions: SessionsApi
  }
}
