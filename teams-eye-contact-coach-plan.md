# Teams Eye Contact Coach — Implementation Plan

## Top-Level Overview

**Goal:** Build a cross-platform (Windows + macOS) desktop companion app that:
1. Detects when the user is in a Microsoft Teams meeting (via Microsoft Graph API).
2. Uses the webcam and MediaPipe Face Mesh (Python side-process) to continuously classify gaze zones: *camera*, *screen*, or *away*.
3. Displays a real-time floating HUD overlay with live eye-contact percentage and zone indicator.
4. Fires configurable audio/visual alerts when the presenter looks away from the camera for too long.
5. Persists a per-session gaze timeline and uploads it to a cloud dashboard so coaches and managers can track presenter progress over time.
6. Shows a post-session summary report within the app — available immediately after the call or on demand post-call.

**Key Design Decisions (from requirements):**

| Decision | Choice |
|---|---|
| **Tracking mode** | User (host) selects: *real-time* (live HUD + alerts during call), *post-call* (silent recording, report shown after), or *both* |
| **Camera device** | App detects the same webcam the presenter has selected in Teams; presenter can override in Settings |
| **Multi-presenter** | The meeting host controls when tracking starts; the app tracks whoever is the **active speaker** — each participant runs the app on their own machine and tracking activates when they become the active speaker |

**Approach:** Electron (Node.js + Chromium) for the shell, UI, and Graph API integration; a Python MediaPipe side-process for gaze estimation; an Azure Function as a Graph change-notification relay (forwarding to the desktop app via WebSocket); and an Azure-hosted backend (REST API + database) for the cloud dashboard.

**Non-goals (out of scope for this plan):**
- Hardware eye-tracker support (Tobii, etc.)
- Video recording or screen capture of the meeting
- Modifying the Teams UI directly
- Tracking remote participants' webcams (each user tracks only themselves locally)

---

## Architecture Diagram (textual)

```
Microsoft Graph API
        |  (change notification)
        v
Azure Function (relay)
        |  (WebSocket push)
        v
Electron Main Process
   |              |
   | IPC          | MSAL auth / Graph polling
   v              v
Python MediaPipe   Microsoft 365
Side-Process       User Account
   |
   | JSON gaze events (stdout)
   v
Electron Renderer
  - Floating HUD Overlay (always-on-top, transparent)
  - Alert Engine (flash + sound)
  - Post-session Report Window
        |
        v
     SQLite (local)
        |
        v
  Azure Backend API  -->  Cloud Dashboard (web)
```

---

## Sub-Tasks

---

### Sub-Task 1 — Project Scaffold

**Status:** [ ] pending

**Intent:**
Establish the monorepo structure, tooling, and local dev scripts so every subsequent sub-task has a stable foundation to build on.

**Expected Outcomes:**
- Repository root with `electron/`, `python/`, `azure-function/`, `backend/`, `dashboard/` packages.
- `package.json` workspace (npm/yarn) for JS packages; `pyproject.toml` / `requirements.txt` for Python.
- Electron app boots to a blank window; Python side-process starts and exits cleanly.
- Lint, format, and type-check scripts pass with zero errors.
- README with local dev setup instructions.

**Todo List:**
1. Create monorepo root with `package.json` workspaces pointing to `electron/` and `dashboard/`.
2. Scaffold Electron app using `electron-vite` (Vite + TypeScript template): main, preload, renderer layers.
3. Add `electron-builder` configuration targeting Windows (NSIS) and macOS (DMG) distributable outputs.
4. Create `python/` package: `requirements.txt` (mediapipe, opencv-python, numpy), `pyproject.toml`, entry `main.py` stub.
5. Add root dev script that concurrently starts `electron-vite dev` and the Python stub process.
6. Configure ESLint + Prettier for TypeScript; Ruff + Black for Python.
7. Add `.gitignore` covering `node_modules`, `dist`, `__pycache__`, `.env` files, and secrets.
8. Write `README.md` with prerequisites (Node 20+, Python 3.11+, pip) and `npm run dev` instructions.

**Relevant Context:**
- `electron-vite` docs: https://electron-vite.org
- `electron-builder` docs: https://www.electron.build
- Security rule: never commit `.env` or secrets; use environment variables.

