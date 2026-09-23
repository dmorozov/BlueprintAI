# 03 — Camera-handoff matrix: does expo-camera use before AR correlate with dead sessions?

Type: task
Mode: HITL (user moves the phone)
Status: resolved (2026-09-22)
Blocked by: —
Part of: ../map.md

## Question

Hypothesis H3: the app mounts `expo-camera`'s `CameraView` on three screens (Capture, Photo assist, and the reference-photo step inside the AR screen); a late camera release could make ARCore's session fail with `AR_ERROR_CAMERA_NOT_AVAILABLE`, which Viro swallows. Does the navigation path before *Measure with AR* change the outcome?

Run each path twice, cold launch, with `adb logcat` capture and `adb shell dumpsys media.camera` taken (a) just before opening AR and (b) while the view is black:
1. Cold launch → *Measure with AR* directly.
2. → *Sample plan from photos (testing)* (Capture screen, expo-camera live) → back → *Measure with AR*.
3. → *Measure with photos* (if configured) → back → *Measure with AR*.
4. In AR: finish a room → *Reference photos* → *Next room* (AR remounts after expo-camera).

Also measure **time-to-release**: ARCore may hold the camera for several seconds after pause; expo-camera releases on unmount. Timestamp `CameraService` connect/disconnect lines in logcat around each transition (AR unmount → CameraView mount, CameraView unmount → AR mount).

Resolution records, per path: dead / tracking, the measured release latencies, and whether `dumpsys media.camera` showed another client holding the camera when AR mounted. If paths 2–4 fail while path 1 tracks, H3 is confirmed and ticket 04's camera-release guard is the primary fix; if path 1 also fails, H3 is at most secondary.

## Answer

**H3 is not supported: every path tracked, 8/8 runs (2026-09-22).** Visiting the Capture or Photo assist screen before AR, or taking reference photos between rooms, changes nothing on this phone. No other package ever held the camera. On path 4, however, ARCore opens the camera **before** expo-camera has released it, and CameraService evicts expo-camera's client. That works here without a visible error, but it means the handoff relies on eviction, not on an orderly release.

### How it was run

- **Setup:**
  - The 2026-09-13 debug APK, with JS from Metro at the working tree: `139e44f` plus the uncommitted photo-step fix. Path 4 depends on that fix.
  - ARCore 1.56.262080393.
  - The phone was hand-held over a tiled floor.
- **Instrumentation:** a temporary `[ar-trace]` log of the screen state (phase, tracking, stalled, attempt), removed afterwards.
- **Per run:**
  - Force-stop, then a cold launch from the launcher.
  - The script navigates by tapping the home-screen buttons, not by deep links.
  - `dumpsys media.camera` is saved three times: on the expo-camera screen, **(a)** in parallel with the tap that opens AR, and **(b)** 5 s after it.
  - Full `logcat -v epoch`.
- **Paths 2/3:** 8 s on the camera screen, then Back, then "Measure room with AR" 0.80–0.85 s after Back. That is quick for a person, but not the fastest possible.
- **Path 3:** Metro was started with a dummy `EXPO_PUBLIC_PHOTO_ASSIST_URL=http://127.0.0.1:9`. That only reveals the "Measure with photos" button. The screen's camera works as normal, and the upload was never exercised.
- **Path 4:** tracking → 3 corner taps → Finish room → Reference photos (about 9 s) → Next room.

### Results

Times are in seconds. "Release" is expo-camera's `CameraService: disconnect … for PID <app>`. "ARCore connect" is the first `CameraService::connect call` after `ViroAR : === onAttachedToWindow START ===`.

| Run | Result | Camera clients at (a), AR open | expo-camera release | ARCore connect | Attach → "Tracking good" |
|---|---|---|---|---|---|
| p1-run1 (direct) | tracking | none | — | 0.75 after attach | 2.45 |
| p1-run2 | tracking | none | — | 0.52 after attach | 1.46 |
| p2-run1 (Capture → Back) | tracking | app (expo-camera) | 1.50 after Back | 0.54 after release | 1.33 |
| p2-run2 | tracking | app (expo-camera) | 1.43 after Back | 0.54 after release | 1.30 |
| p3-run1 (Photo assist → Back) | tracking | app (expo-camera) | 1.41 after Back | 0.56 after release | 1.75 |
| p3-run2 | tracking | app (expo-camera) | 1.44 after Back | 0.52 after release | 1.74 |
| p4-run1 (Reference photos → Next room) | tracking | app (expo-camera) | **evicted**: 0.26 after ARCore's connect | 0.67 after Next room, **before** release | 1.57 |
| p4-run2 | tracking | app (expo-camera) | **evicted**: 0.21 after ARCore's connect | 0.97 after Next room, **before** release | 1.78 |

