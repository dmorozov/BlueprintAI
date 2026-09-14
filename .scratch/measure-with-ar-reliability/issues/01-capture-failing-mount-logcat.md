# 01 — Capture a failing Measure-with-AR mount's logcat on the S22 Ultra

Type: task
Mode: HITL (the user moves the phone; the agent drives adb)
Status: resolved (2026-09-14)
Blocked by: —
Part of: ../map.md

## Question

What does ARCore / Viro actually log when *Measure with AR* comes up as a **dead session** on this phone — and which root-cause hypothesis does the signature support?

Protocol (repeat 3×, cold launch each time):
1. Build & install the current app (`npx expo run:android`), confirm ARCore versionName via `adb shell dumpsys package com.google.ar.core | grep versionName`.
2. `adb logcat -c`; open *Measure with AR*; user moves the phone slowly over a textured floor for ~20 s.
3. `adb logcat -d > logs/ar-dead-<n>.txt` (the `logs/` dir is gitignored). While the view is black: `adb shell dumpsys media.camera > logs/camera-<n>.txt`.
4. Grep: `ARCoreError|Failed to register sensor|CAM_IMU_DESYNC|clock offset|kNotTracking|VisualInertialState|CameraService|AR_ERROR|ArSession|AR session resumed|MissingGlContext|Viro|VRO|EGL|SurfaceTexture`.
5. Add a temporary `console.log` in `handleTrackingUpdated` (`ar-capture-screen.tsx`). virocore forces exactly **one** `onTrackingUpdated(UNAVAILABLE, NONE)` at scene creation and then only reports *changes*; seeing that one callback proves the JS bridge is alive and the session is paused / never tracking (H1/H2), while seeing none points at the bridge or GL surface (H4). Note also that virocore logs "AR session resumed" unconditionally — its presence proves nothing.

