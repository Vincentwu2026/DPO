import { describe, expect, it, vi } from 'vitest'
import {
  CameraDeviceService,
  extractVideoDeviceLabel,
  matchDeviceIndex,
  teamsSettingsPath
} from '../tracker/CameraDeviceService'
import { resolveTrackerLaunch } from '../tracker/trackerLaunch'

const DEVICES = [
  { index: 0, name: 'MacBook Pro Camera' },
  { index: 1, name: 'Logitech C920 HD Pro Webcam' }
]

describe('matchDeviceIndex', () => {
  it('matches exactly, case-insensitively', () => {
    expect(matchDeviceIndex(DEVICES, 'logitech c920 hd pro webcam')).toBe(1)
  })
  it('falls back to substring matches in either direction', () => {
    expect(matchDeviceIndex(DEVICES, 'Logitech C920')).toBe(1)
    expect(matchDeviceIndex(DEVICES, 'MacBook Pro Camera (Built-in)')).toBe(0)
  })
  it('prefers an exact match over a partial one', () => {
    const devices = [
      { index: 0, name: 'Camera' },
      { index: 1, name: 'Camera 2' }
    ]
    expect(matchDeviceIndex(devices, 'Camera 2')).toBe(1)
  })
  it('returns null when nothing matches or the label is blank', () => {
    expect(matchDeviceIndex(DEVICES, 'Elgato Facecam')).toBeNull()
    expect(matchDeviceIndex(DEVICES, '   ')).toBeNull()
  })
})

describe('extractVideoDeviceLabel', () => {
  it('reads a string or an object label', () => {
    expect(extractVideoDeviceLabel({ videoDevice: ' Cam A ' })).toBe('Cam A')
    expect(extractVideoDeviceLabel({ videoDevice: { label: 'Cam B', id: 'x' } })).toBe('Cam B')
  })
  it.each([null, undefined, 'x', [], {}, { videoDevice: 5 }, { videoDevice: '' }])(
    'returns null for %j',
    (v) => expect(extractVideoDeviceLabel(v)).toBeNull()
  )
})

describe('teamsSettingsPath', () => {
  it('builds the per-platform path', () => {
    expect(teamsSettingsPath('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, '/h')).toMatch(
      /Microsoft[\\/]Teams[\\/]settings\.json$/
    )
    expect(teamsSettingsPath('darwin', {}, '/Users/a')).toBe(
      '/Users/a/Library/Application Support/Microsoft/Teams/settings.json'
    )
  })
  it('returns null when it cannot be determined', () => {
    expect(teamsSettingsPath('win32', {}, '/h')).toBeNull()
    expect(teamsSettingsPath('linux', {}, '/h')).toBeNull()
  })
})

describe('CameraDeviceService', () => {
  const launch = { command: 'py', args: ['main.py'] }

  it('caches the device list and refreshes on demand', async () => {
    const listDevices = vi.fn().mockResolvedValue(DEVICES)
    const service = new CameraDeviceService({ launch, listDevices })
    await service.getDevices()
    await service.getDevices()
    expect(listDevices).toHaveBeenCalledTimes(1)
    await service.getDevices(true)
    expect(listDevices).toHaveBeenCalledTimes(2)
    expect(listDevices).toHaveBeenCalledWith(launch)
  })

  it('updates the cache from tracker devices events', async () => {
    const { EventEmitter } = await import('node:events')
    const tracker = new EventEmitter()
    const listDevices = vi.fn().mockResolvedValue([])
    const service = new CameraDeviceService({ launch, tracker, listDevices })
    tracker.emit('devices', DEVICES)
    expect(await service.getDevices()).toEqual(DEVICES)
    expect(listDevices).not.toHaveBeenCalled()
  })

  it('resolves the Teams-selected camera index', async () => {
    const service = new CameraDeviceService({
      launch,
      listDevices: async () => DEVICES,
      readTeamsSettings: async () => ({ videoDevice: 'Logitech C920 HD Pro Webcam' })
    })
    expect(await service.getTeamsSelectedIndex()).toBe(1)
  })

  it.each([
    ['no match', async () => ({ videoDevice: 'Unknown cam' })],
    ['no videoDevice', async () => ({})],
    ['unreadable settings file', async () => Promise.reject(new Error('ENOENT'))]
  ])('falls back to index 0 on %s', async (_name, readTeamsSettings) => {
    const service = new CameraDeviceService({
      launch,
      listDevices: async () => DEVICES,
      readTeamsSettings
    })
    expect(await service.getTeamsSelectedIndex()).toBe(0)
  })

  it('falls back to index 0 when enumeration fails', async () => {
    const service = new CameraDeviceService({
      launch,
      listDevices: async () => Promise.reject(new Error('boom')),
      readTeamsSettings: async () => ({ videoDevice: 'Logitech C920' })
    })
    expect(await service.getTeamsSelectedIndex()).toBe(0)
  })
})

describe('resolveTrackerLaunch', () => {
  const base = {
    isPackaged: false,
    resourcesPath: '/res',
    appPath: '/repo/electron',
    platform: 'darwin' as const
  }

  it('uses the packaged binary under resources/tracker', () => {
    expect(resolveTrackerLaunch({ ...base, isPackaged: true })).toEqual({
      command: '/res/tracker/tracker',
      args: []
    })
    expect(resolveTrackerLaunch({ ...base, isPackaged: true, platform: 'win32' }).command).toMatch(
      /tracker[\\/]tracker\.exe$/
    )
  })

  it('prefers $PYTHON, then the repo .venv, then the system interpreter in development', () => {
    const script = '/repo/python/main.py'
    expect(resolveTrackerLaunch({ ...base, pythonOverride: '/opt/py' })).toEqual({
      command: '/opt/py',
      args: [script]
    })
    expect(resolveTrackerLaunch({ ...base, existsSync: () => true })).toEqual({
      command: '/repo/.venv/bin/python',
      args: [script]
    })
    expect(resolveTrackerLaunch({ ...base, existsSync: () => false }).command).toBe('python3')
    expect(
      resolveTrackerLaunch({ ...base, platform: 'win32', existsSync: () => false }).command
    ).toBe('python')
  })

  it('ignores the interpreter override when packaged', () => {
    expect(
      resolveTrackerLaunch({ ...base, isPackaged: true, pythonOverride: '/evil/py' }).command
    ).toBe('/res/tracker/tracker')
  })
})