- **At (b), 5 s after AR opened,** every run showed exactly one client: camera 0, the app's own PID, which by then is ARCore.
- **Who held the camera at (a).** `dumpsys` can't tell expo-camera and ARCore apart, because both are the app's PID and package. So the (a) rows are attributed from each snapshot's own events log: its latest entry is expo-camera's CONNECT, with no later DISCONNECT.
- **The other direction (AR → expo-camera, path 4's Reference photos tap):**

  | Run | Navigator detach | ARCore release | expo-camera connect |
  |---|---|---|---|
  | p4-run1 | 0.18 after the tap | 0.40 after detach | 0.27 after that |
  | p4-run2 | 0.25 after the tap | 0.34 after detach | 0.30 after that |

  There was no overlap in either run.
- **The eviction signature on path 4:**
  - `CameraService::connect evicting conflicting client for camera ID 0`
  - then CameraX `GRAPH_ERROR(cameraError=CameraError(ERROR_CAMERA_DISCONNECTED), willAttemptRetry=false)`
  - then the evicted client's disconnect.

  The `CameraView` is already unmounted by then. There was no JS error, no `onMountError`, no exception, and no effect on tracking.
- **The same eviction is in ticket 00's path 4 log** (`logs/ticket-00/path4.logcat.txt`, 0.96 s after Next room). Ticket 00 described it as "a same-app camera client disconnected 0.38 s after ARCore connected". So path 4 has evicted in 3/3 runs.
- **Ticket 00's path 2 run** (release 1.38 s after Back, "Tracking good" 1.77 s after attach) matches this table.
- **Error strings:** 0 for `CAMERA_NOT_AVAILABLE`, `CameraAccessException`, `ERROR_CAMERA_IN_USE` and `FATAL EXCEPTION`, in all runs.

**Why path 4 evicts and paths 2/3 don't.** On paths 2/3, expo-camera's release lands 1.41–1.50 s after Back. ARCore's open lands about 2.0 s after Back (the 0.8 s gap, plus about 1.2 s for the AR screen to mount and the session to open), so it comes after the release. On Next room, one render unmounts the `CameraView` and mounts the navigator, so ARCore opens after 0.7–1.0 s, before the release.

**Consequence:** a user who taps "Measure room with AR" within about 0.5 s of Back would most likely hit the same eviction on paths 2/3. That was not tested.

### Against the ticket's rule

- **Neither branch applies.** Path 1 tracked, and so did paths 2–4, so H3 is not supported on this phone.
- **The expo-camera → ARCore handoff works here in both forms:** an orderly release on paths 2/3, and an eviction on path 4.
- **The acceptance-bar item "survives visiting Capture / Photo assist before AR" passes on this phone:**
  - Capture: 3/3 (2 here plus ticket 00)
  - Photo assist: 2/2
  - Reference photos → Next room: 3/3

### Caveats

- **The eviction is CameraService policy, not app behaviour.** A new client from the same process displaces the older one (ticket 07). This phone's Android 16 build honours it; other OEM builds are unverified.
- **Viro discards `ArStatus`.** If an eviction ever went the other way, the app could not report it (acceptance-bar item 4, still open).
- **No Back-then-immediately-AR run (under 0.5 s).**
- **Two runs per path.** Each run lasted about 5 s after AR opened, so long-session stability was not observed.
- **Photo assist's upload path was never reached** (dummy URL).

### Consequences for the map

- **Ticket 04, camera-release guard:** there is no failure for it to fix on this phone.
  - What remains is a hardening choice for path 4, which currently relies on eviction.
  - Option (a): keep eviction.
  - Option (b): wait for expo-camera's release before mounting the navigator, verified from the `CameraView` unmount rather than a blind delay. This costs about 0.5–0.7 s on Next room.
  - The standing decision "guarantee expo-camera release before AR mounts now" should be confirmed or dropped in 04/12 with this evidence.
- **Ticket 04's other candidates:**
  - The #1762 sensor hold has no evidence left on this phone (tickets 01, 02).
  - The ARCore client swap is a no-op for H1–H3 (ticket 07).
  - That leaves **error surfacing** as the only open acceptance-bar item.
- **Ticket 04 is now unblocked:** 01, 02, 03 and 07 are all resolved.
- **Ticket 16:** under an owned engine, `captureFrame()` removes this handoff entirely. Under Viro, the choice is (a) or (b) above.

**Evidence:** `logs/ticket-03/` (gitignored, 72 MB):
- per run: `p{1..4}-run{1,2}.logcat.txt`, `.camera-{during,a,b}.txt`, `-camera-screen.png` and `-ar.png`
- the script: `scripts/handoff.sh`
- `metro.log`, and `stayon-before.txt` (the phone's screen-timeout setting, restored to `0` afterwards)

None of the map changes above were done here.

## Comments
