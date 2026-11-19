# Tester setup (no Azure needed)

This is how to run Teams Eye Contact Coach from source and use it beside Microsoft Teams. You do
**not** need an Azure app registration or any admin access. You start and stop each session
yourself from the tray (menu bar) icon.

## What you need

- macOS (tested on Apple Silicon). Windows has not been tested.
- A webcam.
- [Node.js](https://nodejs.org) 20.19 or newer (22 LTS recommended). Check with `node -v`.
- Python 3.11 or newer. Check with `python3 --version`.
- Git.

## Install

```bash
git clone https://github.com/Vincentwu2026/DPO.git
cd DPO/teams-eye-contact-coach

# JavaScript dependencies
npm install

# Python environment for the gaze tracker
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r python/requirements-dev.txt

# Download the face model (about 4 MB, checked against a SHA-256 hash)
npm run fetch:model
```

If `python3 --version` shows something older than 3.11, install a newer Python first (for example
`brew install python@3.13`) and create the environment with that one, e.g. `python3.13 -m venv .venv`.

## Start the app

```bash
cd DPO/teams-eye-contact-coach
npm run dev
```

- A small status window opens, and an icon appears in the menu bar (top right on macOS).
- The first time, macOS asks for **camera access**. Choose Allow. If you missed it, open
  _System Settings > Privacy & Security > Camera_ and enable the terminal app you started it from
  (Terminal, iTerm, VS Code), then restart the app.
- Leave the terminal window open. Closing it stops the app. To quit properly, use **Quit** in the
  menu bar icon.

There is no sign-in. The app does not connect to Microsoft or Teams; you start and stop each session
yourself.

## Calibrate once (recommended)

1. Click the menu bar icon, then **Calibrate Eye Contact…**.
2. Step 1: look at the camera **lens** itself (the dot above the screen), not at your face on the
   screen.
3. Step 2: look at the middle of the screen. Keep your head fairly still and move your eyes.
4. If it says the result is good, save it. If not, follow what it says and try again.

Without calibration the app uses generic limits that suit some faces and cameras better than
others. If your eye-contact percentage looks too low even when you are looking at the lens,
calibrate.

## Use it in a Teams call

1. Join your Teams call as normal.
2. Click the menu bar icon, then **Start Session**. The webcam turns on and a small HUD appears at
   the top right with your eye-contact percentage.
3. Look at the camera when you speak. If you look away for about 5 seconds you get an alert.
4. When the call ends, click the menu bar icon, then **Stop Session**. A report opens with your
   percentage, a timeline and some tips. You can export it as a PDF.

Notes for this manual mode:

- You must click Start and Stop yourself. Nothing detects the call automatically.
- The "Active presenter" badge and speaking-time numbers need the Teams connection, so they stay
  empty. All gaze counts as "not speaking".
- Sessions are stored only on your computer. Video frames are processed in memory and never saved.

## Update to a newer version

```bash
cd DPO && git pull
cd teams-eye-contact-coach
npm install
source .venv/bin/activate
pip install -r python/requirements-dev.txt
npm run dev
```

## Where your data lives

In `~/Library/Application Support/@teams-eye-contact-coach/electron/`:

| File               | Contents                                  |
| ------------------ | ----------------------------------------- |
| `calibration.json` | Your calibrated thresholds (numbers only) |
| `settings.json`    | Tracking mode, camera and alert settings  |
| `sessions.db`      | Your sessions (zone and time, no images)  |

Delete a file to reset it. **Use default settings** in the app also removes the calibration.

## Troubleshooting

| Problem                                            | What to do                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `npm install` fails on `keytar` or a native module | Install Xcode command line tools: `xcode-select --install`, then run `npm install` again.   |
| `No module named mediapipe` or Python errors       | Activate the environment (`source .venv/bin/activate`) and re-run the `pip install` line.   |
| Model file missing                                 | Run `npm run fetch:model`.                                                                  |
| No camera, or the wrong camera                     | Allow camera access (see above). In **Settings…** set **Camera** to the one you want.       |
| Eye-contact percentage is very low                 | Calibrate (see above), looking at the lens in step 1. Sit where you normally sit for calls. |
| Electron crashes with `reading 'whenReady'`        | Run `unset ELECTRON_RUN_AS_NODE` in your shell and start again.                             |
| Camera light stays on after Stop Session           | Quit the app from the menu bar icon.                                                        |

When reporting a problem, include your macOS version, `node -v`, `python --version` (inside the
environment), and the last lines of the terminal output. Do not include screenshots of your camera
or any personal data.
