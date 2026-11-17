import { isPoint, type Point } from './hudGeometry'

/** The slice of electron-store the HUD preferences need (lets tests use a Map). */
export interface PrefsStore {
  get(key: string): unknown
  set(key: string, value: unknown): void
}

/** Persisted HUD window position and collapsed state. Stored values are validated on read. */
export class HudPrefs {
  constructor(private readonly store: PrefsStore) {}

  getPosition(): Point | null {
    const value = this.store.get('position')
    return isPoint(value) ? { x: value.x, y: value.y } : null
  }

  setPosition(position: Point): void {
    if (isPoint(position)) this.store.set('position', { x: position.x, y: position.y })
  }

  isCollapsed(): boolean {
    return this.store.get('collapsed') === true
  }

  setCollapsed(collapsed: boolean): void {
    this.store.set('collapsed', collapsed)
  }
}
