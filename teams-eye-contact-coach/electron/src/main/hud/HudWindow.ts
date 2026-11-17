import {
  BrowserWindow,
  ipcMain,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import {
  clampToWorkAreas,
  defaultHudPosition,
  HUD_COLLAPSED,
  HUD_EXPANDED,
  resizeAnchoredTopRight,
  type Point,
  type Size
} from './hudGeometry'
import type { HudPrefs } from './HudPrefs'

export interface HudState {
  /** Epoch ms when the current session started; null while no session is open. */
  sessionStartedAt: number | null
  speakerActive: boolean
  collapsed: boolean
}

export interface AlertPayload {
  visual: boolean
  audio: boolean
}

export interface HudWindowOptions {
  prefs: HudPrefs
  preloadPath: string
  loadPage: (win: BrowserWindow) => void
  readAlertSound: () => Promise<Uint8Array | null>
}

const MAX_DRAG_DELTA = 20_000

const sizeFor = (collapsed: boolean): Size => (collapsed ? HUD_COLLAPSED : HUD_EXPANDED)
const workAreas = () => screen.getAllDisplays().map((d) => d.workArea)

/**
 * The floating HUD: transparent, always on top, click-through except for its grip / collapse
 * controls, hidden from screen capture, and never focused. It exists only while shown.
 * All IPC handlers reject callers other than the HUD's own webContents.
 */
export class HudWindow {
  private win: BrowserWindow | null = null
  private dragOrigin: Point | null = null
  private state: HudState = { sessionStartedAt: null, speakerActive: false, collapsed: false }

  constructor(private readonly options: HudWindowOptions) {
    this.registerIpc()
  }

  get isVisible(): boolean {
    return this.win !== null && !this.win.isDestroyed()
  }

  show(sessionStartedAt: number): void {
    this.state.sessionStartedAt = sessionStartedAt
    this.state.collapsed = this.options.prefs.isCollapsed()
    if (this.isVisible) {
      this.pushState()
      return
    }
    this.create()
  }

  hide(): void {
    this.state.sessionStartedAt = null
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  setSpeakerActive(active: boolean): void {
    if (this.state.speakerActive === active) return
    this.state.speakerActive = active
    this.pushState()
  }

  send(channel: 'alert:fire' | 'alert:reset', payload?: AlertPayload): void {
    if (this.isVisible) this.win?.webContents.send(channel, payload)
  }

  private create(): void {
    const { prefs, preloadPath, loadPage } = this.options
    const size = sizeFor(this.state.collapsed)
    const position = clampToWorkAreas(
      prefs.getPosition() ?? defaultHudPosition(screen.getPrimaryDisplay().workArea, size),
      size,
      workAreas()
    )

    const win = new BrowserWindow({
      ...position,
      ...size,
      show: false,
      transparent: true,
      backgroundColor: '#00000000',
      frame: false,
      hasShadow: false,
      alwaysOnTop: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required',
        backgroundThrottling: false
      }
    })
    this.win = win

    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    win.setContentProtection(true) // keep the HUD out of Teams screen-share capture
    win.setIgnoreMouseEvents(true, { forward: true }) // click-through until a control is hovered

    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.showInactive()
    })
    win.on('closed', () => {
      if (this.win === win) this.win = null
    })
    loadPage(win)
  }

  private pushState(): void {
    if (this.isVisible) this.win?.webContents.send('hud:state', this.state)
  }

  private isFromHud(sender: Electron.WebContents): boolean {
    return this.isVisible && this.win?.webContents === sender
  }

  private registerIpc(): void {
    const guardInvoke = (e: IpcMainInvokeEvent): void => {
      if (!this.isFromHud(e.sender)) throw new Error('Not allowed')
    }
    ipcMain.handle('hud:get-state', (e) => {
      guardInvoke(e)
      return this.state
    })
    ipcMain.handle('hud:get-alert-sound', async (e) => {
      guardInvoke(e)
      return this.options.readAlertSound()
    })

    ipcMain.on('hud:set-ignore-mouse', (e: IpcMainEvent, ignore: unknown) => {
      if (!this.isFromHud(e.sender) || typeof ignore !== 'boolean') return
      this.win?.setIgnoreMouseEvents(ignore, { forward: true })
    })
    ipcMain.on('hud:drag-start', (e: IpcMainEvent) => {
      if (!this.isFromHud(e.sender) || !this.win) return
      const [x, y] = this.win.getPosition()
      this.dragOrigin = { x, y }
    })
    ipcMain.on('hud:drag-move', (e: IpcMainEvent, dx: unknown, dy: unknown) => {
      if (!this.isFromHud(e.sender) || !this.win || !this.dragOrigin) return
      if (!isSmallNumber(dx) || !isSmallNumber(dy)) return
      const p = clampToWorkAreas(
        { x: this.dragOrigin.x + dx, y: this.dragOrigin.y + dy },
        sizeFor(this.state.collapsed),
        workAreas()
      )
      this.win.setPosition(p.x, p.y)
    })
    ipcMain.on('hud:drag-end', (e: IpcMainEvent) => {
      if (!this.isFromHud(e.sender) || !this.win) return
      this.dragOrigin = null
      const [x, y] = this.win.getPosition()
      this.options.prefs.setPosition({ x, y })
    })
    ipcMain.on('hud:set-collapsed', (e: IpcMainEvent, collapsed: unknown) => {
      if (!this.isFromHud(e.sender) || !this.win || typeof collapsed !== 'boolean') return
      if (collapsed === this.state.collapsed) return
      const [x, y] = this.win.getPosition()
      const next = sizeFor(collapsed)
      const anchored = resizeAnchoredTopRight({ x, y }, sizeFor(this.state.collapsed), next)
      const p = clampToWorkAreas(anchored, next, workAreas())
      this.state.collapsed = collapsed
      this.win.setBounds({ ...p, ...next })
      this.options.prefs.setCollapsed(collapsed)
      this.options.prefs.setPosition(p)
      this.pushState()
    })
  }
}

function isSmallNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_DRAG_DELTA
}
