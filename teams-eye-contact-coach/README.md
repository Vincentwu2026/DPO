# Teams Eye Contact Coach

Cross-platform (Windows + macOS) desktop companion that tracks eye contact during Microsoft Teams
meetings. This repository is a monorepo:

| Package           | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `electron/`       | Electron app (electron-vite, TypeScript): main/preload/renderer |
| `python/`         | MediaPipe gaze tracker side-process                             |
| `azure-function/` | Graph notification relay (stub)                                 |
| `backend/`        | Cloud dashboard REST API (stub)                                 |
| `dashboard/`      | Cloud dashboard web SPA (stub)                                  |

## Prerequisites

- Node.js 20.19+ (Node 22 LTS recommended) and npm
- Python 3.11+ and pip

## Setup

```bash
# JavaScript dependencies (installs all workspaces)
npm install

# Python virtual environment (recommended; scripts auto-detect .venv)
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r python/requirements-dev.txt

# Download the MediaPipe FaceLandmarker model (SHA-256 verified, ~4 MB, git-ignored)
npm run fetch:model
```

## Run in development

```bash
npm run dev
```

This uses `concurrently` to start `electron-vite dev` (opens a blank Electron window with hot reload)
and the Python gaze tracker (`python/main.py`). Set the `PYTHON` environment variable to use a
specific interpreter.

## Gaze tracker (`python/`)

`python python/main.py [--camera-index N] [--confidence-threshold X] [--model PATH]` opens the
webcam and streams newline-delimited JSON on stdout:

```json
{"type": "ready", "version": "0.1.0"}
{"type": "devices", "list": [{"index": 0, "name": "MacBook Pro Camera"}]}
{"type": "gaze", "ts": 1700000000.123, "zone": "camera", "confidence": 0.91}
{"type": "error", "message": "Cannot open camera 7"}
```

Commands are accepted on stdin, one JSON object per line: `{"cmd": "set_camera", "index": N}` and
`{"cmd": "set_confidence_threshold", "value": 0.0-1.0}`. The process exits on SIGTERM/SIGINT or when
stdin is closed. Frames are processed in memory only and are never stored or transmitted.

The zone thresholds in `python/gaze/classifier.py` (`GazeThresholds`) are starting values and
should be tuned against real footage. macOS prompts for camera permission on first use.

## HUD, alerts and session history

While a Teams call is detected, the main process opens a small floating HUD (transparent,
always-on-top, hidden from screen capture, click-through except its drag grip and collapse button).
It shows the camera eye-contact percentage, the current zone (green camera, amber screen, red away),
a session timer and an "Active presenter" badge. Its position and collapsed state are remembered.
The HUD and alerts run in the `realtime` and `both` tracking modes; in `postcall` mode the tracker
still records but nothing is shown.

An alert fires after the configured number of consecutive off-camera seconds (default 5, with a 3 s
grace period at the start of a session) and clears when you look back at the camera. It pulses a red
border and/or plays a short ping (`electron/resources/sounds/ping.wav`, regenerate with
`node scripts/generate-alert-sound.mjs`), depending on the settings.

Every gaze event is stored in a local SQLite database, `sessions.db` in the app's user-data folder,
together with the meeting subject. The schema is versioned with `PRAGMA user_version`, and sessions
left open by a crash are closed on the next start. Renderers can only read it through the typed
`window.sessions.list()` and `getSummary(id)` calls; the file path is never exposed. Summaries are
time-weighted, and a gap of more than 2 s between events is not counted.

### Trying the HUD without Teams

In development you can simulate a call, with no Azure/Graph setup, using your real webcam:

```bash
cd electron
FAKE_CALL=1 FAKE_CALL_SECONDS=90 npx electron-vite dev
```

The HUD appears at the top right of the screen, shows an "Active presenter" badge for a few
seconds, and a session is written to `sessions.db`. Add `FAKE_CALL_QUIT=1` to exit when the call
ends; a session summary (aggregates only) is then printed to the console. This hook is ignored in
packaged builds.

### Coaching hints and gaze steadiness

The HUD shows a one-line coaching hint under the gauge: "Good eye contact" on camera, a calm
"Eyes on screen" for a short glance, an amber "Look at the camera" with a soft glow after 2 s off
camera, and a red "Look at the camera now" once the look-away alert fires. The speaker icon in the
HUD mutes the alert sound for the current call without changing the saved setting. Hints can be
turned off in Settings.

The tracker smooths the camera/screen/away zone so it does not flicker (exponential smoothing of
the gaze deviation, a dead band around the camera/screen boundary, and a short dwell before a
change is committed). Choose **Responsive**, **Balanced** (default) or **Steady** in Settings; the
change applies live. On one real 15 s webcam recording the raw classifier flipped 2.3 times per
second, Balanced 0.3 and Steady 0.07. Steadier presets also react more slowly to a real look-away.

Known limits: Windows is untested, the zone thresholds are untuned, and the HUD has only been
checked at 2x DPI on macOS.

## Scripts

| Command                 | Description                                           |
| ----------------------- | ----------------------------------------------------- |
| `npm run dev`           | Start Electron (dev mode) and the Python gaze tracker |
| `npm run fetch:model`   | Download the FaceLandmarker model                     |
| `npm run build:tracker` | Bundle the Python tracker (PyInstaller) for packaging |
| `npm run test:py`       | Run the Python unit tests (pytest)                    |
| `npm run lint`          | ESLint (TypeScript) + Ruff and Black check (Python)   |
| `npm run format`        | Prettier (JS/TS/JSON/MD) + Black (Python)             |
| `npm run format:check`  | Prettier check                                        |
| `npm run typecheck`     | `tsc --noEmit` for the Electron main/preload/renderer |
| `npm run build`         | Type-check and build the Electron app                 |

Distributables (run from `electron/`): `npm run build:win` (NSIS installer) and
`npm run build:mac` (DMG). Build each on its target OS.

## Troubleshooting

If Electron crashes at startup with `Cannot read properties of undefined (reading 'whenReady')`,
your shell has `ELECTRON_RUN_AS_NODE` set. The Electron config clears it for dev runs; unset it in
your shell if you launch Electron another way.

## Security

Never commit `.env` files, keys, or tokens. Use environment variables or the OS keychain.
