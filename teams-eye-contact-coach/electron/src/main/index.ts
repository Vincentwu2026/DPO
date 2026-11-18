import type { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import Store from 'electron-store'
import { AlertEngine } from './alerts/AlertEngine'
import { AuthService } from './auth/AuthService'
import { shouldShowHud } from './hud/hudGeometry'
import { HudPrefs } from './hud/HudPrefs'
import { HudWindow } from './hud/HudWindow'
import { FakeCall } from './meeting/FakeCall'
import { MeetingService, type MeetingInfo } from './meeting/MeetingService'
import { SessionRecorder } from './sessions/SessionRecorder'
import { openSessionDatabase, SessionRepository } from './sessions/SessionRepository'
import { isSettingsKey, SettingsService, type Settings } from './settings/SettingsService'
import { CameraDeviceService } from './tracker/CameraDeviceService'
import { isValidCameraIndex } from './tracker/protocol'
import { TrackerProcess } from './tracker/TrackerProcess'
import { resolveTrackerLaunch } from './tracker/trackerLaunch'
import { TrayService } from './tray/TrayService'

const FORWARDED_EVENTS = {
  MEETING_STARTED: 'meeting:started',
  MEETING_ENDED: 'meeting:ended',
  SPEAKER_ACTIVE: 'meeting:speaker-active',
  SPEAKER_INACTIVE: 'meeting:speaker-inactive'
} as const

let auth: AuthService
let settings: SettingsService
let meeting: MeetingService | null = null
let fakeCall: FakeCall | null = null
let tracker: TrackerProcess
let cameras: CameraDeviceService
let tray: TrayService
let hud: HudWindow
let alerts: AlertEngine
let sessions: SessionRepository | null = null
let recorder: SessionRecorder | null = null
let settingsWindow: BrowserWindow | null = null
/** Epoch ms when the current call's session began; null outside a call. */
let sessionStartedAt: number | null = null
/** Resolves once the current session row exists, so late meeting metadata is never lost. */
let sessionReady: Promise<unknown> = Promise.resolve()
let cleanedUp = false

function createWindow(): void {
  const win = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => win.show())
  loadRenderer(win, 'index.html')
}

function loadRenderer(win: BrowserWindow, page: string): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void win.loadURL(new URL(page, `${devUrl}/`).toString())
  } else {
    void win.loadFile(join(__dirname, '../renderer', page))
  }
}

function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    return
  }
  settingsWindow = new BrowserWindow({
    width: 240,
    height: 420,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  settingsWindow.on('ready-to-show', () => settingsWindow?.show())
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
  loadRenderer(settingsWindow, 'settings/index.html')
}

function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send(channel, payload)
}

/** Sends tracker output to renderers; the raw child process never leaves the main process. */
function setupTracker(): void {
  const launch = resolveTrackerLaunch({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    platform: process.platform,
    pythonOverride: process.env['PYTHON']
  })
  tracker = new TrackerProcess({ launch })
  cameras = new CameraDeviceService({ launch, tracker })

  tracker.on('gaze', (event) => {
    broadcast('gaze:update', event)
    recorder?.record(event)
    handleAlert(event)
  })
  tracker.on('devices', (list) => broadcast('tracker:devices', list))
  tracker.on('tracker-error', (error) => broadcast('tracker:error', error))
}

/** Live HUD/alerts only in realtime and both modes; post-call mode keeps tracking silently. */
function liveFeedbackEnabled(): boolean {
  return shouldShowHud(settings.getTrackingMode(), sessionStartedAt !== null)
}

function handleAlert(event: { ts: number; zone: 'camera' | 'screen' | 'away' }): void {
  if (!liveFeedbackEnabled()) return
  const transition = alerts.update(event)
  if (transition === 'fire') {
    hud.send('alert:fire', {
      visual: settings.getAlertVisualEnabled(),
      audio: settings.getAlertAudioEnabled()
    })
  } else if (transition === 'reset') {
    hud.send('alert:reset')
  }
}

/** Reconciles the HUD with the tracking mode and whether a call is in progress. */
function applyHud(): void {
  if (liveFeedbackEnabled() && sessionStartedAt !== null) {
    hud.show(sessionStartedAt)
  } else {
    hud.hide()
    alerts.startSession() // an alert that was showing must not survive a hidden HUD
  }
}

