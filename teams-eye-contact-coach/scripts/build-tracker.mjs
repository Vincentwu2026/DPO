// Builds the self-contained gaze tracker binary with PyInstaller into electron/resources/tracker/.
// Run on the target OS (PyInstaller does not cross-compile). Requires: pip install -r python/requirements-dev.txt
// and `npm run fetch:model`.
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const venvPython = join(root, '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python')
const python =
  process.env.PYTHON ?? (existsSync(venvPython) ? venvPython : isWin ? 'python' : 'python3')

const model = join(root, 'python', 'models', 'face_landmarker.task')
if (!existsSync(model)) {
  console.error('Model missing. Run `npm run fetch:model` first.')
  process.exit(1)
}

const outDir = join(root, 'electron', 'resources')
const work = join(root, 'python', 'build')
rmSync(join(outDir, 'tracker'), { recursive: true, force: true })

const sep = isWin ? ';' : ':'
const result = spawnSync(
  python,
  [
    '-m',
    'PyInstaller',
    '--noconfirm',
    '--clean',
    '--onedir', // faster startup than --onefile (no per-launch extraction) and easier to sign
    '--name',
    'tracker',
    '--distpath',
    outDir,
    '--workpath',
    work,
    '--specpath',
    work,
    '--paths',
    join(root, 'python'),
    '--add-data',
    `${model}${sep}models`,
    '--collect-all',
    'mediapipe',
    '--hidden-import',
    'gaze.camera',
    '--hidden-import',
    'gaze.estimator',
    '--hidden-import',
    'gaze.classifier',
    '--exclude-module',
    'tkinter',
    join(root, 'python', 'main.py')
  ],
  { cwd: root, stdio: 'inherit' }
)
rmSync(work, { recursive: true, force: true })
process.exit(result.status ?? 1)
