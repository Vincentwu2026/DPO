import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import type { ReportData } from '../../shared/reportModel'

export interface ReportWindowOptions {
  preloadPath: string
  loadPage: (win: BrowserWindow) => void
  /** Validated https (or loopback http) dashboard URL, or null when none is configured. */
  dashboardUrl: string | null
  /** Builds the report for a session. The renderer never supplies the id. */
  loadReport: (sessionId: string) => Promise<ReportData | null>
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** e.g. eye-contact-report-2026-11-18-1530-07.pdf. Never contains the meeting subject. */
export function pdfFileName(now: Date): string {
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  return `eye-contact-report-${date}-${pad(now.getHours())}${pad(now.getMinutes())}-${pad(now.getSeconds())}.pdf`
}

/**
 * The post-session report: an ordinary framed window that shows one finished session.
 * It is bound to a session id held here; every IPC handler rejects other senders.
 */
export class ReportWindow {
  private win: BrowserWindow | null = null
  private sessionId: string | null = null

  constructor(private readonly options: ReportWindowOptions) {
    this.registerIpc()
  }

  get isOpen(): boolean {
    return this.win !== null && !this.win.isDestroyed()
  }

  show(sessionId: string): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.sessionId = sessionId

    const win = new BrowserWindow({
      width: 720,
      height: 820,
      minWidth: 520,
      minHeight: 480,
      show: false,
      title: 'Eye Contact Report',
      webPreferences: {
        preload: this.options.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    this.win = win

    // The report is local content only: no navigation, no popups.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      win.show()
      win.focus()
    })
    win.on('closed', () => {
      if (this.win === win) {
        this.win = null
        this.sessionId = null
      }
    })
    this.options.loadPage(win)
  }

  close(): void {
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
    this.sessionId = null
  }

  private isFromReport(sender: Electron.WebContents): boolean {
    return this.isOpen && this.win?.webContents === sender
  }

  private registerIpc(): void {
    const guard = (e: IpcMainInvokeEvent): void => {
      if (!this.isFromReport(e.sender)) throw new Error('Not allowed')
    }

    ipcMain.handle('report:get', async (e) => {
      guard(e)
      return this.sessionId ? this.options.loadReport(this.sessionId) : null
    })

    ipcMain.handle('report:export-pdf', async (e) => {
      guard(e)
      const win = this.win
      if (!win) return { ok: false as const }
      try {
        const data = await win.webContents.printToPDF({
          printBackground: true,
          pageSize: 'A4',
          margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 }
        })
        const fileName = pdfFileName(new Date())
        const target = join(app.getPath('downloads'), fileName)
        await writeFile(target, data, { flag: 'wx', mode: 0o600 })
        shell.showItemInFolder(target)
        // Only the file name goes back to the page, never a full path.
        return { ok: true as const, fileName }
      } catch (err) {
        console.error('PDF export failed', err instanceof Error ? err.message : 'unknown')
        return { ok: false as const }
      }
    })

    ipcMain.handle('report:open-history', (e) => {
      guard(e)
      const url = this.options.dashboardUrl
      if (!url) return false
      void shell.openExternal(url)
      return true
    })

    ipcMain.handle('report:close', (e) => {
      guard(e)
      this.close()
    })
  }
}