---

### Sub-Task 2 — Microsoft Graph Auth, Meeting Detection, and Active-Speaker Events

**Status:** [x] done

**Intent:**
Authenticate the user against their Microsoft 365 account using MSAL, subscribe to meeting presence and active-speaker events via Microsoft Graph, relay events to the Electron app via an Azure Function WebSocket relay, and expose a tracking-mode selector — so each participant knows when to start tracking (host-triggered) and tracking automatically hands off as the active speaker changes.

**Expected Outcomes:**
- User can sign in with their M365 account via an Electron pop-up OAuth2 window.
- Access token is stored securely using the OS keychain (`keytar`) — never on disk in plaintext.
- Azure Function is deployed and can receive Graph change notifications over HTTPS.
- Azure Function forwards meeting-state and active-speaker change events to connected Electron clients via WebSocket.
- Electron main process receives `MEETING_STARTED`, `MEETING_ENDED`, `SPEAKER_ACTIVE` (this user is now presenting), and `SPEAKER_INACTIVE` signals.
- Host can emit a `START_TRACKING` / `STOP_TRACKING` command (via the HUD Settings panel) that is broadcast to all connected participants through the Azure Function relay.
- Tracking mode (real-time / post-call / both) is persisted in `electron-store` and respected by the tracker and overlay.

**Todo List:**
1. Register an Azure Active Directory (Entra ID) application:
   - Redirect URI: `msal://redirect` (custom scheme for Electron).
   - Required Graph permissions: `OnlineMeetings.Read`, `Presence.Read`, `CallRecords.Read.All`.
2. Add `@azure/msal-node` to `electron/` and implement auth service:
   - `AuthService.signIn()` — opens pop-up, caches token in `keytar`.
   - `AuthService.getAccessToken()` — silent refresh or re-prompt.
   - `AuthService.signOut()` — clears keychain entry.
3. Scaffold Azure Function (Node.js v4 model, TypeScript) in `azure-function/`:
   - HTTP trigger endpoint `/api/notifications` — validates Graph subscription lifecycle (validation token handshake + notification handler).
   - WebSocket hub: push meeting-state and active-speaker events to connected Electron clients; accept host `START_TRACKING` / `STOP_TRACKING` commands and broadcast them to all participants in the same meeting.
4. Register Graph subscriptions from Electron at app start:
   - `communications/callRecords` (change type: `created`) — meeting ended.
   - `users/{id}/presence` polling every 15 s — detect in-call vs available (supplemental real-time trigger).
   - Subscription renewal: refresh every 60 minutes.
5. Detect active speaker: poll `GET /communications/calls/{id}/participants` every 5 s during a call; compare `isActiveSpeaker` flag against the signed-in user's ID. Emit `SPEAKER_ACTIVE` / `SPEAKER_INACTIVE` IPC events accordingly.
6. Add tracking-mode selector to the system-tray Settings panel:
   - `Real-time` — HUD overlay + alerts active during call.
   - `Post-call` — silent capture; report shown only after the call.
   - `Both` — HUD active during call and report shown after.
   - Persist selection in `electron-store`.
7. In Electron main process, wire all signals: start tracker on `SPEAKER_ACTIVE` + host has started tracking; stop tracker on `SPEAKER_INACTIVE` or `MEETING_ENDED`.
8. Write unit tests for `AuthService` (mock MSAL) and Azure Function notification + broadcast handler.

**Relevant Context:**
- Security rule: store tokens in OS keychain (`keytar`), never in `localStorage` or plaintext files.
- Graph active-speaker API: `GET /communications/calls/{id}/participants` — requires `Calls.AccessMedia.All` or `OnlineMeetings.ReadWrite` depending on call type; verify required permissions.
- Graph change notifications require a publicly reachable HTTPS endpoint — Azure Function URL satisfies this.
- MSAL Electron sample: https://github.com/AzureAD/microsoft-authentication-library-for-js/tree/dev/samples/msal-node-samples/ElectronSystemBrowserTestApp

---

### Sub-Task 3 — Python Gaze Tracker Side-Process

