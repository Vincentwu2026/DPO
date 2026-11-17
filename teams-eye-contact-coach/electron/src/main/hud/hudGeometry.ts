import type { TrackingMode } from '../settings/SettingsService'

export interface Point {
  x: number
  y: number
}
export interface Size {
  width: number
  height: number
}
export interface Rect extends Point, Size {}

export const HUD_EXPANDED: Size = { width: 210, height: 96 }
export const HUD_COLLAPSED: Size = { width: 32, height: 32 }
export const HUD_MARGIN = 16

export function isPoint(value: unknown): value is Point {
  if (typeof value !== 'object' || value === null) return false
  const { x, y } = value as Record<string, unknown>
  return typeof x === 'number' && Number.isFinite(x) && typeof y === 'number' && Number.isFinite(y)
}

/** Top-right corner of the work area, inset by `margin`. */
export function defaultHudPosition(workArea: Rect, size: Size, margin = HUD_MARGIN): Point {
  return {
    x: Math.round(workArea.x + workArea.width - size.width - margin),
    y: Math.round(workArea.y + margin)
  }
}

function distanceToRect(p: Point, r: Rect): number {
  const dx = Math.max(r.x - p.x, 0, p.x - (r.x + r.width))
  const dy = Math.max(r.y - p.y, 0, p.y - (r.y + r.height))
  return Math.hypot(dx, dy)
}

/**
 * Keeps the window fully inside one work area: the one containing its centre, otherwise the
 * nearest (e.g. a monitor that was unplugged since the position was saved).
 */
export function clampToWorkAreas(pos: Point, size: Size, workAreas: readonly Rect[]): Point {
  if (workAreas.length === 0) return { x: Math.round(pos.x), y: Math.round(pos.y) }
  const centre = { x: pos.x + size.width / 2, y: pos.y + size.height / 2 }
  const area = workAreas.reduce((best, a) =>
    distanceToRect(centre, a) < distanceToRect(centre, best) ? a : best
  )
  const maxX = Math.max(area.x, area.x + area.width - size.width)
  const maxY = Math.max(area.y, area.y + area.height - size.height)
  return {
    x: Math.round(Math.min(Math.max(pos.x, area.x), maxX)),
    y: Math.round(Math.min(Math.max(pos.y, area.y), maxY))
  }
}

/** The new top-left when switching size, keeping the top-right corner fixed. */
export function resizeAnchoredTopRight(pos: Point, from: Size, to: Size): Point {
  return { x: pos.x + from.width - to.width, y: pos.y }
}

/** The HUD (and alerts) are only for live feedback: real-time and both modes, during a session. */
export function shouldShowHud(mode: TrackingMode, sessionActive: boolean): boolean {
  return sessionActive && (mode === 'realtime' || mode === 'both')
}
