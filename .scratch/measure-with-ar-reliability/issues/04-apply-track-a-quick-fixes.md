# 04 — Apply the Track A quick fixes inside the Viro stack and re-test

Type: task
Mode: AFK build, HITL test (user moves the phone)
Status: resolved (2026-09-23)
Blocked by: 01, 02, 03, 07
Part of: ../map.md

## Question

With the quick fixes that the experiments and ticket 07's recipes justify applied — and **nothing else changed** — does the current Viro-based AR engine pass the acceptance bar on the S22U?

Candidate fixes (apply the ones the evidence supports, on a branch):
- **#1762 sensor workaround**: `android.permission.HIGH_SAMPLING_RATE_SENSORS` in the manifest (config plugin) + no-op `SensorEventListener`s registered on `TYPE_GYROSCOPE_UNCALIBRATED` / `TYPE_ACCELEROMETER_UNCALIBRATED` *before* Viro creates its ARCore session (placement per ticket 07).
- **Camera-release guard**: ensure `expo-camera` is fully unmounted and the device camera free before `ViroARScene` mounts (verify with `dumpsys media.camera`; add a wait/verify step rather than a blind delay).
- **Error surfacing**: wire whatever Viro exposes (`onError`, tracking-reason props) so a failure shows a reason instead of a black view.
- **ARCore client swap** (only if ticket 07 recommends it): replace the *whole* `arcore_client` AAR with stock `com.google.ar:core:1.56.0` **and** strip the renderer AAR's bundled 1.51 `libarcore_sdk_c.so` — the 1.56 native shim calls into 1.56's `classes.jar` (`useProjectedApk`), so a lib-only swap cannot work. Delivered under CNG (`android/` is gitignored) by the mechanism ticket 07 picks. Verify in logcat that ARCore reports `SDK build name: 1.56`.

Test protocol: the acceptance bar — 10 consecutive cold launches, ≤ 5 s to "Tracking good" while moving over a textured floor; background→foreground; the ticket 03 paths. Record pass counts and logcat excerpts.

Resolution records: which fixes were applied (files/branch), pass/fail per criterion, and the remaining failure signature if any. Feeds ticket 12 (Track A outcome).

## Answer

**The Viro engine, with the camera-release guard and error surfacing applied, passes the acceptance bar on the S22U (2026-09-22/23).** The limits are listed under criterion 4. No failure signature remains on this phone.

### What was applied (working tree on `ticket-01-dead-session-logcat`, uncommitted; needs a new dev build)

- **`modules/ar-session-guard/`: a new local Expo module, Android only.** It is autolinked from `./modules`, with no `app.json` change. iOS and web get `null` through `requireOptionalNativeModule`. It provides:
  - `awaitBackCameraAvailable(timeoutMs)`: a `CameraManager.AvailabilityCallback` on the primary back camera, which resolves when that camera is free or the timeout passes. It never rejects.
  - `startLogWatch(filter)` / `stopLogWatch()`: runs `logcat --pid=<self> -T <now>` in the app process, with `ReactNativeJS` silenced, and forwards the lines matching `filter` as `onArLog`.
  - A `packageName` constant.