**Status:** [x] done (items 1–8 verified on Apple Silicon; item 9 Windows x64 still needs to be verified on a Windows machine. Implementation uses the MediaPipe Tasks `FaceLandmarker` API because mediapipe 1.2.3 no longer ships `mp.solutions`; the model is fetched with `npm run fetch:model`.)

**Intent:**
Implement the MediaPipe-based gaze estimation engine that reads webcam frames, classifies gaze into zones (*camera*, *screen*, *away*), and streams structured JSON events to the Electron main process over stdin/stdout IPC.

**Expected Outcomes:**
- Running `python python/main.py` opens the webcam and prints JSON lines to stdout, e.g.:
  `{"ts": 1700000000.123, "zone": "camera", "confidence": 0.91}`
- Classification latency is under 100 ms per frame on a modern laptop CPU.
- Process exits cleanly on SIGTERM / when stdin is closed.
- Unit tests cover zone classification logic with synthetic landmark inputs.

**Todo List:**
1. Implement `GazeEstimator` class using `mediapipe.solutions.face_mesh`:
   - Extract iris landmarks (points 468–477) and eye corner landmarks.
   - Compute iris position relative to eye bounding box to derive horizontal/vertical gaze ratios.
2. Implement head-pose estimation using the 6-point PnP method (solvePnP with facial geometry landmarks) to handle cases where the face is turned.
3. Define gaze zone classifier:
   - *camera*: gaze ratio within configurable thresholds around center + head pose frontal.
   - *screen*: gaze ratio displaced down/sideways beyond threshold.
   - *away*: face not detected or extreme head rotation.
4. Implement camera device discovery:
   - On startup, enumerate available `cv2.VideoCapture` indices (0–9) and query device names via `cv2` backend properties or platform APIs (`AVFoundation` on macOS, `DirectShow` on Windows).
   - Emit device list as a JSON message on stdout at startup before the main gaze loop begins.
   - Accept a `{"cmd": "set_camera", "index": N}` JSON command on stdin to hot-swap the camera without restarting the process.
5. Implement main loop: open `cv2.VideoCapture(cameraIndex)`, process frame, write gaze JSON to `sys.stdout`, flush.
6. Handle graceful shutdown: trap `SIGTERM` and `EOFError` on stdin read.
7. Add `--camera-index` and `--confidence-threshold` CLI flags (overridden at runtime by stdin commands).
8. Write pytest unit tests for `GazeEstimator` and zone classifier using static landmark fixtures.
9. Verify mediapipe + opencv run on both Apple Silicon (arm64) and Windows x64.

**Relevant Context:**
- MediaPipe Face Mesh iris landmark indices: 468 (left iris center), 473 (right iris center).
- Security rule: webcam access is local only; frames are never stored or transmitted.
- Camera device selection goal: auto-select the same device the user has chosen in Teams. The Electron layer will read the Teams-selected device from the OS media API and pass the matching index to the Python process via stdin command.
- Performance note: run MediaPipe in `static_image_mode=False` for video stream performance.

---

### Sub-Task 4 — Electron to Python IPC Bridge

**Status:** [x] done (verified on Apple Silicon: real tracker and the PyInstaller bundle, both inside the packaged `.app`. Windows x64 binary and the Teams `settings.json` label match still need checking on Windows/with Teams installed; see notes in the README.)

**Intent:**
Create the Electron main-process module that spawns the Python side-process, manages its lifecycle, and translates stdout JSON events into typed Electron IPC messages that the renderer can subscribe to.

**Expected Outcomes:**
- `TrackerProcess` module spawns `python main.py` on `MEETING_STARTED` and kills it on `MEETING_ENDED`.
- Gaze JSON events are parsed and emitted as `gaze:update` IPC events to the renderer.
- If the Python process crashes, it is restarted automatically (up to 3 attempts).
- Preload script exposes a typed `window.gazeTracker` API to the renderer sandbox.

**Todo List:**
1. Create `TrackerProcess` class in `electron/src/main/`:
   - `start(cameraIndex: number)`: spawns Python with `child_process.spawn`, attaches stdout line-by-line reader.
   - `stop()`: sends SIGTERM, waits for exit, cleans up.
   - `setCamera(index: number)`: writes `{"cmd": "set_camera", "index": N}` JSON to the Python process stdin — no restart needed.
   - Restart logic: exponential back-off, max 3 retries, then emit `tracker:error` IPC event.