/** Call after any settings change (IPC or tray). */
function onSettingsChanged(): void {
  alerts.setThresholdSeconds(settings.getAlertThresholdSeconds())
  tracker.setStability(settings.getGazeStability())
  hud.setHintsEnabled(settings.getCoachingHintsEnabled())
  applyHud()
}

function beginSession(): void {
  sessionStartedAt = Date.now()
  alerts.startSession()
  if (recorder) {
    const r = recorder
    const trackingMode = settings.getTrackingMode()
    sessionReady = r.begin({ trackingMode }).catch((err: unknown) => {
      console.error('Failed to start session', err instanceof Error ? err.message : 'unknown')
    })
  }
  applyHud()
}

function endSession(): void {
  sessionStartedAt = null
  hud.setSpeakerActive(false)
  applyHud()
  const r = recorder
  if (r) sessionReady = sessionReady.then(() => r.end())
}

function startTracker(): void {
  try {
    tracker.start(settings.getCameraIndex(), settings.getGazeStability())
  } catch {
    broadcast('tracker:error', { message: 'The gaze tracker could not be started.', fatal: true })
  }
}

/** Connects call events (from MeetingService, or the dev fake call) to tracker, HUD and store. */
function bindCallEvents(source: EventEmitter): void {
  for (const [event, channel] of Object.entries(FORWARDED_EVENTS)) {
    source.on(event, () => broadcast(channel))
  }
  // The tracker (and webcam) runs for exactly the duration of a detected call.
  source.on('MEETING_STARTED', () => {
    startTracker()
    beginSession()
  })
  source.on('MEETING_ENDED', () => {
    void tracker.stop()
    endSession()
  })
  source.on('MEETING_INFO', (info: MeetingInfo) => {
    const r = recorder
    if (r) {
      sessionReady = sessionReady.then(() =>
        r.updateMeta({ meetingId: info.meetingId, subject: info.subject })
      )
    }
  })
  source.on('SPEAKER_ACTIVE', () => hud.setSpeakerActive(true))
  source.on('SPEAKER_INACTIVE', () => hud.setSpeakerActive(false))
}

/** Meeting detection needs Azure AD + relay configuration; stays off until a user is signed in. */
async function startMeetingService(): Promise<void> {
  const functionBaseUrl = process.env['FUNCTION_BASE_URL']
  const clientState = process.env['GRAPH_CLIENT_STATE']
  if (meeting || !functionBaseUrl || !clientState) return

  meeting = new MeetingService({ auth, functionBaseUrl, clientState })
  bindCallEvents(meeting)
  await meeting.start()
}

/** Dev only (never in a packaged build): simulate a Teams call without Azure/Graph. */
function startFakeCallIfRequested(): void {
  if (app.isPackaged || process.env['FAKE_CALL'] !== '1') return
  fakeCall = new FakeCall({
    durationSeconds: Number(process.env['FAKE_CALL_SECONDS']) || 60,
    onFinished: async () => {
      await sessionReady.catch(() => undefined)
      const last = (await sessions?.listSessions())?.[0]
      const summary = last ? await sessions?.getSessionSummary(last.id) : null
      // Aggregates only; no per-event data.
      console.log('[fake-call] session summary', JSON.stringify(summary))
      if (process.env['FAKE_CALL_QUIT'] === '1') app.quit()
    }
  })
  bindCallEvents(fakeCall)
  fakeCall.start()
}

function stopMeetingService(): void {
  meeting?.stop()
  meeting?.removeAllListeners()
  meeting = null
  fakeCall?.stop()
  fakeCall?.removeAllListeners()
  fakeCall = null
  void tracker?.stop()
  if (sessionStartedAt !== null) endSession()
}

async function signIn(): Promise<void> {
  await auth.signIn()
  await startMeetingService()
}

async function signOut(): Promise<void> {
  stopMeetingService()
  await auth.signOut()
}

