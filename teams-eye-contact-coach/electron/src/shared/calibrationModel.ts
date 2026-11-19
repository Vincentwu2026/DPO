/**
 * Pure logic for the calibration window: how far each step has got, what to tell the user when
 * the camera cannot see them, and how to describe the fit. Types come from the tracker protocol.
 */
import type {
  CalibrationFit,
  CalibrationPhase,
  CalibrationUpdate,
  GazeZone
} from '../main/tracker/protocol'

/** Frames collected per look (a bit over two seconds of video). */
export const TARGET_SAMPLES = 60
export const COUNTDOWN_SECONDS = 3
/** No update for this long means the camera feed has stopped. */
export const STALE_AFTER_MS = 3_000

/** 0-1 progress of one look. */
export function phaseProgress(samples: number): number {
  if (!Number.isFinite(samples) || samples <= 0) return 0
  return Math.min(1, samples / TARGET_SAMPLES)
}

export function samplesFor(update: CalibrationUpdate, phase: CalibrationPhase): number {
  return phase === 'camera' ? update.cameraSamples : update.screenSamples
}

export const ZONE_LABELS: Record<GazeZone, string> = {
  camera: 'Looking at the camera',
  screen: 'Looking at the screen',
  away: 'Looking away'
}

/** A hint when the reading is not usable, or null when everything is fine. */
export function liveHint(update: CalibrationUpdate | null, stale: boolean): string | null {
  if (stale || !update)
    return 'No video from the camera yet. Check that it is not covered or in use.'
  if (!update.face)
    return 'I cannot see your face. Sit in front of the camera with the light on you.'
  return null
}

/** The fit as the window sees it: how well it worked, but never the thresholds themselves. */
export type CalibrationFitStats = Omit<CalibrationFit, 'thresholds'>

export type FitLevel = 'good' | 'warn'

export interface FitSummary {
  level: FitLevel
  title: string
  detail: string
}

const percent = (share: number): string => `${Math.round(share * 100)}%`

/** Plain-language result of a calibration; `null` means there was not enough data to fit. */
export function summarizeFit(fit: CalibrationFitStats | null): FitSummary {
  if (!fit) {
    return {
      level: 'warn',
      title: 'Not enough face data',
      detail:
        'I need to see your face clearly for each step. Check the lighting, keep your face in view and try again.'
    }
  }
  const stats = `Camera looks recognised ${percent(fit.cameraHit)}, screen looks ${percent(fit.screenHit)}.`
  if (fit.good) {
    return { level: 'good', title: 'Calibration looks good', detail: stats }
  }
  if (fit.cameraHit < 0.85) {
    return {
      level: 'warn',
      title: 'Your look at the lens was not steady',
      detail: `${stats} Keep your eyes on the lens for the whole countdown and try again.`
    }
  }
  return {
    level: 'warn',
    title: 'Lens and screen looked almost the same',
    detail: `${stats} Sit a little closer, or look at the lower part of your screen for step 2, then try again.`
  }
}