2. Implement `CameraDeviceService` in Electron main:
   - On app start, query the OS default media device list using the Electron `desktopCapturer` or the `MediaDevices` API (via a hidden renderer) to enumerate video input devices.
   - Cross-reference with the Teams-selected camera: read the Teams configuration from its local app settings file (`%APPDATA%/Microsoft/Teams/settings.json` on Windows; `~/Library/Application Support/Microsoft/Teams/settings.json` on macOS) to find the `videoDevice` label.
   - Match label against the enumerated device list to resolve the device index; fall back to index 0 if unmatched.
   - Expose `CameraDeviceService.getDevices()` and `CameraDeviceService.getTeamsSelectedIndex()` for use in Settings.
3. Parse stdout: split on newline, `JSON.parse` each line; handle both `{type: "devices", list: [...]}` (startup) and `{type: "gaze", ts, zone, confidence}` event shapes. Emit `gaze:update` and `tracker:devices` IPC events to the renderer accordingly.
4. Update preload script to expose:
   - `window.gazeTracker.onUpdate(callback)` — registers a gaze event listener.
   - `window.gazeTracker.onError(callback)` — registers an error listener.
   - `window.gazeTracker.onDevices(callback)` — receives camera device list on startup.
   - `window.gazeTracker.setCamera(index)` — IPC invoke to `CameraDeviceService.setCamera`.
5. Bundle the Python interpreter + dependencies using PyInstaller into a self-contained binary placed in `resources/` so users do not need Python installed.
6. Write integration test: spawn process with a mock Python script that emits synthetic JSON, assert IPC events are received.

**Relevant Context:**
- Electron context isolation is enabled; all Node APIs must go through the preload bridge.
- PyInstaller `--onefile` output goes in `electron/resources/tracker` (platform-specific binary).
- Security rule: never expose raw `child_process` to the renderer.

---

### Sub-Task 5 — Real-Time HUD Overlay

**Status:** [ ] pending

**Intent:**
Create a floating, always-on-top, transparent Electron window that displays live gaze feedback — a camera eye-contact percentage gauge, a current zone indicator, and a session timer — without blocking click-through to other windows.

**Expected Outcomes:**
- HUD window appears in a corner of the screen when tracking starts.
- Shows a circular gauge (0–100%) indicating time spent in *camera* zone since session start.
- Shows a colored dot: green (*camera*), amber (*screen*), red (*away*).
- Window is draggable by the user and its position is persisted across sessions.
- Window does not intercept mouse clicks on other apps (click-through enabled on non-drag regions).

**Todo List:**
1. Create a new `BrowserWindow` in Electron main with:
   - `transparent: true`, `alwaysOnTop: true`, `frame: false`, `hasShadow: false`.
   - `setIgnoreMouseEvents(true, { forward: true })` for click-through; toggle off on drag handle hover.
2. Implement HUD renderer (`electron/src/renderer/hud/`):
   - React (or vanilla TS) component with circular SVG gauge.
   - Zone indicator dot with CSS transitions.
   - Session timer (elapsed time since `MEETING_STARTED`).
   - "Active presenter" badge — show/hide based on `SPEAKER_ACTIVE` / `SPEAKER_INACTIVE` state.
3. Respect tracking mode: if mode is `post-call`, hide the HUD window entirely during the call (tracker still runs silently); show it only for `real-time` or `both`.
4. Subscribe to `window.gazeTracker.onUpdate` and update gauge/dot on every event.
5. Persist window position in `electron-store` (JSON file in app data dir); restore on next launch.
6. Add a collapse/expand toggle so the presenter can minimize the HUD to a small dot during presentation.
7. Ensure HUD renders correctly at 1x and 2x DPI (Retina / HiDPI).

**Relevant Context:**
- Electron docs: `BrowserWindow.setIgnoreMouseEvents` for click-through.
- `electron-store` for lightweight persistent config.
- HUD should not appear in Teams screen-share capture — use `setContentProtection(true)` on the HUD window.

---

### Sub-Task 6 — Alert System

**Status:** [ ] pending

