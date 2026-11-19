import { parseThresholds, type GazeThresholds } from './thresholds'

/** Wire protocol of the Python gaze tracker (newline-delimited JSON on stdout). See python/main.py. */

export const GAZE_ZONES = ['camera', 'screen', 'away'] as const
export type GazeZone = (typeof GAZE_ZONES)[number]

/** The tracker probes camera indices 0-9 only. */
export const MAX_CAMERA_INDEX = 9
const MAX_TEXT_LENGTH = 200

export interface GazeEvent {
  ts: number
  zone: GazeZone
  confidence: number
}

export interface TrackerDevice {
  index: number
  name: string
}

export interface TrackerError {
  message: string
  /** true once automatic restarts are exhausted; false for non-fatal tracker-reported errors */
  fatal: boolean
}

export const CALIBRATION_PHASES = ['camera', 'screen'] as const
export type CalibrationPhase = (typeof CALIBRATION_PHASES)[number]

/** One live reading while the calibration window is open. Numbers are null without a face. */
export interface CalibrationUpdate {
  face: boolean
  h: number | null
  v: number | null
  yaw: number | null
  pitch: number | null
  zone: GazeZone
  phase: CalibrationPhase | null
  cameraSamples: number
  screenSamples: number
  /** Base64 JPEG of the mirrored webcam view, or null. Never leaves the device. */
  preview: string | null
}

export interface CalibrationFit {
  good: boolean
  cameraSamples: number
  screenSamples: number
  /** Share (0-1) of the "lens" frames the new thresholds classify as camera. */
  cameraHit: number
  /** Share (0-1) of the "screen" frames the new thresholds classify as screen. */
  screenHit: number
  thresholds: GazeThresholds
}

export type TrackerMessage =
  | { type: 'ready'; version: string }
  | ({ type: 'gaze' } & GazeEvent)
  | { type: 'devices'; list: TrackerDevice[] }
  | { type: 'error'; message: string }
  | ({ type: 'calibration' } & CalibrationUpdate)
  /** `result` is null when there were too few usable frames to fit. */
  | { type: 'calibration_result'; result: CalibrationFit | null }

const MAX_PREVIEW_LENGTH = 200_000
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const MAX_SAMPLES = 100_000

export const STABILITY_PRESETS = ['responsive', 'balanced', 'steady'] as const

export function isValidStability(value: unknown): value is (typeof STABILITY_PRESETS)[number] {
  return STABILITY_PRESETS.includes(value as (typeof STABILITY_PRESETS)[number])
}

export function isValidCameraIndex(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= MAX_CAMERA_INDEX
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_SAMPLES
const isShare = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
const isReading = (v: unknown): v is number | null =>
  v === null || (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1000)

function parseCalibrationUpdate(data: Record<string, unknown>): TrackerMessage | null {
  const { face, h, v, yaw, pitch, zone, phase, camera_samples, screen_samples, preview } = data
  if (
    typeof face !== 'boolean' ||
    !isReading(h) ||
    !isReading(v) ||
    !isReading(yaw) ||
    !isReading(pitch) ||
    !GAZE_ZONES.includes(zone as GazeZone) ||
    !(phase === null || CALIBRATION_PHASES.includes(phase as CalibrationPhase)) ||
    !isCount(camera_samples) ||
    !isCount(screen_samples) ||
    !(
      preview === null ||
      (typeof preview === 'string' && preview.length <= MAX_PREVIEW_LENGTH && BASE64.test(preview))
    )
  ) {
    return null
  }
  return {
    type: 'calibration',
    face,
    h,
    v,
    yaw,
    pitch,
    zone: zone as GazeZone,
    phase: phase as CalibrationPhase | null,
    cameraSamples: camera_samples,
    screenSamples: screen_samples,
    preview
  }
}

function parseCalibrationResult(data: Record<string, unknown>): TrackerMessage | null {
  if (data.ok === false) return { type: 'calibration_result', result: null }
  const { good, camera_samples, screen_samples, camera_hit, screen_hit } = data
  const thresholds = parseThresholds(data.thresholds)
  if (
    data.ok !== true ||
    typeof good !== 'boolean' ||
    !isCount(camera_samples) ||
    !isCount(screen_samples) ||
    !isShare(camera_hit) ||
    !isShare(screen_hit) ||
    !thresholds
  ) {
    return null
  }
  return {
    type: 'calibration_result',
    result: {
      good,
      cameraSamples: camera_samples,
      screenSamples: screen_samples,
      cameraHit: camera_hit,
      screenHit: screen_hit,
      thresholds
    }
  }
}

/** Parse and validate one stdout line; returns null for anything malformed or unknown. */
export function parseTrackerLine(line: string): TrackerMessage | null {
  let data: unknown
  try {
    data = JSON.parse(line)
  } catch {
    return null
  }
  if (!isRecord(data)) return null

  switch (data.type) {
    case 'gaze': {
      const { ts, zone, confidence } = data
      if (
        typeof ts === 'number' &&
        Number.isFinite(ts) &&
        GAZE_ZONES.includes(zone as GazeZone) &&
        typeof confidence === 'number' &&
        Number.isFinite(confidence) &&
        confidence >= 0 &&
        confidence <= 1
      ) {
        return { type: 'gaze', ts, zone: zone as GazeZone, confidence }
      }
      return null
    }
    case 'devices': {
      if (!Array.isArray(data.list)) return null
      const list: TrackerDevice[] = []
      for (const item of data.list) {
        if (isRecord(item) && isValidCameraIndex(item.index) && typeof item.name === 'string') {
          list.push({ index: item.index, name: item.name.slice(0, MAX_TEXT_LENGTH) })
        }
      }
      return { type: 'devices', list }
    }
    case 'error':
      return typeof data.message === 'string'
        ? { type: 'error', message: data.message.slice(0, MAX_TEXT_LENGTH) }
        : null
    case 'calibration':
      return parseCalibrationUpdate(data)
    case 'calibration_result':
      return parseCalibrationResult(data)
    case 'ready':
      return typeof data.version === 'string'
        ? { type: 'ready', version: data.version.slice(0, MAX_TEXT_LENGTH) }
        : null
    default:
      return null
  }
}
