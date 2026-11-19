/**
 * Personal gaze thresholds produced by calibration. Mirrors `GazeThresholds` in
 * python/gaze/classifier.py; the bounds mirror `_BOUNDS` in python/gaze/calibration.py.
 * Everything read from the tracker or from disk is validated here before it is used.
 */

export const THRESHOLD_BOUNDS = {
  h_center: [0.3, 0.7],
  h_tolerance: [0.01, 0.3],
  v_center: [-0.3, 0.3],
  v_tolerance: [0.01, 0.3],
  yaw_center: [-45, 45],
  pitch_center: [-45, 45],
  camera_max_yaw: [3, 45],
  camera_max_pitch: [3, 45],
  away_yaw: [20, 80],
  away_pitch: [20, 80]
} as const satisfies Record<string, readonly [number, number]>

export type GazeThresholds = { -readonly [K in keyof typeof THRESHOLD_BOUNDS]: number }

const KEYS = Object.keys(THRESHOLD_BOUNDS) as (keyof GazeThresholds)[]

/** Returns a clean copy, or null unless every field is present, finite and within bounds. */
export function parseThresholds(value: unknown): GazeThresholds | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (Object.keys(record).length !== KEYS.length) return null
  const out: Partial<GazeThresholds> = {}
  for (const key of KEYS) {
    const v = record[key]
    const [low, high] = THRESHOLD_BOUNDS[key]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < low || v > high) return null
    out[key] = v
  }
  const t = out as GazeThresholds
  // "Away" must start well beyond the camera zone, otherwise the zones overlap.
  if (t.away_yaw < t.camera_max_yaw + 5 || t.away_pitch < t.camera_max_pitch + 5) return null
  return t
}