**Intent:**
Implement configurable real-time alerts that fire when the presenter has been looking away from the camera beyond a threshold, using both a visual screen flash and an audio cue.

**Expected Outcomes:**
- After N consecutive seconds in *screen* or *away* zone (configurable, default 5 s), a subtle red border flash appears on the HUD and a soft audio ping plays.
- Alert resets immediately when the presenter returns to *camera* zone.
- Threshold and alert style are user-configurable in a Settings panel.
- Alerts do not fire during the first 3 seconds of a session (grace period).

**Todo List:**
1. Implement `AlertEngine` in the main process:
   - Tracks cumulative off-camera time using a sliding window over `gaze:update` events.
   - Emits `alert:fire` IPC event when threshold is exceeded; emits `alert:reset` on camera return.
2. In the HUD renderer, subscribe to `alert:fire` / `alert:reset`:
   - `alert:fire`: add CSS class triggering a red pulsing border animation on the HUD container.
   - `alert:reset`: remove animation class.
3. Play alert sound using the Web Audio API (`AudioContext`) in the renderer — load a bundled soft ping WAV from `resources/sounds/`.
4. Build a Settings panel (accessible from the system-tray menu):
   - Slider: look-away threshold (1–30 seconds).
   - Toggle: enable/disable audio alert.
   - Toggle: enable/disable visual flash.
5. Persist settings in `electron-store`.
6. Write unit tests for `AlertEngine` state machine (mock gaze event stream).

**Relevant Context:**
- Security rule: audio files are bundled locally; no external network calls for alert assets.
- Use `app.getPath('userData')` for `electron-store` config location.

---

### Sub-Task 7 — Session Data Store

**Status:** [ ] pending

**Intent:**
Persist every session's gaze event timeline and aggregate statistics to a local SQLite database, preparing the data for both the in-app post-session report and cloud upload.

**Expected Outcomes:**
- SQLite database created at `app.getPath('userData')/sessions.db` on first run.
- Each gaze event (timestamp, zone, confidence) is written within 500 ms.
- Session record includes: session ID, meeting subject (from Graph), start time, end time, per-zone totals.
- Data access layer exposes typed async methods for reading/writing sessions.
- Database migrations are managed with `better-sqlite3` pragmas or a lightweight migrator.

**Todo List:**
1. Add `better-sqlite3` to `electron/` dependencies.
2. Define schema:
   - `sessions` table: `id`, `meeting_id`, `subject`, `started_at`, `ended_at`.
   - `gaze_events` table: `id`, `session_id`, `ts`, `zone`, `confidence`.
3. Implement `SessionRepository` class with methods:
   - `createSession(meetingMeta)` → `sessionId`
   - `insertGazeEvent(sessionId, event)`
   - `closeSession(sessionId)`
   - `getSessionSummary(sessionId)` → per-zone totals and percentages
   - `listSessions()` → array of session metadata
4. Wire `SessionRepository` into the main process: start session on `MEETING_STARTED`, batch-insert gaze events (flush every 1 second), close session on `MEETING_ENDED`.
5. Add a database migration strategy: store schema version in `PRAGMA user_version`; apply delta migrations on startup.
6. Write unit tests for `SessionRepository` using an in-memory SQLite database.

**Relevant Context:**
- `better-sqlite3` is synchronous but fast enough for 10 Hz writes; run on the main process, not the renderer.
- Security rule: SQLite file contains behavioral data — do not expose its path to the renderer directly; expose only via typed IPC methods.

---

### Sub-Task 8 — Cloud Dashboard Backend

**Status:** [ ] pending

**Intent:**
Build a lightweight REST API backend and a web dashboard so coaches and managers can view presenter gaze history across sessions.

**Expected Outcomes:**
- REST API (Node.js/Express or Fastify, deployed to Azure App Service) exposes:
  - `POST /api/sessions` — receives a session payload from the desktop app and stores it.
  - `GET /api/sessions?userId=...` — returns session list for a user.
  - `GET /api/sessions/:id` — returns full gaze event timeline for one session.
- Authentication: Azure AD / MSAL bearer token validated on every request.
- Database: Azure Database for PostgreSQL (or Azure CosmosDB for JSON flexibility).
- Web dashboard (React SPA, deployed to Azure Static Web Apps) shows:
  - Session list with date, duration, and camera-eye-contact %.
  - Timeline chart (Recharts) of gaze zones over session duration.
  - Trend chart: camera % across multiple sessions over time.
