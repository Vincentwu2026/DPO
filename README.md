# Teams Eye Contact Coach

A desktop app that tells you how often you look at the camera during a Microsoft Teams call.
Start a session, join your call, and a small overlay shows your eye-contact percentage live. When
the call ends you get a report with a timeline and a few tips.

Everything runs on your computer. The webcam feed is analysed in memory and is never saved or
sent anywhere. Only the result (which zone you looked at, and when) is stored, in a local file.

## How it works

1. The app sits in your menu bar (macOS) or system tray (Windows).
2. When your Teams call starts, you click **Start Session**. The webcam turns on.
3. A face-tracking model ([MediaPipe](https://ai.google.dev/edge/mediapipe)) finds your eyes and
   head direction in each frame. The app decides whether you are looking at the **camera**, at the
   **screen**, or **away**.
4. A small overlay (HUD) shows the percentage, and warns you if you look away for too long.
5. When the call ends you click **Stop Session** and a report opens.

There is no Microsoft sign-in and no Azure setup. The app does not connect to Teams. You start and
stop each session yourself.

## Get the app

There is no installer to download yet. You run it from source, which takes about five minutes.

**You need:** a Mac with a webcam (Windows is untested), [Node.js](https://nodejs.org) 20.19 or
newer, Python 3.11 or newer, and Git.

```bash
git clone https://github.com/Vincentwu2026/DPO.git
cd DPO/teams-eye-contact-coach

npm install
python3 -m venv .venv
source .venv/bin/activate
pip install -r python/requirements-dev.txt
npm run fetch:model

npm run dev
```

Allow camera access when macOS asks. Then follow the full guide:
**[Tester setup](teams-eye-contact-coach/docs/TESTER-SETUP.md)**. It covers calibration, using it in
a call, updating, and fixing common problems.

To update later, run `git pull` in the `DPO` folder and repeat the `npm install` and `pip install`
steps.

## Documents

| Document                                                     | For                           |
| ------------------------------------------------------------ | ----------------------------- |
| [Tester setup](teams-eye-contact-coach/docs/TESTER-SETUP.md) | Installing and trying the app |
| [User guide](teams-eye-contact-coach/docs/USER-GUIDE.md)     | Everyday use and settings     |
| [Developer README](teams-eye-contact-coach/README.md)        | Code layout, tests, packaging |

## Known limits

- Tested on Apple Silicon Macs only.
- Results depend on your camera position and lighting. Run **Calibrate Eye Contact…** once.
- Speaking-time numbers and automatic call detection are not available without Microsoft Graph
  access, so they are off in this setup.
