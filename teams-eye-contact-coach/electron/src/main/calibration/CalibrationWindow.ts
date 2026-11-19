import { BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent } from 'electron'
import type { CalibrationFitStats } from '../../shared/calibrationModel'
import { CALIBRATION_PHASES, type CalibrationFit, type CalibrationPhase } from '../tracker/protocol'
import type { TrackerProcess } from '../tracker/TrackerProcess'
import type { CalibrationStore } from './CalibrationStore'

export interface CalibrationWindowOptions {
  preloadPath: string
  loadPage: (win: BrowserWindow) => void
  tracker: TrackerProcess
  store: CalibrationStore
  /** Make sure the tracker (and so the webcam) is running; called when the window opens. */
  ensureTracker: () => Promise<void>
  /** Stop the tracker again if no call needs it; called when the window closes. */
  releaseTracker: () => void
  /** Called after thresholds were saved or reset (e.g. to refresh the tray menu). */
  onChanged?: () => void
}

const WIDTH = 540
const HEIGHT = 820
const FIT_TIMEOUT_MS = 5_000

function toStats(fit: CalibrationFit): CalibrationFitStats {
  return {
    good: fit.good,
    cameraSamples: fit.cameraSamples,
    screenSamples: fit.screenSamples,
    cameraHit: fit.cameraHit,
    screenHit: fit.screenHit
  }
}

/**
 * Guides the user through two looks (the camera lens, then the screen) while showing a live
 * preview and readings. The window sits at the top-centre of the screen, next to the real lens.
 *
 * The renderer never supplies thresholds: main keeps the last fit the tracker produced and only
 * that can be saved. Every IPC handler rejects senders other than this window.
 */
export class CalibrationWindow {
  private win: BrowserWindow | null = null
  private lastFit: CalibrationFit | null = null
  private finishFit: ((fit: CalibrationFit | null) => void) | null = null

  private readonly onUpdate = (update: unknown): void => {
    if (this.win && !this.win.isDestroyed()) this.win.webContents.send('calibration:update', update)
  }
  private readonly onResult = (fit: CalibrationFit | null): void => this.finishFit?.(fit)

  constructor(private readonly options: CalibrationWindowOptions) {
    this.registerIpc()
  }

  get isOpen(): boolean {
    return this.win !== null && !this.win.isDestroyed()
  }

  show(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.focus()
      return
    }
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea
    const height = Math.min(HEIGHT, area.height)
    const win = new BrowserWindow({
      width: WIDTH,
      height,
      x: Math.round(area.x + (area.width - WIDTH) / 2),
      y: area.y, // as close to the physical lens as the menu bar allows
      resizable: false,
      show: false,
      title: 'Calibrate Eye Contact',
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.win = win
    this.lastFit = null

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      win.show()
      win.focus()
    })
    win.on('closed', () => this.cleanUp(win))

    this.options.tracker.on('calibration', this.onUpdate)
    this.options.tracker.on('calibration-result', this.onResult)
    // The tracker may still be starting; only ask it to stream once it is up.
    void this.options.ensureTracker().then(() => {
      if (this.win === win && !win.isDestroyed()) this.options.tracker.calibrationStart()
    })
    this.options.loadPage(win)
  }

  close(): void {
    const win = this.win
    if (win && !win.isDestroyed()) win.destroy()
    // `closed` is not guaranteed after destroy(); clean up explicitly (idempotent).
    this.cleanUp(win)
  }

  private cleanUp(win: BrowserWindow | null): void {
    if (!win || win !== this.win) return
    this.win = null
    this.lastFit = null
    this.finishFit?.(null)
    this.options.tracker.off('calibration', this.onUpdate)
    this.options.tracker.off('calibration-result', this.onResult)
    this.options.tracker.calibrationStop()
    this.options.releaseTracker()
  }

  private requestFit(): Promise<CalibrationFitStats | null> {
    this.finishFit?.(null) // a newer request supersedes an older one
    return new Promise((resolve) => {
      const finish = (fit: CalibrationFit | null): void => {
        clearTimeout(timer)
        if (this.finishFit === finish) this.finishFit = null
        this.lastFit = fit
        resolve(fit ? toStats(fit) : null)
      }
      const timer = setTimeout(() => finish(null), FIT_TIMEOUT_MS)
      this.finishFit = finish
      if (!this.options.tracker.calibrationFit()) finish(null)
    })
  }

  private registerIpc(): void {
    const guard = (e: IpcMainInvokeEvent): void => {
      if (!this.win || this.win.isDestroyed() || this.win.webContents !== e.sender) {
        throw new Error('Not allowed')
      }
    }

    ipcMain.handle('calibration:set-phase', (e, phase: unknown) => {
      guard(e)
      if (phase !== null && !CALIBRATION_PHASES.includes(phase as CalibrationPhase)) {
        throw new Error('Invalid phase')
      }
      return this.options.tracker.calibrationPhase(phase as CalibrationPhase | null)
    })

    ipcMain.handle('calibration:fit', (e) => {
      guard(e)
      return this.requestFit()
    })

    ipcMain.handle('calibration:apply', (e) => {
      guard(e)
      const fit = this.lastFit
      if (!fit?.good) return false
      if (!this.options.store.save(fit.thresholds)) return false
      this.options.tracker.setThresholds(fit.thresholds)
      this.options.onChanged?.()
      return true
    })

    ipcMain.handle('calibration:reset', (e) => {
      guard(e)
      this.options.store.clear()
      this.options.tracker.setThresholds(null)
      this.options.onChanged?.()
    })

    ipcMain.handle('calibration:get-info', (e) => {
      guard(e)
      return this.options.store.getInfo()
    })

    ipcMain.handle('calibration:close', (e) => {
      guard(e)
      this.close()
    })
  }
}
