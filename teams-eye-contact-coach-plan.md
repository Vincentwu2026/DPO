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

**Status:** [x] done (workspaces, electron-vite app, electron-builder config, Python package, ESLint/Prettier and Ruff/Black, `.gitignore` and README are in place; typecheck, lint and format checks pass. Windows packaging was not verified.)

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

**Status:** [x] done, except host-triggered start/stop (deferred, see below)

> **Deferred by decision:** the host `START_TRACKING` / `STOP_TRACKING` control (Expected Outcomes bullet 6, Todo item 7) is not wired in the desktop app. The relay and `MeetingService` can carry the messages, but nothing sends or acts on them. Tracking and the webcam run automatically for the whole call, from `MEETING_STARTED` to `MEETING_ENDED`. The active speaker is used to mark speaking time for the dashboard, not to gate tracking. Revisit once it can be tested against live Teams.

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

**Status:** [x] done (verified on Apple Silicon in a real Electron 45 window at 2x DPI: gauge, zone dot, timer, presenter badge, collapse/expand, drag with persisted position, click-through toggling. Windows, 1x DPI and screen-share exclusion by Teams were not verified; `setContentProtection` is applied but not tested against a real share.)

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

**Status:** [x] done (AlertEngine unit-tested; HUD pulse and alert:fire/alert:reset verified in Electron. Audio playback uses a bundled WAV via Web Audio but was not listened to or tested end to end.)

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

**Status:** [x] done (SQLite verified under the Electron 45 ABI and inside the packaged `.app`; events visible within ~265 ms. Closing on MEETING_ENDED/quit and orphan cleanup are wired but were not exercised against a live Teams call.)

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

**Status:** [x] done (backend API, desktop SyncService, dashboard SPA, and Azure deployment config are built; tests, type-check, lint and production build pass. The SPA pages were verified in headless Chrome against the real API with test data. Not verified against real Azure services: Entra sign-in/JWKS, Azure PostgreSQL, or the two deploy workflows.)

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

**Status:** [x] done (with the caveats below)

**What was built and checked:**
- `ReportWindow` opens after `MEETING_ENDED` in every tracking mode when at least 5 s were tracked. It does not open on sign-out or quit. The session id is held in main; the renderer cannot choose it, and every IPC handler rejects other senders.
- The renderer (`electron/src/renderer/report/`) shows duration, a headline camera %, a mode badge, a donut, a stacked timeline and up to three tips. It uses SVG and `textContent` only, under a strict CSP. The basis is speaking time when at least 10 s were spoken, otherwise the whole call, and the report says which.
- Tips are rule-based (`electron/src/shared/reportModel.ts`), with inline snapshot tests (16 tests). Calls under 30 s get a note instead of tips.
- Export PDF writes `eye-contact-report-<date>-<time>.pdf` (never the meeting title) to Downloads, mode 0600, never overwriting. "View full history" opens `DASHBOARD_URL` (https, or http on loopback) in the default browser and is hidden when unset.
- The timeline is bucketed from the session's events in main; raw events are not sent to the renderer.
- Deviation from the plan: the sessionId is not a URL parameter and the page does not call `window.sessionStore`. A dedicated `window.report` API is used so the page cannot ask for another session.

**Not verified:** the report window was never looked at in a running Electron app, PDF export was not run for real, and the history button was not clicked. A fake call did produce and save a session, but only unit tests and the build cover the report window itself.

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

### Addition — Personal Calibration (not in the original plan)

**Status:** [x] done (with the caveats below)

**Why:** On the developer's webcam the "looking at the camera" pose read about 17° of head turn away from the generic thresholds, so the default zones classified a camera look as "screen" (0% camera in a fake call).

**What was built:**
- Python tracker: a calibration mode that measures raw iris and head-pose values, and a pure fitting module (`python/gaze/calibration.py`) that derives personal thresholds and rejects poor fits with a reason.
- Electron main: `CalibrationStore` (validated on read), `CalibrationWindow` (top-centre, lens target, live mirrored preview, readings, guided lens and screen steps), and a tray item "Calibrate Eye Contact…". Saved thresholds are re-sent to the tracker after every spawn or restart.
- The preview is shown only in that window while it is open; frames are never saved.

**Not verified:** a saved calibration being applied by the tracker during a real call (unit tests with a mock tracker only), and the calibration quality on anyone other than the developer.

---

### Proposed Addition — Speech Coach (optional speech analysis in any live session)

**Status:** [-] SC-0 spike run on synthetic speech and a real mic; verdict **conditional**: engine and speed pass, size and echo do not yet. Two checks need a person (see SC-0 findings). Scope decisions are made (below).

**Goal:** In any live session, the user can switch on speech analysis. The app transcribes their speech on the device and scores how **confident** and how **conversational** they sounded. The result appears in the **conclusion of the report**, next to the eye-contact results, and is then discarded.

#### Decisions (from the product owner)

