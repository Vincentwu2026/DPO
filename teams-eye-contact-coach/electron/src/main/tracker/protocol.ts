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

export type TrackerMessage =
  | { type: 'ready'; version: string }
  | ({ type: 'gaze' } & GazeEvent)
  | { type: 'devices'; list: TrackerDevice[] }
  | { type: 'error'; message: string }

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
    case 'ready':
      return typeof data.version === 'string'
        ? { type: 'ready', version: data.version.slice(0, MAX_TEXT_LENGTH) }
        : null
    default:
      return null
  }
}
