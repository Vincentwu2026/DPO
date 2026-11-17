import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EventEmitter } from 'node:events'
import { parseTrackerLine, type TrackerDevice } from './protocol'
import type { TrackerLaunch } from './TrackerProcess'

const LIST_TIMEOUT_MS = 30_000

export type ListDevicesFn = (launch: TrackerLaunch) => Promise<TrackerDevice[]>

/** Runs `tracker --list-devices` and parses its single `devices` line. */
export const listDevicesViaTracker: ListDevicesFn = (launch) =>
  new Promise((resolve, reject) => {
    execFile(
      launch.command,
      [...launch.args, '--list-devices'],
      { timeout: LIST_TIMEOUT_MS, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) return reject(new Error('Camera enumeration failed'))
        for (const line of stdout.split('\n')) {
          const message = parseTrackerLine(line.trim())
          if (message?.type === 'devices') return resolve(message.list)
        }
        reject(new Error('Camera enumeration returned no device list'))
      }
    )
  })

/** Location of the Teams settings file, or null on platforms Teams settings are not read from. */
export function teamsSettingsPath(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir()
): string | null {
  if (platform === 'win32') {
    return env['APPDATA'] ? join(env['APPDATA'], 'Microsoft', 'Teams', 'settings.json') : null
  }
  if (platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Microsoft', 'Teams', 'settings.json')
  }
  return null
}

/** Pull the `videoDevice` label from parsed Teams settings (a string, or an object with a label). */
export function extractVideoDeviceLabel(settings: unknown): string | null {
  if (typeof settings !== 'object' || settings === null) return null
  const value = (settings as Record<string, unknown>)['videoDevice']
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'object' && value !== null) {
    const label = (value as Record<string, unknown>)['label']
    if (typeof label === 'string') return label.trim() || null
  }
  return null
}

/** Index of the device whose name equals (preferred) or contains/is contained by the label. */
export function matchDeviceIndex(devices: TrackerDevice[], label: string): number | null {
  const wanted = label.trim().toLowerCase()
  if (!wanted) return null
  const exact = devices.find((d) => d.name.toLowerCase() === wanted)
  if (exact) return exact.index
  const partial = devices.find((d) => {
    const name = d.name.toLowerCase()
    return name.includes(wanted) || wanted.includes(name)
  })
  return partial ? partial.index : null
}

export interface CameraDeviceServiceOptions {
  launch: TrackerLaunch
  /** When given, its `devices` events refresh the cache (avoids re-probing cameras mid-session). */
  tracker?: Pick<EventEmitter, 'on'>
  listDevices?: ListDevicesFn
  readTeamsSettings?: () => Promise<unknown>
}

export class CameraDeviceService {
  private cache: TrackerDevice[] | null = null
  private readonly listDevices: ListDevicesFn
  private readonly readTeamsSettings: () => Promise<unknown>

  constructor(private readonly options: CameraDeviceServiceOptions) {
    this.listDevices = options.listDevices ?? listDevicesViaTracker
    this.readTeamsSettings = options.readTeamsSettings ?? defaultReadTeamsSettings
    options.tracker?.on('devices', (list: TrackerDevice[]) => {
      this.cache = list
    })
  }

  /** Cached list if available, otherwise probes via the tracker binary. `refresh` forces a probe. */
  async getDevices(refresh = false): Promise<TrackerDevice[]> {
    if (!this.cache || refresh) this.cache = await this.listDevices(this.options.launch)
    return this.cache
  }

  /** Index of the camera Teams uses (matched by label); 0 when unknown or unmatched. */
  async getTeamsSelectedIndex(): Promise<number> {
    try {
      const label = extractVideoDeviceLabel(await this.readTeamsSettings())
      if (!label) return 0
      return matchDeviceIndex(await this.getDevices(), label) ?? 0
    } catch {
      return 0
    }
  }
}

async function defaultReadTeamsSettings(): Promise<unknown> {
  const path = teamsSettingsPath(process.platform)
  if (!path) return null
  return JSON.parse(await readFile(path, 'utf8')) as unknown
}
