# Teams Eye Contact Coach

Cross-platform (Windows + macOS) desktop companion that tracks eye contact during Microsoft Teams
meetings. This repository is a monorepo:

| Package           | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `electron/`       | Electron app (electron-vite, TypeScript): main/preload/renderer |
| `python/`         | MediaPipe gaze tracker side-process                             |
| `azure-function/` | Graph notification relay (stub)                                 |
| `backend/`        | Cloud dashboard REST API (Fastify + PostgreSQL)                 |
| `dashboard/`      | Cloud dashboard web SPA (React + Vite + MSAL + Recharts)        |

**Using the app?** See the [User Guide](docs/USER-GUIDE.md). **Testing it without Azure access?**
See [Tester setup](docs/TESTER-SETUP.md) (manual Start/Stop Session from the tray). The rest of this
README is for developers.

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

Commands are accepted on stdin, one JSON object per line: `set_camera`, `set_confidence_threshold`,
`set_stability`, `set_thresholds` and the `calibration_*` commands (see the docstring in
`python/main.py` for the full protocol). The process exits on SIGTERM/SIGINT or when stdin is
closed. Frames are processed in memory only and are never stored or transmitted.

The default zone thresholds in `python/gaze/classifier.py` (`GazeThresholds`) are generic starting
values. Each user can replace them with personal ones by running **Calibrate Eye Contact** (below).
macOS prompts for camera permission on first use.

### Calibration

The tray menu has **Calibrate Eye Contact…** (**Recalibrate** once done). It opens a window at the
top centre of the screen with a glowing lens target, a live mirrored webcam preview and the live
readings (iris position, head turn and tilt, detected zone). Two guided steps follow a 3 s countdown
each: look at the lens, then at the middle of the screen. `python/gaze/calibration.py` then fits
personal thresholds: the centre of each reading while looking at the lens, a tolerance from its
natural jitter (kept short of where the screen look sits), and a head-angle centre that removes the
per-camera pose bias. The result is only offered for saving when at least 85% of the lens frames
and 70% of the screen frames are classified correctly with it; otherwise the window explains what
to change and offers to try again. **Use default settings** forgets the calibration.

How it is protected: the renderer cannot supply thresholds, because main keeps the last fit the
tracker produced and only that can be saved. Thresholds are range-checked in Python, in
`protocol.ts` and again when read from disk (`calibration.json` in the user-data folder). The
webcam preview exists only while the window is open, travels over the local child-process pipe as a
small JPEG, and is never written to disk. The preview is validated as base64 and size-limited in the
main process. The webcam also runs while the window is open outside a call, and stops again when it
closes. In development, `OPEN_CALIBRATION=1 npx electron-vite dev` opens the window at startup.

## HUD, alerts and session history

While a session is running, the main process opens a small floating HUD (transparent,
always-on-top, click-through except its drag grip and collapse button). It is visible to screen
capture by default so it can be demoed; the `hudHiddenFromCapture` setting turns on
`setContentProtection`. The main window also shows a live panel (gauge, zone, timer, hint, zone
breakdown, Start/Stop button, red pulse on alerts) built from the same `shared/hudModel.ts`, so the
whole app can be shared on screen.
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

### Speaking time

Every gaze event is stored with a `speaking` flag that is true while the signed-in user is the
active speaker in Teams (Graph, polled every 5 s, so about 5 s resolution). All gaze is still
recorded; session summaries carry an overall breakdown plus a `speaking` breakdown, which is what
the cloud dashboard reports. Sessions recorded before this change count as not speaking.

Known limits: Windows is untested, the default zone thresholds are untuned (calibrate to fit your
setup), and the HUD has only been checked at 2x DPI on macOS.

## Cloud sync and dashboard API

The desktop app can upload finished sessions to a small REST API (`backend/`, Fastify + PostgreSQL).
It is optional: without `API_BASE_URL` and `API_SCOPE` in `electron/.env` the app stays local-only.

**What is uploaded:** only the time you were the active speaker, as run-length segments
(`start`, `duration`, `zone`) plus the session's date, mode and Teams subject. Time spent listening
is never sent. **Who can see it:** only you. The API takes your identity from the validated Entra
token (`oid` claim), never from a request parameter; another user's session id returns 404.

- `POST /api/sessions` stores a session (idempotent on the session UUID).
- `GET /api/sessions?limit=&before=` lists your sessions, newest first.
- `GET /api/sessions/:id` returns the speaking-time breakdown and a timeline.

After a call ends, the desktop app uploads in the background using a silent token (it never opens a
sign-in window), retrying with exponential back-off (1 s, 2 s; 3 attempts). Anything that fails is
retried at the next start-up or sign-in. Sessions recorded before this feature are not uploaded.