| # | Decision |
|---|---|
| D1 | **Any live session**, not only rehearsals. Speech analysis is an option the user turns on; it is off by default. |
| D2 | **Runs locally.** No audio or text leaves the computer, and there is no API key. |
| D3 | **No transcript.** Text is never shown, kept or exported. |
| D4 | **English only.** |
| D5 | **Shown in the report's conclusion.** Delivery scores sit with the tips at the end of the report. |
| D6 | **Nothing is stored.** Speech results exist only in memory while the report is open, and are not written to SQLite, not uploaded, and not in the PDF history. |

Interpretation to confirm: D6 is applied to the **speech results only**. Gaze sessions keep being stored and synced exactly as today. If "no storing" should cover the whole report, say so, because the report currently reads from the session database.

**Non-goals:** saving audio or text, judging what was said (accuracy, content), analysing other people, other languages, and any claim that the scores measure real confidence. They are coaching indicators built from visible rules.

#### How it works

```
Microphone -> speech side-process (VAD + on-device Whisper)
   | per phrase: {start, end, words[{w, start, end}]}
   v
Electron main: SpeechProcess -> SpeechAccumulator (counts only; the text is dropped at once)
   |
   | on Stop session: summary kept in memory under the session id
   v
Report window: Delivery section in the conclusion  ->  discarded when the report closes or the app quits
```

- **Text is discarded as it arrives.** The accumulator only keeps running tallies: word count, fillers, hedges, contractions, "you/your", questions, sentence lengths, pause lengths, and words per 15-second bucket. Because the words are never kept, D3 and D6 are structural rather than a setting. Leaving no transcript is also what allows a privacy statement that is short and true.
- **Side-process:** a second Python process built like the gaze tracker (own JSON-lines protocol, own PyInstaller bundle, same spawn and restart pattern as `TrackerProcess`). Audio stays in memory and is dropped after each phrase is transcribed.
- **Engine candidate:** `faster-whisper` `base.en`, int8 (about 75 MB), with voice-activity detection to split phrases, so results arrive 1 to 3 s after each phrase. Alternatives for Phase 0: `whisper.cpp`, and Vosk (smaller, keeps filler words better, less accurate).
- **Join with gaze:** phrases use the same epoch-second clock as gaze events. Only the per-bucket word counts are needed for reading detection, and they are computed from the gaze events already in the database.
- **Switching on and off:** a "Analyse my speech" switch next to Start/Stop in the main window, and a tray item. It can be switched on or off during a session. The report states how much of the session was analysed ("12 of 30 minutes") and is hidden if less than about 30 seconds of speech was captured.
- **Live view:** only a "Listening" indicator in the main window and tray (consent and clarity). No live scores in v1, since the user asked for results in the report.

#### Scoring (transparent rules, no black box)

Each score is a weighted sum of visible components. The report shows each component's value and the rule behind it.

| Signal | Measure | Feeds |
|---|---|---|
| Filler words | um, uh, "like", "you know", "basically" per minute | Confidence |
| Hedging | "I think", "maybe", "kind of", "just", "sorry", "I guess" per 100 words | Confidence |
| Pace | words per minute; healthy band about 130 to 170 | Both |
| Pauses | count of pauses over 2 s; variation in pace between phrases | Confidence |
| Sentence length | average words per sentence | Conversational |
| Contractions | "don't" vs "do not" | Conversational |
| Audience focus | "you / your" share and questions per minute | Conversational |
| Formality | long-word share and a readability grade | Conversational |
| **Reading detection** | high screen-gaze % **and** very even pace **and** almost no fillers | Conversational (flag: "sounded scripted") |

Reading detection is the strongest reason to build this in this app: no speech-only tool also has the gaze data.

Output: two 0 to 100 scores, up to three delivery tips in the style of `generateTips`, a pace-over-time strip, and a note on how much of the session was analysed.

#### Phases

| Phase | Work | Done when |
|---|---|---|
| **0. Spike** (1 to 2 days) | Benchmark engines on this Mac with the gaze tracker running: latency, CPU, accuracy on 5 recorded sessions, how many fillers are kept, bundle size. **Also test a real Teams call:** whether mic capture works alongside Teams, and how much of other people's audio from the speakers is picked up. | **Go/no-go:** under 3 s latency, the tracker still near real time, fillers mostly kept, added bundle at most about 150 MB, and echo manageable |
| **1. Speech process** | `python/speech/` with the protocol, mic selection, VAD, WAV fixtures, pytest | Phrases and word timings emitted for a WAV file and a live mic |
| **2. Scoring model** | `shared/speechModel.ts`: lexicons, `SpeechAccumulator`, scores and tips, with unit tests per rule and for edge cases (silence, very short, no words) | Pure functions, no I/O, tests pass |
| **3. Wiring** | `SpeechProcess` in main, the in-memory summary store keyed by session id, the switch (main window and tray), mic permission handling, "Listening" indicator, a mic device setting | Session with analysis on gives a summary at Stop; nothing written to disk |
| **4. Report** | Delivery section in the conclusion of the report (scores, component bars, tips, analysed-time note) and in the PDF export; hidden when there is not enough speech | Report shows both parts, and a restart shows no speech data |
| **5. Packaging and privacy** | `NSMicrophoneUsageDescription` and the `com.apple.security.device.audio-input` entitlement on macOS; rebuild the DMG; update the USER-GUIDE privacy section (today it only mentions video); bundle the model | Packaged app asks for the mic and works |
| **6. Optional later** | Volume and pitch variation (monotone check), other languages | Separate decision |

