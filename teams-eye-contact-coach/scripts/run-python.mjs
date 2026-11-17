// Cross-platform Python launcher: prefers $PYTHON, then the repo .venv, then the system interpreter.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const isWin = process.platform === 'win32'
const venvPython = join(root, '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python')

let python = process.env.PYTHON
if (!python) python = existsSync(venvPython) ? venvPython : isWin ? 'python' : 'python3'

const child = spawn(python, process.argv.slice(2), { cwd: root, stdio: 'inherit' })
child.on('error', (err) => {
  console.error(`Failed to start Python (${python}): ${err.message}`)
  process.exit(1)
})
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
