# Teams Eye Contact Coach: User Guide

Teams Eye Contact Coach helps you look at the camera while you present in Microsoft Teams. While
you are in a call it watches your gaze through your webcam, shows a small live indicator, nudges you
when you look away for too long, and keeps a history you can review later.

> **Status.** This guide describes what the app does today. The Teams call detection has not yet
> been tested against live Teams, and some planned features are not connected (see
> [What is not available yet](#what-is-not-available-yet) and [Known limits](#known-limits)).

## Contents

- [How it works in one minute](#how-it-works-in-one-minute)
- [Your privacy](#your-privacy)
- [Before you start](#before-you-start)
- [First-time setup](#first-time-setup)
- [Using it in a Teams meeting](#using-it-in-a-teams-meeting)
- [Reading the HUD](#reading-the-hud)
- [Calibrating to your setup](#calibrating-to-your-setup)
- [Settings](#settings)
- [After the call: your report](#after-the-call-your-report)
- [Reviewing your history](#reviewing-your-history)
- [What is not available yet](#what-is-not-available-yet)
- [Troubleshooting](#troubleshooting)
- [Known limits](#known-limits)

## How it works in one minute

1. The app lives in your **system tray** (Windows) or **menu bar** (macOS). Sign in once with your
   work Microsoft 365 account.
2. When you join a Teams call, the app notices (it checks your Teams presence every 15 seconds),
   switches on your webcam and starts tracking where you are looking.
3. A small **HUD** appears in the top-right corner of your screen showing your eye-contact
   percentage and whether you are looking at the camera, the screen, or away.
4. If you look away from the camera for too long, the HUD flashes red and plays a soft ping.
5. When you leave the call the webcam turns off, the session is saved and a **report** window
   opens with your results. If your organisation has set up the cloud dashboard, the session is also
   uploaded so you can see trends over time.

## Your privacy

- **Video never leaves your computer.** Webcam frames are analysed in memory and thrown away. They
  are never saved, recorded or sent anywhere.
- **Only your own gaze is tracked**, on your own machine. The app does not watch other
  participants.
- **The HUD is hidden from screen sharing**, so people in the meeting will not see it.
- **What is stored on your computer:** a log of your gaze zone (camera, screen or away) over time
  for each call, plus the meeting subject.
- **What is uploaded to the dashboard (only if set up):** just the time you were the **active
  speaker**, as short runs of "zone, start, duration", plus the date, tracking mode and meeting
  subject. Time spent listening is never uploaded.
- **Who can see the uploaded data:** only you. The dashboard identifies you from your Microsoft
  sign-in, and nobody else can open your sessions through it.

## Before you start

You need:

- Windows 10/11 (64-bit) or macOS (Apple Silicon or Intel)
- A webcam
- A Microsoft 365 work account that uses Microsoft Teams
- The app installed and configured by your IT or project team (see below)

The app has to be configured with your organisation's Microsoft Entra app registration and relay
service, so most people will receive a ready-made installer. If you are the person setting it up,
follow the developer instructions in the [README](../README.md) (the variables are listed in
`electron/.env.example`).

## First-time setup

1. **Install and start the app.** An icon appears in the system tray (Windows, bottom-right) or the
   menu bar (macOS, top-right). A small status window also opens. It shows whether you are
   signed in, whether you have calibrated, and what to do next. You can close it, and the app keeps
   running from the tray; choose **Open Eye Contact Coach** in the tray menu to bring it back.
2. **Allow camera access.** On macOS, approve the camera prompt the first time tracking starts. If
   you missed it, go to _System Settings > Privacy & Security > Camera_ and enable the app.
3. **Sign in.** Click the tray icon and choose **Sign In**. Your browser opens the Microsoft
   sign-in page. Approve the permissions requested (presence, online meetings, call records, and
   access to the dashboard service if it is enabled).
4. **Choose your tracking mode and camera.** Click the tray icon, then **Settings…** (see
   [Settings](#settings)). In particular, leave **Camera** on **Automatic** to use the camera
   Teams uses, or pick one yourself.
5. **Check it works.** Join or start a Teams call, and within about 15 seconds the HUD should
   appear (unless you chose Post-call mode).

After the first sign-in the app signs you in automatically each time it starts.

## Using it in a Teams meeting

You do not need to press anything during a meeting. The app starts and stops by itself.

**When you join a call.** Within roughly 15 seconds of Teams showing you as "In a call", the app
turns on your webcam, starts tracking, and (in Real-time or Both mode) shows the HUD.

**While you are in the call.** The HUD updates continuously. When you are the active speaker in
Teams, an **Active presenter** badge appears (this is checked every 5 seconds, so it can lag a
little behind). You can drag the HUD anywhere, collapse it to a dot, or mute its sound.

**When you leave the call.** Within roughly 15 seconds the webcam turns off, the HUD disappears and
the session is saved. If the dashboard is set up, the session uploads in the background. If the
upload fails, the app retries and tries again the next time it starts or you sign in.

**Tray menu.** Click the tray icon at any time to:

| Item          | What it does                                  |
| ------------- | --------------------------------------------- |
| Sign In / Out | Sign in, or sign out (shows your name)        |
| Tracking Mode | Switch between Real-time, Post-call and Both  |
| Settings…     | Open the settings panel                       |
| Quit          | Stop the app (an open session is saved first) |

### Tracking modes

| Mode          | During the call                        | Use it when                                      |
| ------------- | -------------------------------------- | ------------------------------------------------ |
| **Real-time** | HUD and alerts are shown               | You want live coaching                           |
| **Post-call** | Nothing is shown; tracking is silent   | You do not want any distraction while presenting |
| **Both**      | HUD and alerts are shown (the default) | You want live coaching and a record afterwards   |

In every mode the call is recorded and saved. Post-call mode only hides the live HUD and alerts. A
mode change takes effect straight away, even in the middle of a call.

## Reading the HUD

The HUD is a small floating panel. It stays on top of other windows, never takes keyboard focus,
and mouse clicks pass through it to the window underneath, except on its drag grip and buttons.

| Element              | Meaning                                                                          |
| -------------------- | -------------------------------------------------------------------------------- |
| **Ring and number**  | The share of tracked time you have spent looking at the camera so far, 0 to 100% |
| **Coloured dot**     | **Green** = camera, **amber** = screen, **red** = away                           |
| **Timer**            | How long the call has been running                                               |
| **Active presenter** | Shown while Teams says you are the active speaker                                |
| **Hint line**        | A short coaching message (below)                                                 |
| **Speaker icon**     | Mutes the alert sound for the rest of this call only                             |
| **Minus button**     | Collapses the HUD to a small dot; click the dot to expand it again               |
| **Grip (top edge)**  | Drag to move the HUD. Its position and collapsed state are remembered            |

**Zones.** _Camera_ means you are looking at the camera lens. _Screen_ means you are looking down or
to the side, for example at slides or notes. _Away_ means your face is turned away or not visible.

**Hint messages**

| Message                | When                                                      |
| ---------------------- | --------------------------------------------------------- |
| Waiting for camera     | Tracking has not produced a reading yet                   |
| Good eye contact       | You are looking at the camera                             |
| Eyes on screen         | A short glance at the screen (calm, no action needed)     |
| Face the camera        | Your head is turned away                                  |
| Look at the camera     | You have been off camera for about 2 seconds (amber glow) |
| Look at the camera now | The look-away alert has fired (red)                       |

### The look-away alert

If you stay off camera longer than your threshold (**5 seconds** by default), the alert fires: the
HUD border pulses red and a soft ping plays. It clears the moment you look back at the camera.
Alerts are held back for the first 3 seconds of a call. You can change the threshold and turn the
sound or the flash off in Settings.

## Calibrating to your setup

The app starts with generic settings. Cameras sit at different heights and every face is different,
so for the best accuracy run the calibration once (and again if you change camera or monitor):

1. Click the tray icon and choose **Calibrate Eye Contact…**. A window opens at the top centre of
   your screen with a glowing **lens target** and a live picture of you. Make sure you are well lit
   and your face is fully in view.
2. Click **Start**. After a 3 second countdown, **look straight at your camera lens** (the target at
   the top shows where it is) until the bar fills.
3. After a second countdown, **look at the middle of your screen**, where you normally watch the
   other people on a call, until the bar fills.
4. The app tells you how well it worked. If it looks good, click **Save and close**. If not, it says
   what to change (for example "look at the lens for the whole countdown"). Click **Try again**.

The numbers under the picture (iris position, head turn, head tilt and the detected zone) are live
readings, handy for seeing what the app sees. To go back to the generic settings, open the window
and click **Use default settings**.

The picture is shown only in this window, only while it is open. It is not saved or sent anywhere.
The calibration uses your webcam even when you are not in a call and turns it off when you close the
window.

## Settings

Open **Settings…** from the tray menu. Change what you like and click **Save** (this also closes
the panel). **Close** closes it without saving.

| Setting                             | Options                                 | Default   | Notes                                                                                                                                          |
| ----------------------------------- | --------------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tracking mode**                   | Real-time, Post-call, Both              | Both      | See [Tracking modes](#tracking-modes)                                                                                                          |
| **Camera**                          | Automatic, or a webcam on your computer | Automatic | Automatic follows the camera Teams uses (camera 0 if that cannot be read). A camera you pick always wins. Switches without restarting tracking |
| **Look-away alert** (seconds)       | 1 to 30                                 | 5         | How long you can look away before the alert fires                                                                                              |
| **Audio alert**                     | On / off                                | On        | The ping                                                                                                                                       |
| **Visual alert**                    | On / off                                | On        | The red pulsing border                                                                                                                         |
| **Show "look at the camera" hints** | On / off                                | On        | The hint line on the HUD                                                                                                                       |
| **Gaze steadiness**                 | Responsive, Balanced, Steady            | Balanced  | How much the zone is smoothed (below)                                                                                                          |

**Gaze steadiness.** Raw gaze readings jitter. _Responsive_ reacts fastest but the dot may flicker.
_Steady_ barely flickers but is slower to notice a real look-away. _Balanced_ is a good starting
point. On one test recording the dot changed about 2.3 times a second with no smoothing, 0.3 with
Balanced and 0.07 with Steady.

## After the call: your report

When a call ends, a **report** window opens by itself (in every tracking mode) as long as at least a
few seconds were tracked. It shows:

- how long the call was and which tracking mode was used,
- your **camera eye-contact percentage**, taken from the time you were speaking when there was
  enough of it, otherwise from the whole call (the report says which),
- a donut chart of time on camera, on screen and away,
- a timeline of how your gaze changed across the call, and
- up to three short tips, such as "You spent 40% of your speaking time looking at your screen. If
  you are reading, try short bullet points, or put your notes next to the camera". Calls shorter
  than 30 seconds get a note instead of tips.

Buttons: **Export PDF** saves the report to your Downloads folder, named with the date and time
(never the meeting title), and shows it in the folder. **View full history** opens the cloud
dashboard in your browser; it only appears if your organisation has set the dashboard address.
**Close** closes the report. Leaving the app or signing out does not pop a report up.

## Reviewing your history

Every call is saved on your computer. If your organisation has set up the cloud dashboard, it is
also uploaded, and you can review it in a web browser.

1. Open the dashboard address your team gave you, and **sign in** with the same work account.
2. **Sessions** lists your calls: date, meeting subject, how long you spoke, and your camera
   eye-contact percentage while speaking. Calls where you did not speak show a dash.
3. **Click a session** to see:
   - the headline percentage of your speaking time spent on camera,
   - a donut chart of time on camera, on screen and away, and
   - a stacked timeline chart showing how your gaze changed across the call.
4. **Trend** plots your camera percentage across your recent sessions and shows the change from your
   first sessions to your latest, for example "+34 pts".

The dashboard only counts the time **you were the active speaker**. Eye contact while listening is
not part of those numbers.

## What is not available yet

- **Host start/stop control.** A meeting host cannot start or stop tracking for everyone. This
  was deferred on purpose. Tracking starts automatically whenever Teams shows you in a call and
  stops when the call ends.
- **Starting only when you speak.** Tracking and the webcam run for the whole call. Only the
  dashboard upload is limited to the time you were speaking.

## Troubleshooting

| Problem                                         | What to try                                                                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The HUD does not appear when I join a call      | Check you are signed in (tray menu shows "Sign Out (your name)"). Check the mode is not **Post-call**. Wait up to 15 seconds.                                                              |
| The HUD never appears even after waiting        | Meeting detection needs the relay service and permissions set up by your admin. Ask them to check.                                                                                         |
| "Waiting for camera" stays on the HUD           | Open Settings and choose the right camera. On macOS check camera permission in System Settings.                                                                                            |
| The HUD shows the wrong camera's view           | Check that **Camera** in Settings is **Automatic**, or choose the right camera yourself. Automatic reads the camera from Teams' own settings and uses camera 0 if it cannot.               |
| The calibration says my look was not steady     | Keep your eyes on the lens for the whole countdown, with your face well lit and in view, then **Try again**.                                                                               |
| The calibration says lens and screen look alike | Sit a little closer, or look at the lower part of your screen for step 2. A camera far above the screen separates the two looks best.                                                      |
| The dot flickers between zones                  | Set **Gaze steadiness** to Steady.                                                                                                                                                         |
| It says "look at the camera" while I am looking | Run **Calibrate Eye Contact…** from the tray menu. Also try Steady, and check your face is well lit.                                                                                       |
| The alert sound is annoying                     | Click the speaker icon on the HUD to mute it for this call, or switch off **Audio alert** in Settings.                                                                                     |
| I cannot see the HUD in my screen share         | That is by design; the HUD is hidden from screen sharing.                                                                                                                                  |
| The HUD is in the way                           | Drag it by the top grip, or collapse it to a dot.                                                                                                                                          |
| My sessions are missing from the dashboard      | The upload may not be configured, may still be retrying, or you were not speaking. Sign out and in again to trigger a retry. Sessions recorded before cloud sync existed are not uploaded. |
| Tracker could not start                         | Quit and restart the app. If it persists, report it to your admin.                                                                                                                         |
| Active presenter badge is late or missing       | It is checked every 5 seconds, and depends on a Teams setting your admin controls.                                                                                                         |

## Known limits

- **Not yet tested against live Teams.** Call detection, the active-speaker badge and the relay
  service have been built and unit-tested, but not run against a real Teams call. Expect rough
  edges at first.
- **Windows is untested.** The app has been developed and checked on macOS (Apple Silicon).
- **Zone accuracy depends on your setup.** The default thresholds that decide "camera", "screen" and
  "away" are generic. Run the calibration for your camera and face. Accuracy still depends on
  camera position, lighting and glasses, and the calibration has been tried on one person and one
  laptop camera only.
- **Timing is approximate.** Joining and leaving are detected up to about 15 seconds late, and the
  active speaker up to about 5 seconds late.
- **Dashboard sign-in is not yet verified against real Microsoft services.** The pages themselves
  have been checked with test data.

## Getting help

Contact the team that provided the app. When you report a problem, say which operating system you
use, which tracking mode was on, and what the HUD showed. Please do not send screenshots that
include meeting content.