Run the API locally: copy `backend/.env.example` to `backend/.env`, fill it in, then
`npm run dev --workspace backend`. It binds to `127.0.0.1` and refuses `0.0.0.0`. You need an Entra
app registration for the API that exposes a delegated scope `Sessions.ReadWrite`, and the desktop
app's registration must be granted that scope. `npm test --workspace backend` needs no cloud
resources (PostgreSQL runs in-process via PGlite; tokens are signed with a test key).

### Web dashboard (`dashboard/`)

A React single-page app where a signed-in user sees their own history: a session list (date,
meeting, speaking time, camera eye-contact %), a session page (donut of time per zone and a
stacked timeline chart) and a trend page (camera % across sessions). It signs in with
`@azure/msal-browser` (authorization-code flow with PKCE, tokens kept in `sessionStorage`) and calls
the API with a bearer token. API responses are validated with Zod before rendering.

Register a second Entra app registration for it, as a **Single-page application** with the
dashboard's origin as redirect URI (`http://127.0.0.1:5173` for local development), and grant it the
API's `Sessions.ReadWrite` scope. Then copy `dashboard/.env.example` to `dashboard/.env.local`, fill
it in (all values are public client configuration, no secrets), add the dashboard origin to the
API's `CORS_ORIGINS`, and run `npm run dev --workspace dashboard`.

### Azure deployment

- **Dashboard → Azure Static Web Apps:** `dashboard/public/staticwebapp.config.json` provides the
  SPA fallback and security headers (CSP, HSTS, no-referrer). `.github/workflows/deploy-dashboard.yml`
  tests, builds and uploads `dashboard/dist`. Set the repository variables `AZURE_TENANT_ID`,
  `DASHBOARD_CLIENT_ID`, `API_SCOPE`, `API_BASE_URL` and the secret `AZURE_STATIC_WEB_APPS_API_TOKEN`.
  The CSP `connect-src` allows `https://*.azurewebsites.net`; tighten it to your API's exact host if
  you use a custom domain.
- **Backend → Azure App Service (Node 22 Linux):** `.github/workflows/deploy-backend.yml` tests,
  builds, packages `dist/` with production dependencies only, and deploys using OIDC federated login
  (no stored Azure credentials). Set the repository variables `AZURE_DEPLOY_CLIENT_ID`,
  `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `BACKEND_APP_NAME`. In the App Service configuration
  set the variables from `backend/.env.example` (`DATABASE_URL` as a Key Vault reference,
  `TRUST_PROXY=true`, `CORS_ORIGINS` to the dashboard origin, `HOST` to the instance's specific
  internal address) and the startup command `node backend/dist/server.js`.

Not yet verified against real services: Entra sign-in and token validation with live JWKS, `pg`
against Azure Database for PostgreSQL, and both Azure deployments (the workflows have never run;
the backend package was only checked to start from a clean directory). The dashboard pages were
also rendered in headless Chrome against the real API (test data, signed test tokens, production
CSP headers): the list, session and trend pages and the charts display correctly, a hostile
meeting subject is shown as text, and another user's session id and a bad token are refused. The
MSAL sign-in redirect itself has not been exercised.

## Scripts

| Command                 | Description                                             |
| ----------------------- | ------------------------------------------------------- |
| `npm run dev`           | Start Electron (dev mode) and the Python gaze tracker   |
| `npm run fetch:model`   | Download the FaceLandmarker model                       |
| `npm run build:tracker` | Bundle the Python tracker (PyInstaller) for packaging   |
| `npm run test:py`       | Run the Python unit tests (pytest)                      |
| `npm run lint`          | ESLint (TypeScript) + Ruff and Black check (Python)     |
| `npm run format`        | Prettier (JS/TS/JSON/MD) + Black (Python)               |
| `npm run format:check`  | Prettier check                                          |
| `npm run typecheck`     | `tsc --noEmit` for the Electron main/preload/renderer   |
| `npm run build`         | Type-check and build the Electron app                   |
| `npm test -w backend`   | Run the API tests (supertest-style, via Fastify inject) |
| `npm test -w dashboard` | Run the dashboard logic tests                           |

Distributables: build on the target OS. For a Mac (Apple Silicon) DMG, from the repo root run
`npm run fetch:model` and `npm run build:tracker`, then from `electron/` run `npm run build:mac`. The
DMG is written to `electron/dist/Teams-Eye-Contact-Coach-<version>-arm64.dmg` (about 250 MB). It is
ad-hoc signed, not notarized: other Macs need _System Settings > Privacy & Security > Open Anyway_
on first launch. Upload it as a GitHub Release asset (it is far too large to commit). Windows
(`npm run build:win`) has not been tried. If you change the `electron` version in `package.json`,
update `electronVersion` in `electron/electron-builder.yml` too.

## Troubleshooting

If Electron crashes at startup with `Cannot read properties of undefined (reading 'whenReady')`,
your shell has `ELECTRON_RUN_AS_NODE` set. The Electron config clears it for dev runs; unset it in
your shell if you launch Electron another way.

## Security

Never commit `.env` files, keys, or tokens. Use environment variables or the OS keychain.