function registerIpcHandlers(): void {
  ipcMain.handle('auth:sign-in', async () => {
    await signIn()
    await tray.refresh()
    return auth.getSignedInUser()
  })
  ipcMain.handle('auth:sign-out', async () => {
    await signOut()
    await tray.refresh()
  })
  ipcMain.handle('auth:get-user', () => auth.getSignedInUser())

  ipcMain.handle('settings:get', (_event, key: unknown) => {
    if (!isSettingsKey(key)) throw new Error('Unknown setting')
    return settings.get(key)
  })
  ipcMain.handle('settings:set', (_event, key: unknown, value: unknown) => {
    if (!isSettingsKey(key)) throw new Error('Unknown setting')
    settings.set(key, value)
    if (key === 'cameraIndex') tracker.setCamera(settings.getCameraIndex())
    onSettingsChanged()
    void tray.refresh()
  })
  ipcMain.handle('settings:get-all', () => settings.getAll())
  ipcMain.handle('settings:save', (_event, values: unknown) => {
    if (typeof values !== 'object' || values === null) throw new Error('Invalid settings')
    for (const [key, value] of Object.entries(values as Partial<Settings>)) {
      if (!isSettingsKey(key)) throw new Error('Unknown setting')
      settings.set(key, value)
    }
    if ('cameraIndex' in values) tracker.setCamera(settings.getCameraIndex())
    onSettingsChanged()
    void tray.refresh()
  })
  ipcMain.handle('settings:camera-devices', async () => {
    try {
      const devices = await cameras.getDevices()
      return devices.map((d) => ({ index: d.index, label: d.name }))
    } catch {
      return [{ index: 0, label: 'Default camera' }]
    }
  })
  ipcMain.handle('tracker:get-teams-camera-index', () => cameras.getTeamsSelectedIndex())
  ipcMain.handle('tracker:set-camera', (_event, index: unknown) => {
    if (!isValidCameraIndex(index)) throw new Error('Invalid camera index')
    settings.set('cameraIndex', index)
    return tracker.setCamera(index)
  })

  // Typed, read-only session access. The renderer never sees the database path or handle.
  ipcMain.handle('sessions:list', () => sessions?.listSessions() ?? [])
  ipcMain.handle('sessions:get-summary', (_event, sessionId: unknown) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 64) {
      throw new Error('Invalid session id')
    }
    return sessions?.getSessionSummary(sessionId) ?? null
  })

  ipcMain.handle('meeting:start-tracking', () => meeting?.sendToMeeting('START_TRACKING') ?? false)
  ipcMain.handle('meeting:stop-tracking', () => meeting?.sendToMeeting('STOP_TRACKING') ?? false)
}

void app.whenReady().then(async () => {
  if (!app.isPackaged) {
    try {
      process.loadEnvFile(join(app.getAppPath(), '.env'))
    } catch {
      // no .env in dev; rely on the real environment
    }
  }

  auth = new AuthService({ openBrowser: (url) => shell.openExternal(url) })
  settings = new SettingsService()
  alerts = new AlertEngine({ thresholdSeconds: settings.getAlertThresholdSeconds() })
  hud = new HudWindow({
    hintsEnabled: settings.getCoachingHintsEnabled(),
    prefs: new HudPrefs(new Store({ name: 'hud' })),
    preloadPath: join(__dirname, '../preload/index.js'),
    loadPage: (win) => loadRenderer(win, 'hud/index.html'),
    readAlertSound: () =>
      readFile(join(app.getAppPath(), 'resources', 'sounds', 'ping.wav')).then(
        (b) => new Uint8Array(b),
        () => null
      )
  })
  try {
    sessions = new SessionRepository(
      openSessionDatabase(join(app.getPath('userData'), 'sessions.db'))
    )
    recorder = new SessionRecorder(sessions)
    await sessions.closeOrphanedSessions() // sessions left open by a crash
  } catch (err) {
    // The app still works without history (HUD and alerts); never log paths or event data.
    console.error('Session store unavailable', err instanceof Error ? err.message : 'unknown')
    sessions = null
    recorder = null
  }
  setupTracker()
  tray = new TrayService({
    auth,
    settings: {
      getTrackingMode: () => settings.getTrackingMode(),
      setTrackingMode: (mode) => {
        settings.setTrackingMode(mode)
        onSettingsChanged()
      }
    },
    signIn,
    signOut,
    openSettings: openSettingsWindow
  })

  registerIpcHandlers()
  createWindow()
  await tray.create()

  if (await auth.getSignedInUser().catch(() => null)) await startMeetingService()
  startFakeCallIfRequested()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Tray app: keep running when every window is closed (Quit lives in the tray menu).
app.on('window-all-closed', () => undefined)

app.on('before-quit', (event) => {
  if (cleanedUp) return
  // Let the open session be flushed and closed before the database goes away.
  event.preventDefault()
  cleanedUp = true
  stopMeetingService()
  void tracker?.stop()
  hud?.hide()
  tray?.destroy()
  void sessionReady
    .catch(() => undefined)
    .finally(() => {
      sessions?.close()
      app.quit()
    })
})
