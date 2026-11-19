import { contextBridge, ipcRenderer } from 'electron'

// Only typed, narrow IPC wrappers are exposed. No tokens, AuthService or raw ipcRenderer reach the renderer.
const api = {
  platform: process.platform
}

const auth = {
  signIn: () => ipcRenderer.invoke('auth:sign-in'),
  signOut: () => ipcRenderer.invoke('auth:sign-out'),
  getUser: () => ipcRenderer.invoke('auth:get-user')
}

const settings = {
  get: (key: string) => ipcRenderer.invoke('settings:get', key),
  set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
  getAll: () => ipcRenderer.invoke('settings:get-all'),
  save: (values: Record<string, unknown>) => ipcRenderer.invoke('settings:save', values),
  getCameraDevices: () => ipcRenderer.invoke('settings:camera-devices')
}

/** Subscribe to a main-process push; returns an unsubscribe function. */
function subscribe(channel: string, callback: () => void): () => void {
  const listener = (): void => callback()
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

/** Like `subscribe`, but forwards the payload (the IPC event object itself is never exposed). */
function subscribeWithPayload<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const gazeTracker = {
  onUpdate: (cb: (event: unknown) => void) => subscribeWithPayload('gaze:update', cb),
  onError: (cb: (error: unknown) => void) => subscribeWithPayload('tracker:error', cb),
  onDevices: (cb: (devices: unknown) => void) => subscribeWithPayload('tracker:devices', cb),
  setCamera: (index: number) => ipcRenderer.invoke('tracker:set-camera', index),
  getTeamsCameraIndex: () => ipcRenderer.invoke('tracker:get-teams-camera-index')
}

const meeting = {
  onMeetingStarted: (cb: () => void) => subscribe('meeting:started', cb),
  onMeetingEnded: (cb: () => void) => subscribe('meeting:ended', cb),
  onSpeakerActive: (cb: () => void) => subscribe('meeting:speaker-active', cb),
  onSpeakerInactive: (cb: () => void) => subscribe('meeting:speaker-inactive', cb),
  startTracking: () => ipcRenderer.invoke('meeting:start-tracking'),
  stopTracking: () => ipcRenderer.invoke('meeting:stop-tracking')
}

// Read-only session history; the database path/handle never leave the main process.
const sessions = {
  list: () => ipcRenderer.invoke('sessions:list'),
  getSummary: (sessionId: string) => ipcRenderer.invoke('sessions:get-summary', sessionId)
}

// Narrow surface for the report window only; main rejects these calls from any other sender.
// The session shown is fixed by main, so the renderer cannot ask for another one.
const report = {
  get: () => ipcRenderer.invoke('report:get'),
  exportPdf: () => ipcRenderer.invoke('report:export-pdf'),
  openHistory: () => ipcRenderer.invoke('report:open-history'),
  close: () => ipcRenderer.invoke('report:close')
}

// Narrow surface for the calibration window only. It cannot supply thresholds: main keeps the
// last fit and `apply` saves exactly that.
const calibration = {
  onUpdate: (cb: (update: unknown) => void) => subscribeWithPayload('calibration:update', cb),
  setPhase: (phase: 'camera' | 'screen' | null) =>
    ipcRenderer.invoke('calibration:set-phase', phase),
  fit: () => ipcRenderer.invoke('calibration:fit'),
  apply: () => ipcRenderer.invoke('calibration:apply'),
  reset: () => ipcRenderer.invoke('calibration:reset'),
  getInfo: () => ipcRenderer.invoke('calibration:get-info'),
  close: () => ipcRenderer.invoke('calibration:close')
}

// Status and shortcuts for the launch window. Nothing here exposes tokens or file paths.
const home = {
  getStatus: () => ipcRenderer.invoke('home:get-status'),
  openCalibration: () => ipcRenderer.invoke('home:open-calibration'),
  openSettings: () => ipcRenderer.invoke('home:open-settings')
}

// Narrow surface for the HUD window only; main ignores these channels from any other sender.
const hud = {
  getState: () => ipcRenderer.invoke('hud:get-state'),
  getAlertSound: () => ipcRenderer.invoke('hud:get-alert-sound'),
  onState: (cb: (state: unknown) => void) => subscribeWithPayload('hud:state', cb),
  onAlertFire: (cb: (payload: unknown) => void) => subscribeWithPayload('alert:fire', cb),
  onAlertReset: (cb: () => void) => subscribe('alert:reset', cb),
  setIgnoreMouse: (ignore: boolean) => ipcRenderer.send('hud:set-ignore-mouse', ignore),
  dragStart: () => ipcRenderer.send('hud:drag-start'),
  dragMove: (dx: number, dy: number) => ipcRenderer.send('hud:drag-move', dx, dy),
  dragEnd: () => ipcRenderer.send('hud:drag-end'),
  setCollapsed: (collapsed: boolean) => ipcRenderer.send('hud:set-collapsed', collapsed)
}

contextBridge.exposeInMainWorld('api', api)
contextBridge.exposeInMainWorld('auth', auth)
contextBridge.exposeInMainWorld('settings', settings)
contextBridge.exposeInMainWorld('meeting', meeting)
contextBridge.exposeInMainWorld('gazeTracker', gazeTracker)
contextBridge.exposeInMainWorld('hud', hud)
contextBridge.exposeInMainWorld('home', home)
contextBridge.exposeInMainWorld('report', report)
contextBridge.exposeInMainWorld('calibration', calibration)
contextBridge.exposeInMainWorld('sessions', sessions)
