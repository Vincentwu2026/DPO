import { describe, expect, it } from 'vitest'
import {
  clampToWorkAreas,
  defaultHudPosition,
  HUD_COLLAPSED,
  HUD_EXPANDED,
  isPoint,
  resizeAnchoredTopRight,
  shouldShowHud
} from '../hud/hudGeometry'
import { HudPrefs, type PrefsStore } from '../hud/HudPrefs'

const primary = { x: 0, y: 25, width: 1440, height: 875 }
const right = { x: 1440, y: 0, width: 1920, height: 1080 }

describe('defaultHudPosition', () => {
  it('sits in the top-right corner of the work area with a margin', () => {
    expect(defaultHudPosition(primary, HUD_EXPANDED)).toEqual({ x: 1440 - 210 - 16, y: 25 + 16 })
  })
})

describe('clampToWorkAreas', () => {
  const size = HUD_EXPANDED

  it('leaves a fully visible position alone', () => {
    expect(clampToWorkAreas({ x: 100, y: 100 }, size, [primary])).toEqual({ x: 100, y: 100 })
  })

  it('pulls a window back inside the work area from every side', () => {
    expect(clampToWorkAreas({ x: -500, y: -500 }, size, [primary])).toEqual({ x: 0, y: 25 })
    expect(clampToWorkAreas({ x: 5000, y: 5000 }, size, [primary])).toEqual({
      x: 1440 - 210,
      y: 25 + 875 - 96
    })
  })

  it('keeps the window on the monitor that holds it', () => {
    expect(clampToWorkAreas({ x: 1500, y: 100 }, size, [primary, right])).toEqual({
      x: 1500,
      y: 100
    })
  })

  it('moves a window saved on a now-missing monitor onto the nearest remaining one', () => {
    expect(clampToWorkAreas({ x: 2600, y: 300 }, size, [primary])).toEqual({
      x: 1440 - 210,
      y: 300
    })
  })

  it('does not throw without any display and rounds fractional input', () => {
    expect(clampToWorkAreas({ x: 10.6, y: 3.2 }, size, [])).toEqual({ x: 11, y: 3 })
  })

  it('handles an area smaller than the window', () => {
    const tiny = { x: 0, y: 0, width: 100, height: 50 }
    expect(clampToWorkAreas({ x: 40, y: 40 }, size, [tiny])).toEqual({ x: 0, y: 0 })
  })
})

describe('resizeAnchoredTopRight', () => {
  it('keeps the top-right corner fixed when collapsing and expanding', () => {
    const collapsed = resizeAnchoredTopRight({ x: 1000, y: 50 }, HUD_EXPANDED, HUD_COLLAPSED)
    expect(collapsed).toEqual({ x: 1000 + 210 - 32, y: 50 })
    expect(resizeAnchoredTopRight(collapsed, HUD_COLLAPSED, HUD_EXPANDED)).toEqual({
      x: 1000,
      y: 50
    })
  })
})

describe('shouldShowHud', () => {
  it.each([
    ['realtime', true, true],
    ['both', true, true],
    ['postcall', true, false],
    ['realtime', false, false],
    ['both', false, false]
  ] as const)('mode %s, session active %s -> %s', (mode, active, expected) => {
    expect(shouldShowHud(mode, active)).toBe(expected)
  })
})

describe('isPoint', () => {
  it.each([
    null,
    undefined,
    1,
    'x',
    {},
    { x: 1 },
    { x: NaN, y: 1 },
    { x: 1, y: Infinity },
    { x: '1', y: 2 }
  ])('rejects %j', (v) => expect(isPoint(v)).toBe(false))
  it('accepts finite coordinates', () => expect(isPoint({ x: -5, y: 0 })).toBe(true))
})

describe('HudPrefs', () => {
  const memory = (): PrefsStore & { data: Map<string, unknown> } => {
    const data = new Map<string, unknown>()
    return { data, get: (k) => data.get(k), set: (k, v) => void data.set(k, v) }
  }

  it('round-trips position and collapsed state', () => {
    const prefs = new HudPrefs(memory())
    expect(prefs.getPosition()).toBeNull()
    expect(prefs.isCollapsed()).toBe(false)
    prefs.setPosition({ x: 12, y: 34 })
    prefs.setCollapsed(true)
    expect(prefs.getPosition()).toEqual({ x: 12, y: 34 })
    expect(prefs.isCollapsed()).toBe(true)
  })

  it('ignores corrupt stored values', () => {
    const store = memory()
    store.data.set('position', { x: 'a', y: null })
    store.data.set('collapsed', 'yes')
    const prefs = new HudPrefs(store)
    expect(prefs.getPosition()).toBeNull()
    expect(prefs.isCollapsed()).toBe(false)
  })

  it('refuses to store a non-finite position', () => {
    const store = memory()
    new HudPrefs(store).setPosition({ x: NaN, y: 1 })
    expect(store.data.has('position')).toBe(false)
  })
})
