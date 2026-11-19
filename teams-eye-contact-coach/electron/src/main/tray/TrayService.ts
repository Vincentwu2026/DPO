import { join } from 'node:path'
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import type { SettingsService, TrackingMode } from '../settings/SettingsService'

export interface TrayDeps {
  settings: Pick<SettingsService, 'getTrackingMode' | 'setTrackingMode'>
  openHome: () => void
  openSettings: () => void
  openCalibration: () => void
  isCalibrated: () => boolean
  /** True while a session is being tracked (detected automatically or started by hand). */
  isSessionActive: () => boolean
  toggleSession: () => void
}

const MODES: { mode: TrackingMode; label: string }[] = [
  { mode: 'realtime', label: 'Real-time' },
  { mode: 'postcall', label: 'Post-call' },
  { mode: 'both', label: 'Both' }
]

export class TrayService {
  private tray: Tray | null = null

  constructor(private readonly deps: TrayDeps) {}

  async create(): Promise<void> {
    const iconPath = join(app.getAppPath(), 'resources', 'icons', 'tray.png')
    this.tray = new Tray(nativeImage.createFromPath(iconPath))
    this.tray.setToolTip('Teams Eye Contact Coach')
    await this.refresh()
  }

  /** Rebuild the context menu from current session + settings state. */
  async refresh(): Promise<void> {
    if (!this.tray) return
    const current = this.deps.settings.getTrackingMode()

    const template: MenuItemConstructorOptions[] = [
      {
        label: this.deps.isSessionActive() ? 'Stop Session' : 'Start Session',
        click: () => this.deps.toggleSession()
      },
      { type: 'separator' },
      {
        label: 'Tracking Mode',
        submenu: MODES.map(({ mode, label }) => ({
          label,
          type: 'checkbox',
          checked: mode === current,
          click: () => {
            this.deps.settings.setTrackingMode(mode)
            void this.refresh()
          }
        }))
      },
      { label: 'Open Eye Contact Coach', click: () => this.deps.openHome() },
      { label: 'Settings…', click: () => this.deps.openSettings() },
      {
        label: this.deps.isCalibrated() ? 'Recalibrate Eye Contact…' : 'Calibrate Eye Contact…',
        click: () => this.deps.openCalibration()
      },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() }
    ]
    this.tray.setContextMenu(Menu.buildFromTemplate(template))
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