- **`src/lib/ar-diagnostics.ts`: a new file, with 16 tests.** It holds only deterministic signatures:
  - Start-up milestones: `=== onAttachedToWindow START ===`, `ARCore installed on device`, `Selected camera config`, `AR session resumed`.
  - Viro's `onRendererFailed [error: X], message [Y]`. The real line has a space after `error:`, which ticket 08 found in the class file. Each `StartupError` gets its own message.
  - #1762's `Failed to register sensor to queue`.
  - Another app's back-camera client, from `CameraManagerGlobal: Camera N facing CAMERA_FACING_BACK state now … for client <pkg>`.
  - From these it builds the stall reason (by how far start-up got, and from Viro's tracking reason), the tracking-lost reason (naming the camera holder), and the tracking-limited advice.
- **`src/screens/ar-capture-screen.tsx`:**
  - **Camera gate:** each engine (first entry, Restart AR, photo step → Next room) mounts only after the camera wait, capped at 3 s.
  - **Log watch** for the screen's lifetime.
  - **Stall rule fixed.** The 10 s timer now stops once the engine has tracked. Before, it fired even while tracking was Normal, and Viro's forced "unavailable" at mount counted as proof of life.
  - **Labels:** "Starting AR…" instead of "Tracking lost" until the first real tracking, and "AR didn't start" plus the reason for a dead engine. The stale "some Android 16 devices / #499" copy is gone.
- **Not applied:**
  - **The #1762 sensor hold and `HIGH_SAMPLING_RATE_SENSORS`.** No evidence on this phone. `Failed to register sensor` never appeared in any run (tickets 01–04). `dumpsys sensorservice` shows every registration by the app's UID today returning `result=OK`: 21 each for gyroscope-uncalibrated and accelerometer-uncalibrated (ARCore's), none refused from any UID. So the debuggable-build `PERMISSION_DENIED` path (ticket 07) does not occur here.
  - **The ARCore client swap.** A no-op for H1–H3 (ticket 07).

### Results against the bar

**1. Ten consecutive cold launches: pass, 10/10.**
- Engine attach → "Tracking good": 1.29–3.60 s (median 1.54 s).
- Tap → "Tracking good": 2.47–4.10 s, except cold-04 at 7.82 s. On that run the JS screen mounted 2.55 s after the tap instead of about 1.1 s (skipped-frame warnings). ARCore then tracked 2.33 s after resume.
- The camera wait resolved in 11–48 ms, with the camera free every time. 0 evictions.

**2. Background → foreground: pass, 3/3.**
- Home for 5 s, then back: same navigator, no remount.
- "AR session resumed" came 0.35–0.44 s after the return, and "Tracking good" 1.04–1.24 s after the resume (ticket 00: 0.99 s).

**3. Camera paths: pass, 6/6.**

| Path | Camera wait | Hand-off | Engine attach → tracking |
|---|---|---|---|
| Capture → Back → AR (×2) | 26–29 ms (already free) | ARCore connect 0.56–0.66 s after expo-camera's release | 1.24–1.30 s |
| Photo assist → Back → AR (×2) | 24 ms (already free) | 0.58–0.61 s after release | 1.25–1.30 s |
| Reference photos → Next room (×2) | **1.31–1.38 s** | expo-camera releases 1.45–1.51 s after the tap; ARCore connects 0.32–0.37 s after the release; **0 evictions** (ticket 03: 3/3) | 1.18–1.29 s |

On Next room the guard costs about 0.6–0.8 s: "Tracking good" came 2.70–2.87 s after the tap, against 1.86–2.24 s with eviction in ticket 03.

**4. Failures surface a human-readable reason: pass for every class exercised on the device.** Each setting was restored the same session; `phone-state-before.txt` and `phone-state-after.txt` match.

| Induced failure | What happened | What the app shows |
|---|---|---|
| Camera permission revoked, "Don't allow" | Android's dialog, before any engine exists | The existing "denied" phase: "Camera permission is required for AR measurement…" (8.2 s after the tap, i.e. right after the user's choice) |
| Camera access off in Quick Settings (×2) | "Unblock camera?" pauses AR; after Cancel the camera streams blank frames, and 2.6 s after resume Viro reports (unavailable, reason 4 = insufficient light) | At 10 s: "AR didn't start" / "The camera image is dark or blank. Turn on a light, check that the lens is not covered and that camera access is not turned off in Quick Settings, then tap Restart AR." Re-enabling access recovers the **same** session: "Tracking good" 0.91 s later, with no restart |
| Samsung Camera (floating pop-up, holding logical camera 20) open when AR starts | The camera wait times out (3.05–3.09 s, `available=false`). The engine mounts anyway, and CameraService evicts Samsung Camera because the app has focus | Normal start; tracking comes 1.8 s after ARCore connects |
| The pop-up takes focus mid-session | Samsung Camera evicts ARCore, and Viro reports "unavailable" | "The camera is in use by another app (com.sec.android.app.camera). Tap this screen or close that app; AR resumes by itself." After refocus ARCore retakes the camera on its next retry (+3.5 s) and tracks (+5.5 s), with no restart |
| Google Play Services for AR disabled (`pm disable-user`) | **Not a failure:** `checkAvailability` still returns `SUPPORTED_INSTALLED`, and Dynamite loads the native library from the disabled package. AR tracked | "Tracking good" |

