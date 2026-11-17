import { existsSync as fsExistsSync } from 'node:fs'
import { join } from 'node:path'
import type { TrackerLaunch } from './TrackerProcess'

export interface LaunchEnvironment {
  isPackaged: boolean
  /** Electron's `process.resourcesPath` (packaged builds). */
  resourcesPath: string
  /** Electron's `app.getAppPath()`; the `electron/` workspace directory when running unpackaged. */
  appPath: string
  platform: NodeJS.Platform
  /** Interpreter override, honoured only for unpackaged (development) runs. */
  pythonOverride?: string
  existsSync?: (path: string) => boolean
}

/**
 * Packaged builds run the PyInstaller binary shipped in `resources/tracker/` (no Python needed).
 * Development runs `python/main.py` with $PYTHON, else the repo `.venv`, else the system Python.
 */
export function resolveTrackerLaunch(env: LaunchEnvironment): TrackerLaunch {
  const exists = env.existsSync ?? fsExistsSync
  const win = env.platform === 'win32'

  if (env.isPackaged) {
    return {
      command: join(env.resourcesPath, 'tracker', win ? 'tracker.exe' : 'tracker'),
      args: []
    }
  }

  const repoRoot = join(env.appPath, '..')
  const venvPython = join(repoRoot, '.venv', win ? 'Scripts' : 'bin', win ? 'python.exe' : 'python')
  const command =
    env.pythonOverride || (exists(venvPython) ? venvPython : win ? 'python' : 'python3')
  return { command, args: [join(repoRoot, 'python', 'main.py')] }
}