Resolution records: the exact error strings found (or their absence), whether the session was ever *resumed* successfully, whether another client held the camera, and which hypothesis the evidence supports — H1 (`Failed to register sensor to queue` — the #1762 resume failure, documented on Play Services for AR 1.54.x; whether 1.56 still has it is unknown), H2 (camera-to-IMU clock offset > 5 ms / VIO never stabilises — #1784/#1785, documented on 1.56 with the camera feed *visible* in hello_ar), H3 (camera busy after expo-camera), H4 (GL/EGL/camera texture never starts). Attach the log paths.

Also record from the user: when did Measure with AR last work on this phone, and was that before or after the ARCore update of 2026-08-29 / the 2026-08-05 security patch? (`adb shell dumpsys package com.google.ar.core | grep -i "install\|update"`.)

## Answer

**The dead session's signature is "no AR engine at all" (H0, ticket 00). None of H1–H4 is supported.** The strings this ticket treats as H1/H2 evidence also appear in every healthy session on this phone, so they are start-up noise, not failure signatures.

### How it was run

- **Setup:** ARCore `versionName=1.56.262080393` (`lastUpdateTime=2026-08-29 00:34:36`), security patch 2026-08-05.
  - The app is the installed dev build, not a fresh `npx expo run:android`. The APK was built 2026-09-13 19:21:08 and already includes the last native change (`65456c5`, expo-media-library permissions, present in the installed package). JS came from Metro.
- **Two arms, 3 cold launches each**, with identical temporary instrumentation: a mount marker and `console.log` in `handleTrackingUpdated`.
  - **dead:** the pre-fix screen from `5fb190e` (bare `<ViroARScene>`), served through Metro. Since ticket 00 the dead session no longer occurs on HEAD, so it had to be reproduced this way.
  - **live:** HEAD `139e44f` (navigator mounted), as the control.
- **Per run:** `logcat -c`, deep-link cold launch, then a 20 s window starting when the screen passed its support check. `dumpsys media.camera` and a screenshot at +10 s; full `logcat -v epoch` at the end. The phone was hand-held over carpet.
- The screen file was restored afterwards; no source changes remain.

### Results

| Run | Engine attach (`ViroAR : === onAttachedToWindow START ===`) | `Entering ArSession_create` | `Viro : AR session resumed` | Tracking callbacks | "Tracking good" | Camera clients at +10 s |
|---|---|---|---|---|---|---|
| dead-1…3 (pre-fix) | no | 0 | 0 | **0** | never; the stall card showed at 10 s over an empty white view | **none** (`Active Camera Clients: []`) |
| live-1 (HEAD) | yes | 1 | 1, +0.54 s | 2: `1` at +0.30 s, `3` | **1.54 s** after attach, then held for 20.5 s | camera 0: `com.anonymous.blueprintai` only |
| live-2 (HEAD) | yes | 1 | 1, +0.58 s | 2: `1` at +0.29 s, `3` | **1.55 s**, held for 20.8 s | same |
| live-3 (HEAD) | yes | 1 | 1, +0.53 s | 2: `1` at +0.30 s, `3` | **1.47 s**, held for 21.7 s | same |

- **The only Viro lines in the dead arm** are `ARCore availability check returned [SUPPORTED_INSTALLED]` and `=== JNI setAnchorDetectionTypes called ===`. These are the same two lines the original report took as proof of a clean mount.
- **The camera history shows no connect by any client** during the dead runs.

### Error strings

Counts are per run. The "working" column covers these 3 runs plus ticket 00's 12 logs.

| String (grep target → hypothesis) | dead | working | What it is |
|---|---|---|---|
| `Failed to register sensor to queue` (→ H1) | 0 | 0 | Absent everywhere. |
| `android_data_source.cc:816] [Live DS] Callback list for SENSOR_TYPE_ACCELEROMETER` / `SENSOR_TYPE_GYROSCOPE_UNCALIBRATED at ordinal 0 not found.` | 0 | every run | Same source file as #1762's line 1073, but a different error. It fires at +0.45–0.50 s, then **every 5.0 s** while tracking stays Normal. Benign. |
| `[FEATURE_DSP_CAM_IMU_DESYNC] Camera to IMU clock offset (5.33248475ms) exceeds threshold (5ms).` (→ H2) | 0 | 2 of 15 (ticket 00 cold-05, cold-09) | In cold-05 it came **0.86 s after** "Tracking good", and tracking stayed Normal. |
| `[VIO_OUTPUT_NOT_TRACKING]`, `VisualInertialState is kNotTracking. Wait.` ×4–5, `[FEATURE_DSP_RANSAC_INLIER_INSUFFICIENT]`, `[VIO_INITIALIZE_RETRY]` (cold-05), `Extended Kalman Filter Correction failed` (→ H2) | 0 | every run | VIO initialisation. All of it falls within the ~1.5 s before "Tracking good". |
| During steady tracking: `spherical_rectifier.cc … RET_CHECK failure` (motion-stereo depth) ×7–9, `[PoseManager] GetRecentDevicePose: Failed to query IMU integrated pose … Timestamp too old` ×4–7, live-2 `Too many image measurements. Skipping the rest` ×56 | 0 | every 20 s run | No tracking change. The depth line may matter for the Depth-API requirement; not investigated. |
| `ARCoreError`, `AR_ERROR_*`, `MissingGlContext`, `EGL_BAD_*`, `ERROR_CAMERA_IN_USE`, `onRendererFailed`, `FATAL EXCEPTION` (→ H3/H4) | 0 | 0 | Absent everywhere. |

### Verdict per hypothesis

- **H0 (no engine): supported.**
  - The dead arm has zero callbacks, no session and no camera client.
  - The JS bridge was demonstrably alive: the mount marker logged and Viro's prop setters ran.
- **H1: not supported.** `Failed to register sensor` never appears, and the session resumed in every working run.
- **H2: not supported as a failure.**
  - The desync and not-tracking lines occur in sessions that track.
  - Tracking never dropped from Normal within 20 s.
- **H3: not supported.** No client held the camera during the dead session. In working runs the app held camera 0 alone. Ticket 00's path 2 and path 4 runs also found no handoff failure.
- **H4: not supported.** There were no GL/EGL errors. The dead arm has no GL surface because no engine exists.

**Correction to step 5's decision rule.**
- **"None → H4" is wrong here:** zero callbacks with a live bridge means no engine (H0).
- **A single callback proves less than the rule assumes.** The forced `UNAVAILABLE` callback arrives 0.29–0.30 s after attach, before `AR session resumed` (0.53–0.58 s). It proves the navigator created the scene, and says nothing about whether the session resumed.

### From the user

- **Their answer**, when asked when Measure with AR last showed a camera: "it shows live camera all the time. the AR shows the camera". It was given on 2026-09-14 between 16:45 and 16:48, while the phone showed the post-fix screen: a Metro hot reload had remounted it, with the navigator attached and the session resumed at 16:45:14.
- **Git history:**
  - the AR screen first appears in `8fa640e` (2026-09-13)
  - no commit before `139e44f` mounts a navigator
  - the pre-fix screen drew no camera in 4 of 4 launches today

  So the camera the user sees is the fixed screen. The feature postdates the ARCore update (2026-08-29) and the security patch (2026-08-05), so neither can be correlated with it.
- **Unreconciled:** the original report's "intermittent" black view, and that it "sometimes" worked, don't fit a pre-fix screen that never draws a camera. They are left as is. On this phone the empty view is white, not black.

### Evidence

`logs/ticket-01/` (gitignored, 33 MB), named by arm rather than the ticket's flat `logs/ar-dead-<n>.txt`:
- **Dead arm:** `ar-dead-{1,2,3}.txt`, `camera-dead-{1,2,3}.txt`, `dead-{1,2,3}.png`
- **Live arm:** `ar-live-{1,2,3}.txt`, `camera-live-{1,2,3}.txt`, `live-{1,2,3}.png`
- **Pre-flight check:** `ar-sanity-prefix.txt` (pre-fix, 12 s, phone resting)
- **Scripts:** `scripts/` holds `ar-t01.sh` (one run), `ar-t01-all.sh` (both arms, restores the screen on exit) and the two traced screen copies

### Caveats

- **The dead session was reproduced, not caught.** It is the committed pre-fix code, served through Metro. No failure has been seen on HEAD (13 launches in ticket 00, 3 here).
- **Windows were 20 s.** Longer sessions, and tracking stability over a full room trace, are untested.
- **The run started on the user's reply about the live camera,** not an explicit "ready". The live screenshots show the phone over carpet. Motion during the dead runs is irrelevant, since no engine existed.

### Consequences for the map

- **Ticket 02** (hello_ar control) loses its decisive role, because Viro tracks on this phone. At most it becomes a Depth-API check. Re-scope or close it.
- **Tickets 04/05** have no H1/H2/H3 failure left to fix or bisect on this phone. Error surfacing is still open.
- **Any logcat-based diagnostics or error surfacer** (ticket 07's logcat-tailing option) must **not** key on `Callback list for SENSOR_TYPE_…`, `kNotTracking`, `VIO_OUTPUT_NOT_TRACKING` or `CAM_IMU_DESYNC`: all of them occur in healthy sessions.

None of this was done here.

## Comments