- **Camera shown before tracking (ticket 08's owed check):** aimed at a plain surface, a screenshot 0.68 s after "AR session resumed" and 0.42 s before "Tracking good" shows the live camera image. Viro does not render black while waiting.

**Limits of criterion 4:**
- **ARCore missing, outdated or declined:** the messages are unit-tested against the byte-verified log format, but not seen on the device. Disabling the package doesn't simulate absence; a real downgrade would.
- **Only a virocore rebuild can report** ARCore's exact status for a failed create, a non-sensor resume failure, or a mid-session update failure (ticket 08). The tail reports those as "how far start-up got". The 10 s stall is the catch-all, so a black view is never silent after 10 s.
- **The camera-holder name comes only from a state change.** The camera wait's registration logs only `STATUS_NOT_AVAILABLE`, not the client. Its first run therefore named the holder only after the eviction.

### Caveats

- **Build and log format:**
  - Debuggable dev build only. Reading the app's own log from a release build is unverified (ticket 07 cites AOSP for it).
  - The `CameraManagerGlobal` state lines are observed on this Samsung / Android 16 build. Others may not log them; nothing breaks without them.
  - The signatures are Viro 2.58.1 log strings, which are fragile across upgrades (the missed space showed that). Re-check them with any Viro bump.
- **Which code ran:** Metro ran with `CI=1` for most of the session, which switches off file watching. So each Metro served the code as of its own start:
  - **Cold launches:** the first version (gate, watcher, first stall rule).
  - **bg→fg, camera paths and the first privacy run:** the version with the stall and regex fixes.
  - **Final privacy run and the second pop-up run:** the final code. The only difference from what's on disk is the removed temporary `[ar-trace]` log.
  - None of the changes after the cold launches touch a healthy start.
- **Two runs per camera path; one to two per failure.** Metric scale (ticket 02's gap) was not checked.
- **The APK was built for arm64-v8a only** (`-PreactNativeArchitectures=arm64-v8a`). The previous APK is backed up in `logs/ticket-04/app-debug-2026-09-13.apk`.

### Consequences for the map

- **Ticket 12:**
  - Criteria 1–3 pass.
  - Criterion 4 passes for install/permission, blocked camera, camera taken by another app, #1762, and the stall catch-all. Exact ARCore statuses for create/resume/update need the fork (ticket 08, about 3–4.5 days).
  - So the Track B question becomes: is Viro plus the tail enough for the spec, or are exact statuses, owning the seam, or depth requirements worth a fork or ticket 13's owned module?
- **The standing decision "guarantee expo-camera release before AR mounts now" is implemented** by the camera gate, which removes path 4's eviction at about +0.7 s. A 3 s cap keeps a camera held by another app from blocking AR.
- **Ticket 06 (upstream):**
  - The Viro-side findings are what's useful for viro#499: Viro drops `ArStatus`; `onRendererFailed` is only logged; `CAMERA_UNAVAILABLE` tracking is collapsed to "unavailable, none".
  - The ARCore threads #1762/#1784 don't apply to this phone: no sensor failure, and sensor registrations return OK.

**Evidence:** `logs/ticket-04/` (gitignored, 313 MB):
- per run: `cold-01..10`, `smoke`, `bgfg-1..3` (`stale-bundle/` holds the first bg/fg attempt, whose timing was misread), `p{2,3,4}-run{1,2}`, `b-blank-wall`, `f1-privacy{,-final}`, `f2-permission`, `f3-arcore-disabled`, `f4-popup{,-final}`, each with logcat, `dumpsys media.camera` and screenshots;
- `sensorservice-during-ar.txt` and `phone-state-{before,after}.txt`;
- `build.log`, and `metro-1.log` / `metro-2.log` / `metro.log`;
- `scripts/handoff.sh`, `scripts/bgfg.sh` and `scripts/failcase.sh`.

## Comments
