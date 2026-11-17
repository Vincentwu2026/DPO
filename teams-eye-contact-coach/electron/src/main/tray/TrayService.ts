import { join } from 'node:path'
import { app, Menu, nativeImage, Tray, type MenuItemConstructorOptions } from 'electron'
import type { AuthService } from '../auth/AuthService'
import type { SettingsService, TrackingMode } from '../settings/SettingsService'

export interface TrayDeps {
  auth: Pick<AuthService, 'getSignedInUser'>
  settings: Pick<SettingsService, 'getTrackingMode' | 'setTrackingMode'>
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  openSettings: () => void
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

  /** Rebuild the context menu from current auth + settings state. */
  async refresh(): Promise<void> {
    if (!this.tray) return
    const user = await this.deps.auth.getSignedInUser().catch(() => null)
    const current = this.deps.settings.getTrackingMode()

    const template: MenuItemConstructorOptions[] = [
      user
        ? {
            label: `Sign Out (${user.name})`,
            click: () => void this.deps.signOut().then(() => this.refresh())
          }
        : { label: 'Sign In', click: () => void this.deps.signIn().then(() => this.refresh()) },
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
      { label: 'Settings…', click: () => this.deps.openSettings() },
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