- Desktop app uploads session data to the backend after `MEETING_ENDED`.

**Todo List:**
1. Scaffold `backend/` as a Node.js (TypeScript) Fastify app with `@azure/identity` for token validation.
2. Define PostgreSQL schema mirroring the local SQLite schema (sessions + gaze_events tables).
3. Implement REST endpoints with input validation (Zod schemas).
4. Add Azure AD middleware: validate bearer token issuer, audience, and scopes on each request.
5. Create `SyncService` in Electron main process:
   - After session close, serialize session + events from SQLite.
   - `POST /api/sessions` with MSAL access token in `Authorization` header.
   - Retry on failure (exponential back-off, max 3 attempts); mark session as `synced` in local DB.
6. Scaffold `dashboard/` as a React + Vite SPA:
   - Login page using MSAL browser (`@azure/msal-browser`).
   - Session list page.
   - Session detail page with Recharts timeline + zone breakdown donut chart.
   - Trend page.
7. Configure `azure-static-web-apps` for the dashboard and Azure App Service for the backend.
8. Write API integration tests using `supertest`.

**Relevant Context:**
- Security rules: use TLS 1.2+ (enforced by Azure), store no credentials in code, validate tokens server-side.
- Bind backend service to a specific Azure App Service URL, not `0.0.0.0` directly in code.
- Use parameterized queries (never string interpolation) for all database operations.
- MSAL browser sample: https://github.com/AzureAD/microsoft-authentication-library-for-js/tree/dev/samples/msal-browser-samples

---

### Sub-Task 9 — Post-Session Report UI

**Status:** [ ] pending

**Intent:**
Show an in-app post-session report window immediately after a meeting ends, so the presenter gets instant feedback without opening a browser.

**Expected Outcomes:**
- A new Electron `BrowserWindow` opens automatically after `MEETING_ENDED`.
- Report shows: session duration, camera eye-contact % (large headline stat), per-zone donut chart, gaze timeline bar chart, and 2–3 actionable tips generated from the data.
- User can dismiss the window or export the report as a PDF.
- Report data is read from the local SQLite database via IPC.

**Todo List:**
1. Create `ReportWindow` in Electron main:
   - Open automatically after `closeSession` if tracking mode is `real-time` or `both`.
   - For `post-call` mode, open immediately after the call ends (this is the first time the user sees any feedback).
   - Passes `sessionId` as a URL param.
2. Implement `ReportRenderer` (`electron/src/renderer/report/`):
   - Fetch session summary and gaze timeline via `window.sessionStore.getSessionSummary(sessionId)` (preload-exposed IPC call).
   - Render headline stat, donut chart (Chart.js or Recharts embedded in renderer), and timeline bar chart.
   - Show which tracking mode was active during the session (badge in the header).
3. Implement tip generator: rule-based logic (e.g. "You spent 40% of the session reading scripts — try using bullet points instead").
4. Add "Export PDF" button using Electron's `webContents.printToPDF()`.
5. Add "View full history" link that opens the cloud dashboard URL in the default browser.
6. Write snapshot tests for the tip generator logic.

**Relevant Context:**
- `webContents.printToPDF` returns a Buffer; write to `app.getPath('downloads')`.
- Keep report window lightweight — load only the session summary, not all raw gaze events.

---

## Implementation Order

```
Sub-Task 1 (Scaffold)
    └─> Sub-Task 2 (Graph Auth + Meeting Detection)
    └─> Sub-Task 3 (Python Gaze Tracker)
            └─> Sub-Task 4 (IPC Bridge)
                    └─> Sub-Task 5 (HUD Overlay)
                    └─> Sub-Task 6 (Alert System)
                    └─> Sub-Task 7 (Session Data Store)
                            └─> Sub-Task 8 (Cloud Backend)
                            └─> Sub-Task 9 (Post-Session Report)
```

Sub-Tasks 5, 6, and 7 can proceed in parallel after Sub-Task 4 is complete.
Sub-Tasks 8 and 9 can proceed in parallel after Sub-Task 7 is complete.