#### SC-0 findings (Apple M5 Pro, 24 GB; code in `teams-eye-contact-coach/spikes/speech/`)

Tested with four clips made by macOS `say` (fillers, clean, conversational, pauses), faster-whisper int8 on CPU, voice-activity filter on.

| Check | Result | Verdict |
|---|---|---|
| Speed (real-time factor, lower is faster) | `tiny.en` 0.02 to 0.04, `base.en` 0.03 to 0.05, `small.en` 0.08 to 0.14. A 15 s clip takes about 0.7 s with `base.en`. | Pass. A phrase is transcribed well under 3 s after it ends. |
| Accuracy (word error rate) | `base.en` 0.0 to 0.03, `tiny.en` 0.0 to 0.14, `small.en` 0.0 to 0.06 | `base.en` is the best fit |
| Gaze tracker alongside Whisper | Tracker CPU 38% alone, 23% with Whisper running; gaze events stayed at 30 per second in all three runs; system CPU rose from 13% to about 40% | Pass on this machine only |
| Pause detection | 3 of 3 long pauses found in the pauses clip, with `base.en` and `small.en` (`tiny.en` found 0) | Pass with `base.en` |
| Filler words kept | 7 of 7 with every model, with and without a priming prompt | **Not conclusive.** Synthetic speech says "um" clearly; real, quick fillers are the known weak spot. Needs a person (below). |
| Packaged size | PyInstaller bundle of the engine **178 MB** (onnxruntime 75 MB, av 43 MB, numpy 34 MB), plus the model: `tiny.en` 74 MB, `base.en` 141 MB, `small.en` 464 MB. The frozen binary loads and transcribes. | **Over budget.** `base.en` totals about 320 MB against the 150 MB goal, roughly doubling the 243 MB DMG. Possible cuts (not tried): drop `av` by passing arrays only, replace the onnxruntime VAD with a simple energy gate, use `tiny.en`. |
| Mic capture | Works from Python after the permission prompt; two inputs listed, the MacBook mic and a "Microsoft Teams Audio" virtual device | Pass |
| **Echo from speakers** | Speech played through the laptop speakers was transcribed from the mic **in full**, at 25% volume and at 50% volume | **Fail without a fix.** On speakers, other people's voices in a call would be scored as the user's. |

**Verdict: conditional go.** The engine is fast and accurate enough, but two things must be resolved before SC-1:
1. **Echo.** Options: require headphones for analysis (with a warning when the mic hears the call); use macOS voice processing, which echo-cancels (Teams does this), which means capturing the mic through a different API than the one tested; or limit analysis to rehearsals (D1 fallback). A real-call test decides which is viable.
2. **Size.** Pick a model and trim the bundle, or accept a larger installer.

**Still needs a person (not done):**
- *Real fillers:* run `spikes/speech/.venv/bin/python user_mic_test.py` and talk naturally for 40 s. Compare the fillers heard with the ones you counted. Nothing is saved.
- *Real Teams call:* with the mic on in a Teams call, check whether the app can also read the mic, and whether the other side's voice leaks in on speakers vs headphones.

#### Risks

- **Echo in live calls (new with D1).** On speakers, the other participants' voices can be transcribed as the user's, which would corrupt every score. Phase 0 measures it. Mitigations: a "use headphones" hint, a level gate so only the near-field voice counts, and a warning if the mic hears sustained audio at the same time as the Teams output. If it cannot be made reliable, fall back to D1 = rehearsal only.
- **Mic sharing with Teams.** macOS normally allows two apps to read the mic, but this must be proven on a real call, not assumed.
- **Whisper tends to drop "um" and "uh".** That under-counts fillers, the signal sellers most want. Phase 0 measures it. Mitigations: a priming prompt that contains fillers, or Vosk.
- **Score validity.** There is no ground truth for "confident". Tune the weights on 10 to 20 labelled sessions, and label the output as coaching indicators.
- **CPU load.** MediaPipe plus Whisper together may slow gaze tracking on older machines. Phase 0 checks this.
- **Installer size.** The DMG is 243 MB today; expect roughly 100 to 250 MB more.
- **Consent.** The switch is off by default, the permission prompt is explicit, and the "Listening" indicator is always visible while on. Recording a call that includes other people may need their awareness under your organisation's policy, even though nothing is kept.

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
