# Implementation progress — Measure with AR reliability

Spec: `docs/specs/measure-with-ar-reliability.md` (Implementation Steps 1–6, device test plan rows 1–9).
All six spec steps are done. Steps 1–5 and the resume fix are committed (steps 4 and 5 in `fd9e347`). Step 6 needed no code change: its results and the spec update are **uncommitted** (see "Step 6" below).

## Where things stand

| Spec step | State |
|---|---|
| 1. Seam types and pure logic | **Done, committed** (`6bbe482 step 1`) |
| 2. `ViroArEngineView` | **Done, committed** (`6cddb3f`); device smoke passed 2026-10-17 |
| 3. Tracking frames | **Done with step 2, committed** (`6cddb3f`); plan row 8 passed |
| 4. Corner placement + tracking-loss rules | **Done, committed** (`fd9e347`); device: `facesUp` checked and fixed, plan rows 6 and 7 passed 2026-10-17 |
| 5. Viro 3.0.3 | **Done, committed** (`fd9e347`); plan rows 1–6 passed on the S22U 2026-11-07 (row 6 at 4 ft; see below) |
| 6. Release-build check | **Done** 2026-11-07: the app reads its own log in a release build, so no code change. Results and the spec's risk line are uncommitted |

**Ticket 06** is closed without posting (2026-11-07): the user keeps the work local. The drafts in `upstream/` stay for reference.

## Step 2 (committed in `6cddb3f`)

All checks pass: `npm test` (103 tests), `npm run lint`, `npm run typecheck`, `npx prettier --check src CONTEXT.md`.

- **New `src/components/viro-ar-engine-view.tsx`.**
  - `ViroArEngineView`, the Viro implementation of the seam. It owns the camera wait (3 s cap), the log watch with `ar-diagnostics`, the 10 s dead-session timer, Viro's forced "unavailable" at mount, the navigator, scene and 3 cm markers, the dp→px conversion, and `hitTest` → `ArTap`.
  - `viroArReadiness()`: ARCore support, then the camera permission.
- **`src/screens/ar-capture-screen.tsx` no longer imports Viro.** It renders `ArEngineStatus` (badge, guidance card, bottom-bar text, Restart AR chip) and hit-tests through the engine ref. It uses `preferredHit` for corners and openings until step 4, and saves rooms under the engine's `onFrameStart` id. About 1,400 → 1,170 lines.
- **`src/lib/ar-engine.ts`:**
  - `ArReadiness`;
  - `starting` now carries `waitingForCamera` (keeps the "Waiting for the camera…" message);
  - `preferredHit` (a plane, else the nearest hit), which `placeCorner` now uses.
- **`src/lib/viro-engine-status.ts`:** new `cameraFree` input.
- **`src/lib/viro-interop.ts`:** `toArHit` (Viro hit → seam hit: plane in extent → `plane`, feature/depth → `point`, unbounded extensions dropped, `facesUp` when pitch and roll are under 15°). `pickViroHit` is removed.
- **`src/lib/ar-diagnostics.ts`:** `resetEngineDiagnostics` is removed (no caller left).

**Deviations from the spec, for the user's review before committing:**
- **Step 3 folded into step 2.** Taking the frame id from `onFrameStart` was about 5 lines, and it fixes the Restart AR merge bug.
- **The waiting flag** on the `starting` status was added to the agreed interface.
- **Limited tracking no longer shows the centre guidance card.** The card is for unusable states only (starting / lost / dead); before, limited showed "Tracking lost — …". The badge still says "Tracking limited — advice".
- **Trade-off:** the name of an app holding the camera is no longer remembered across Restart AR, because each engine session starts its log watch fresh. Within a session it works as in ticket 04.
- **`toArHit`'s `facesUp` rule is provisional.** Step 4 checks it against hit rotations recorded on the phone.

## Step 2 device smoke test: results (2026-10-17)

S22U `R5CTA2PB2ZX`, debug dev client over Metro, Play Services for AR 1.57.262640093 (unchanged). Logs, screenshots and scripts are in `logs/step-2/`: `session.logcat.txt` is the whole session; `scripts/` holds `cold.sh`, `bgfg.sh`, `room.sh`, `row8-part1.sh`, `restart-room2.sh`, `permission.sh`, `phone-state.sh` and `timeline.js`. The runs used two temporary log lines, `[ar-trace]` (screen status) and `[ar-hit]` (Viro's raw hit types), both removed afterwards. Checks re-run green after the removal.

| Plan row | Result |
|---|---|
| 1, ×3 (the spec's 10× is for step 5) | **Pass 3/3.** "Tracking good" 2.90 / 3.04 / 3.24 s after the tap. Only `starting` was shown before it. |
| 2, ×3 | **Pass 3/3.** Same engine session: 0 remounts and the same frame id. "Tracking good" again 1.53–2.83 s after returning. |
| 8 | **Pass.** Room A was saved under `ar-mvdalq8m-rlkk3i`. After Restart AR, room B was saved under `ar-mvdapdr9-62fdyf`. The combined blueprint lists "Room 1 — needs alignment" (`row8-combined.png`). |
| 4, permission part | **Pass.** Revoke, then the user taps "Don't allow": "Camera permission is required for AR measurement. Allow it in system settings, then reopen this screen." Restored with `pm grant`, `clear-permission-flags … user-fixed` and `set-permission-flags … user-set`. The camera-off-in-Quick-Settings and app-holding-the-camera parts of row 4 were not in this smoke test. |

The phone state before and after matches, apart from the header timestamp.

**Observations for the user's review (none blocks the commit):**
- **About 1 s of "Tracking lost" after returning from Home.** On each resume Viro reports `unavailable`. The engine had already tracked, so the status was `lost`, and the guidance card showed "Tracking lost — move the phone slowly, or tap Restart AR below." for 0.8–0.9 s before "Tracking good". **Fixed, see the next section.**
- **A flash of `waitingForCamera` at every mount.** `cameraFree` starts false, so the status shows `waitingForCamera: true` for about 30–40 ms until `awaitBackCameraAvailable` resolves. The badge stays "Starting AR…"; only the centre card's text flips for a frame or two.
- **A young session held still has nothing to hit.** After a cold start with the phone held still, the first 4 taps (3–16 s after "Tracking good") got `raw=[]` from Viro, which shows the "No surface detected" toast. Feature-point hits started about 19 s in. After Restart AR with the phone moving, the first tap (about 3 s in) hit `ExistingPlaneUsingExtent`. `raw=[]` means this is not caused by `toArHit` dropping `EstimatedHorizontalPlane`; none was seen in any tap. This is worth considering for step 4's guidance.
- **Hit types seen on the phone:** `ExistingPlaneUsingExtent` and `FeaturePoint` only.

**Test-harness notes:**
- While tracking was `lost`, uiautomator twice failed to find the Restart AR chip by its content-desc, so it was tapped by its coordinates. It was found normally a few seconds later.
- A first row 8 attempt was discarded: the screen was left (a back tap between runs) and re-entered, which gives a new frame without Restart AR.

## Fix: no "Tracking lost" flash after Home (committed in `c4fb1a2`)

- **`viroEngineStatus`** takes a new `resuming` input. While it is set, a session that has tracked is `starting` (not `lost`, and not Viro's stale pre-pause `tracking`). A logged failure still wins: the status is `dead`.
- **`ViroArEngineView`** keeps `resume: 'none' | 'paused' | 'resuming'`:
  - AppState `background` → `paused`;
  - `active` → `resuming`;
  - Viro's first limited or normal report in the foreground → `none`;
  - `RESUME_TIMEOUT_MS` (5 s) after the return → `none`, so a resume that never tracks falls back to `lost` with its reason.
  - iOS's `inactive` is ignored: ARKit keeps running through it.
- **`ArEngineStatus.starting`'s doc** now covers "back from the background, not tracking again yet".
- **Tests:** 3 new cases in `viro-engine-status.test.ts` (106 total). Lint, typecheck and prettier are clean.
- **Device check (2026-10-17, temporary `[ar-trace]` line, since removed):**
  - **Row 2, ×3:** `tracking` → `starting` 0.2 s after Home → "Tracking good" 1.52–1.57 s after returning. Never `lost`; same session and frame (`logs/step-2/bgfg-*`). The runs before the fix are in `logs/step-2/before-resume-fix/`.
  - **Fallback (camera covered, Home 3 s, back):** `starting` until 5.5 s after the return, then "Tracking lost — too dark, turn on a light, or tap Restart AR below.", then "Tracking good" after uncovering. Same frame (`logs/step-2/bgfg-covered.logcat.txt`).
  - The phone state matches the baseline again.
- **For step 4:** the background trip now shows as `starting` (from Home until tracking returns), not as `lost`. So the long-loss warning (≥ 3 s) should count any non-tracking status after the session has tracked, `starting` included. Otherwise a Home trip mid-trace never warns.

## Step 4 (committed in `fd9e347`)

All checks pass: `npm test` (117 tests), `npm run lint`, `npm run typecheck`, `npx prettier --check src CONTEXT.md`. The temporary `[ar-hit]`, `[ar-corner]` and `[ar-trace]` lines used on the phone are removed.

- **`ArCaptureSession` holds the room's floor height** (`src/lib/ar-capture.ts`).
  - New `tapCorner(tap, quality)` places a corner with `placeCorner` and records it. It returns `{ok: true, clearedOpenings}` or the refusal (`no-hit` / `floor-shifted`). A refused tap records nothing.
  - Clear and Undo keep the floor height. A new room is a new session: the screen creates one at Next room, Restart AR and photo step → Next room.
  - `addCorner(world, quality)` stays for the tests that build rooms from plain positions.
- **`TrackingLossWatch`** (`src/lib/ar-engine.ts`), one per engine session.
  - The screen replaces it when the engine reports a new frame.
  - `update(status, nowMs)` returns true when tracking returns after an interruption of 3 s or more.
  - Once the session has tracked, every status but tracking counts: lost, starting again (the Home trip) and dead. The start-up doesn't count; limited tracking counts as tracking.
- **The screen** (`src/screens/ar-capture-screen.tsx`):
  - Corner taps go through `tapCorner`. Openings keep `preferredHit`.
  - **Floor-shift refusal:** an Alert, "The floor moved": "Tracking was interrupted and the floor is no longer at this room's floor height, so the corner was not placed. Restart the room to trace it again." Buttons: Keep tracing / Restart room.
  - **Long-loss prompt:** an Alert, "Tracking was interrupted": "Earlier corners may be off. Keep them, or restart this room?" Buttons: Keep / Restart room. It shows only mid-trace (phase `ready`, at least one corner).
  - **"Restart room" is Restart AR** (`restartAr`, also used by photo step → Next room). It remounts the engine, so the redone room gets a new frame and isn't merged with rooms traced before the interruption.
  - A tap whose hit test is still running when the trace restarts is dropped.
- **`toArHit`'s `facesUp` rule is replaced** (`src/lib/viro-interop.ts`).
  - Viro's rotation is Euler degrees, applied X, then Y, then Z, with the middle angle kept within ±90°. So a floor reads (0, y, 0) or **(180, y, ±180)**, depending on which way the camera faces. The old pitch-and-roll check missed the second form.
  - The new rule: the pose's normal (its Y axis) is within 15° of straight up: `cos x·cos z + sin x·sin y·sin z > cos 15°`.
  - The axis order was read off wall hits: under the other order, normals on one wall pointed in different directions.
  - The test uses rotations recorded on the phone.
- **Tests:**
  - the ticket-19 taps moved to `src/lib/__tests__/ticket-19-taps.ts`, shared by two suites, plus `FLOOR_BEFORE_GHOST`, the tap that locked the floor before `GHOST_FLOOR`;
  - 5 `ArCaptureSession` cases (the floor height kept across Clear, as ticket 19's try 3, and across Undo; the shift refusal; no hit; cleared openings);
  - 6 `TrackingLossWatch` cases;
  - the device-recorded `facesUp` case.

**Decisions made with the user (2026-10-17):**
- A Home trip mid-trace counts toward the 3 s warning: the time away plus about 1.5 s for tracking to return.
- **Open gap, left for later:** a long loss with no trace in progress (after Finish room, or right after Next room) gives no warning. The next room is still saved in the same frame and merged with earlier rooms as if aligned. A suggested fix: after such a loss, give later rooms a new frame id.

**Code review (two axes): applied**
- `handlePhotoNextRoom` reuses `restartAr`.
- The in-flight tap race is fixed.
- `CornerTapResult` reuses `CornerPlacement`'s refusal type.
- Test helpers and names are tidied.
- The `ar-engine.ts` header names the screen rules.
- The watch's doc avoids "tracking lost" (CONTEXT.md).
- The refusal wording no longer mentions "the others" when there are no corners.

**Code review: not applied (judgement calls):**
- The two Alert button lists aren't shared.
- The prompt uses `useEffect` + `useEffectEvent`, not a status callback.
- `ar-capture.ts` ↔ `ar-engine.ts` import each other, one way type-only.
- Some loss-watch timings are round numbers, not device values.
- **After "The floor moved" → Keep tracing,** a tap with no floor-plane hit is still placed at the old floor height. Per the spec, only a visible shift is refused.

## Step 4 device check: results (2026-10-17)

S22U `R5CTA2PB2ZX`, debug dev client over Metro, Play Services for AR 1.57.262640093 (unchanged). Logs are in `logs/step-4/` (`session.logcat.txt`, `metro.log`, `phone-state-*.txt`), and scripts in `logs/step-4/scripts/` (`taps.js` summarises taps and statuses, `open-ar.sh`, `phone-state.sh`). The phone state before and after matches.

- **`facesUp` check.**
  - Wall hits: 6 taps, 2 planes. All report a first angle near 90° → not up. ✓
  - Floor planes facing the start direction: (0, −20…−28, 0) → up. ✓
  - After turning: (0, −81.7, 0) and **(180, −87.2, −180)** / (180, −89.6, −180). The old rule called the second form "not up". ✗ Fixed (above).
  - The (180, y, 180) form also showed up in the tape run, on taps 2 and 4.
- **Plan row 6: pass, 4/4** (3 needed). A 3 ft (0.9144 m) tape, 1–2 m away, Clear between tries: 0.928 / 0.919 / 0.906 / 0.914 m = +1.5 / +0.5 / −0.9 / 0.0%.
- **Plan row 7: pass** (frames `ar-mvdcfwsz-auo1mt`, `ar-mvdcccfp-mcqylj`).
  - **Face down for 7 s, with 2 corners:** lost, then tracking back → "Tracking was interrupted". Keep → the next tap on the tape start landed 6 mm from corner 1.
  - **Home for about 9 s, with 3 corners:** starting, then tracking back → the prompt. Restart room → new frame, "Tracking good" 3 s later.
  - **Floor-shift refusal:**
    - In an earlier frame, the phone was face down twice before any corner was traced, so no prompt, as designed.
    - The room then locked its floor at −1.115 m. 3 s after corner 2, a tap hit a floor plane at −1.216 m (10.1 cm off) → "The floor moved" → Restart room.
    - That is ticket 19's stale-plane signature again.
- **Observation: a tap can answer the prompt by accident.** On the first row 7 attempt, the prompt opened just as the user tapped the tape. The tap hit the dialog's Keep button 1.5 s later, and the user never saw the prompt.
  - It's harmless when the tap hits Keep. A tap on Restart room would throw the trace away.
  - Options: leave it; or ask in the bottom bar, away from the AR view, and refuse corner taps until it's answered. **Needs the user's decision.**
- **Harness note:** the first Home attempt was really a tap on the in-app back arrow (the phone uses the 3-button bar), so the screen remounted three times. It was rerun with the middle (Home) button.

## Step 5 (committed in `fd9e347`)

- **Done (2026-10-17):**
  - `pnpm add -E @reactvision/react-viro@3.0.3`: `package.json` pins `"3.0.3"`, and `pnpm-lock.yaml` is updated.
  - The only peer warning (`@react-native/metro-config` 0.87.1 vs 0.86.3) predates the upgrade. There is one React (19.2.3).
  - Typecheck, lint and the 117 tests pass against 3.0.3's types.
- **Checked offline against the 3.0.3 package** (unpacked in the session scratchpad):
  - The JS APIs the app uses are unchanged: `performARHitTestWithPoint`, `getCameraOrientationAsync`, `onTrackingUpdated`, `displayPointCloud`, `provider`, `depthEnabled`.
  - New in 3.0: `toneMappingEnabled` on the scene (on by default; it may change the marker colour slightly).
  - The `arcore_client` and `gvr_common` folders are byte-identical, so ARCore is unchanged.
  - Viro's Java hit-result classes (`ARHitTestResult`, `ARUtils`) are byte-identical, so the `facesUp` rotation format should hold. The tape run re-checks it.
  - The five log strings the app parses are identical in the native libraries: `=== onAttachedToWindow START ===`, `ARCore installed on device`, `Selected camera config %d: CPU image %dx%d (status=%d)`, `AR session resumed`, `onRendererFailed [error: `.
  - The config plugin now resolves Viro's Android folder by its real path. Its other changes are Quest-only. The plugin's Gradle dependencies and minSdk 24 are unchanged.
  - `android/` was **not** re-prebuilt: `settings.gradle` reaches Viro through the `node_modules` symlink, and `gradle.properties` has hand edits that `prebuild --clean` would lose.
- **Dev client:**
  - Rebuilt with `./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a` (`logs/step-5/build.log`).
  - The APK's `libviro_renderer.so` matches 3.0.3's.
  - It was installed on the S22U with `adb install -r`; a copy is at `logs/step-5/app-debug-viro-3.0.3.apk`. `logs/step-5/phone-state-before.txt` was recorded before the install.
- **Scripts:** `logs/step-5/scripts/`:
  - `cold.sh` (row 1), `bgfg.sh` (row 2), `handoff.sh` (row 3, paths 2–4), `permission.sh`, `qs.sh` and `holder.sh` (row 4);
  - `open-ar.sh`; `wall.js` (row 5, the plane fit); `taps.js` (row 6); `phone-state.sh`.
  - The temporary `[ar-hit]`, `[ar-corner]`, `[ar-opening]` and `[ar-trace]` lines used for the run are removed. The checks are green again: 117 tests, typecheck, lint, prettier.

## Step 5 device run: results (2026-11-07)

S22U `R5CTA2PB2ZX`, debug dev client with Viro 3.0.3 (installed 2026-10-17). Play Services for AR is **1.57.262640293**; it was 1.57.262640093 on 2026-10-17.

Logs are in `logs/step-5/`: `session.logcat.txt` (the log read back from the phone over two unplugged stretches), per-run logs, screenshots, `metro.log` / `metro-photo.log`, and `phone-state-*.txt`. The phone state before and after matches, apart from the camera-privacy toggle's `last_change` time (camera access is back on).

| Plan row | Result |
|---|---|
| 1, ×10 | **Pass 10/10.** "Tracking good" 3.02–4.17 s after the tap; only "Starting AR…" before it. |
| 2, ×3 | **Pass 3/3.** Same frame, 0 remounts. "Tracking good" 1.45–1.92 s after returning; only `starting` in between, so the resume fix holds. |
| 3, 2× each path | **Pass 6/6, 0 evictions, 0 crashes.** "Tracking good" this long after opening AR: Sample plan → Back 4.15 / 4.06 s; Measure with photos → Back 4.01 / 3.52 s; Reference photos → Next room 4.11 / 4.10 s (a remount). |
| 4, permission | **Pass.** "Don't allow" → "Camera permission is required for AR measurement…". The permission and its flags were restored. |
| 4, camera access off | **Pass.** Dead session: "The camera image is dark or blank. … camera access is not turned off in Quick Settings, then tap Restart AR." Access back on → "Tracking good" in the **same** frame, no Restart AR. (On Samsung the toggle is in Settings → Camera access; it isn't a default Quick Settings tile.) |
| 4, camera holder | **Pass.** Samsung Camera in split screen took focus → CameraService evicted ARCore → "The camera is in use by another app (com.sec.android.app.camera). Tap this screen or close that app; AR resumes by itself." Tap back → "Tracking good" 0.5 s later, same frame. |
| 5 | **Pass 10/10 on the wall** (fresh session, Openings mode, 1.5–1.7 m): every tap returned a hit at the wall's depth, none missed and none went to the floor. The scatter about one fitted plane is wider than ticket 19's (RMS 9.5 cm, against 2.9 cm), at 43–52 s into the session. Openings use only the position along the wall, so the depth scatter matters little. |
| 6 | **3 ft: 2/3** (+0.3 / +1.1 / **−3.2%**). **4 ft (1.219 m): pass 3/3** (−1.2 / −0.1 / −1.7%). |

- **Log strings:** every cold start logged the four milestones, in the 2.58.1 format: `=== onAttachedToWindow START ===`, `ARCore installed on device`, `Selected camera config 2: CPU image 1920x1080 (status=0)`, `AR session resumed`. There was no `onRendererFailed` (no failure of that kind was induced); its format string is byte-identical in the 3.0.3 library.
- **No crashes** in the whole run: no `FATAL EXCEPTION`, `Fatal signal` or `SIGSEGV`, through about 20 engine mounts, among them Restart AR, Restart room and photo step → Next room.
- **`facesUp` on 3.0.3:** floor planes still come back as (180, y, −180) as well as (0, y, 0) (e.g. (180, −60.9, −180)), and the new rule locks the floor from both.
- **Row 6 at 3 ft:** all 6 corners were direct floor-plane hits at one height (−1.009 m), so the scale is consistent. The miss is where the finger landed: the start taps spread 2–5 cm and the end taps 2–5 cm, against a 3% budget of 2.7 cm. The user chose to settle it with 3 more tries at 4 ft, the longest their tape goes; the spec's row says "1–3 m".
- **Step 4 seen working again on 3.0.3:**
  - "Tracking was interrupted" after a loss with 2 corners.
  - "The floor moved" refused two taps: after a 35 s loss, the floor plane was 17 cm below the room's lock (−1.275 vs −1.104).
  - Restart room → a fresh frame.
  - Both refusal dialogs closed within about 1 s, so one may have been answered by a tap meant for the tape (the accidental-answer issue from step 4).

**Observations (none blocks step 5):**
- **A session that starts with camera access off drifts far.** After the blocked start (about 75 s on blank frames, plus the time to turn access back on), the recovered session tracked normally, but its origin was about **2.9 km** away (hits at x ≈ 2404 m, y ≈ −1435 m). Relative geometry within a few seconds was fine (7 wall taps within 2.2 cm of one plane). Then two short losses shifted the wall about 30 cm between groups of taps. This is ARCore's behaviour on blank frames. A room traced in such a session is risky; "Restart AR after a dead session" stays the advice.
- **The dead-session countdown pauses under a system dialog.** With "Unblock camera?" on screen, React Native's timers are paused, so the 10 s count finished about 8 s after the user tapped Cancel (73 s after opening). That's acceptable: the dialog itself tells the user what's happening.
- **In split screen** the guidance card overlaps the top of the bottom bar (the room-name field). Cosmetic.
- **Harness:**
  - Docker Desktop held port 8081, so Metro ran on 8082 with `adb reverse tcp:8081 tcp:8082` (the dev client still asks for 8081).
  - "Measure with photos" only shows with `EXPO_PUBLIC_PHOTO_ASSIST_URL` set. Path 3 used a placeholder (`http://127.0.0.1:9`) for that Metro session only; the screen makes no network call until Analyze.

## Step 6 release-build run: results (2026-11-07)

Plan row 9: one run of rows 1–3 and 5–6, plus a failure reason on screen, on a **release** build.

- **Build:**
  - `EXPO_PUBLIC_PHOTO_ASSIST_URL=http://127.0.0.1:9 ./gradlew :app:assembleRelease -PreactNativeArchitectures=arm64-v8a` (`logs/step-6/build.log`). The placeholder URL only shows the "Measure with photos" button for row 3.
  - It is the project's real release configuration: no R8 (`android.enableMinifyInReleaseBuilds` is unset), Hermes bytecode bundle, and signed with the debug keystore as the template does. There is no `eas.json`.
  - The manifest has no `debuggable`; on the phone the package's flags lost `DEBUGGABLE`. `libviro_renderer.so` is byte-identical to the dev client's (3.0.3).
  - A copy is at `logs/step-6/app-release-viro-3.0.3.apk`.
- **Instrumentation:** the step 5 temporary lines (`[ar-trace]`, `[ar-hit]`, `[ar-corner]`, `[ar-opening]`), plus `[ar-diag]` in `viro-ar-engine-view.tsx`: the diagnostics the app built from its own log. React Native's `console.log` reaches logcat in a release build too. All of them are removed again; `src` matches `fd9e347`.
- **Scripts:** `logs/step-6/scripts/`: the step 5 scripts pointed at `logs/step-6`, with `cold.sh` also printing the milestones the app read (`app-read=`). New: `clear.sh` (taps Clear only when no dialog is showing) and `camera-off.sh` (turns camera access off with `cmd sensor_privacy`, presses Cancel on the system dialog, turns access back on; nothing for the person to do but hold the phone).

S22U `R5CTA2PB2ZX`, Play Services for AR 1.57.262640293 (unchanged since step 5).

| Plan row | Result |
|---|---|
| **`logcat --pid` in a release build** | **Readable.** In every one of the 10 cold starts the app itself read all four milestones from its own log (`engine-attached`, `arcore-ready`, `session-created`, `session-resumed`), as did every later session. |
| 1, ×10 | **Pass 10/10.** "Tracking good" 2.34–2.92 s after the tap (debug: 3.02–4.17 s); only "Starting AR…" before it. |
| 2, ×3 | **Pass 3/3.** Same frame, 0 remounts; "Tracking good" again 1.57–1.67 s after returning, only `starting` in between. |
| 3, 2× each path | **Pass 6/6, 0 evictions, 0 crashes.** "Tracking good" after opening AR: Sample plan → Back 3.09 / 3.10 s; Measure with photos → Back 3.72 / 3.07 s; Reference photos → Next room 3.87 / 3.80 s. The first two Sample-plan attempts were harness failures (the phone had locked; then Back left the app before the scripted AR tap) and were rerun. |
| 4, camera access off (the failure-reason check) | **Pass.** Over adb: access off → AR → Cancel on "Turn on Camera access?" → after 10.3 s the screen showed "The camera image is dark or blank. … camera access is not turned off in Quick Settings, then tap Restart AR." That reason needs the milestones read from the log; without them the app says "The AR engine did not start". Access back on → "Tracking good" in the **same** frame. |
| 5 | **Pass 9/10** (fresh session, Openings mode, about 1.2–1.4 m). Taps 1–9 hit the wall's depth and lie on one vertical plane (RMS 4.3 cm; step 5: 9.5 cm). Tap 10 went to the **floor plane behind the wall** (2.87 m), although depth points on the wall were hit at 1.33 m: see the observation below. A first attempt with the plain wall filling the whole view lost tracking ("not enough detail"), so taps were ignored; it was redone with furniture in view. |
| 6 (4 ft, 1.219 m) | **3/6 within 3%.** From one spot, both ends about 1.9 m away: −3.9 / −0.1 / −4.3%. Standing over each end (the user's choice of retry): −1.6 / −0.7 / +3.2%. Mean −1.2%. Every corner was a floor-plane hit at the room's locked height (−1.125 m, then −1.240 m in the second session). |

- **Row 6 reading:** on a tape that did not move, the taps at each end spread 3–6 cm between tries (far end from a distance: 9 cm), while 3% at 4 ft is 3.7 cm for both ends together. The hit test is the same native library and JS as the debug build (step 5: 3/3 at 4 ft), so the misses are tap placement, not the build. The row's 3% budget is close to finger scatter at 1.2 m; a longer tape (2–3 m) would test the app rather than the finger.
- **No crashes:** no `FATAL EXCEPTION` or `Fatal signal` from the app in the whole run. The 29 `SIGSEGV` matches in the log are a T-Mobile app (`SCP`) logging its own signal handlers.
- **Phone state:** restored. The dev client (`logs/step-5/app-debug-viro-3.0.3.apk`, debuggable) is reinstalled, "stay on while plugged in" is back to 0 (it was set to USB during the run so the phone would not lock), camera access is on. `phone-state-before/after.txt` differ only in the camera toggle's `last_change` and the app's `lastUpdateTime`.

**Observations (none blocks step 6):**
- **Openings can land behind the wall.** `preferredHit` takes a plane hit before point hits, and ARCore's floor plane extends behind a wall, so a tap on a wall returned the floor 1.5 m beyond the wall's own depth points (tap 10). **Fixed and device-checked afterwards, uncommitted:** see "Fix: openings take the wall" below.
- **The accidental dialog answer again, this time by the harness:** the phone lay down for 13 s while two corners were placed, "Tracking was interrupted" appeared when tracking came back, and a scripted Clear tap answered it with "Restart room". This is the step 4 issue (ask in the bottom bar instead); `clear.sh` now checks for a dialog first.
- **The dead-session countdown did not stall this time:** Cancel was pressed within about 2 s, so the message came 10.3 s after opening AR (step 5: 73 s with the dialog left up).

## Fix: openings take the wall (uncommitted, 2026-11-07)

- **Bug (step 6, row 5, tap 10):** an opening tap on a plain wall returned the floor plane ARCore had extended behind the wall (2.87 m), not the wall's depth points (1.33 m), because Openings used `preferredHit` (any plane first). `locateOnWall` then projects that point onto the nearest wall, so the opening lands at the wrong place along the wall, or on another wall.
- **Fix:** new `openingHit(tap)` in `src/lib/ar-engine.ts`: a plane that does not face up (a detected wall), else the nearest point; never a plane facing up. With neither, the screen says "No wall detected here — aim at the wall and move around slowly." (before: the corner-oriented "No surface detected — aim at the corner…").
  - Corners keep `preferredHit` inside `placeCorner`, so the floor lock and its tests are unchanged.
  - Behaviour change: a tap in Openings mode that hits only the floor now places nothing. Before, it projected the floor point onto the nearest wall, which is how the wrong openings happened.
- **Tests (TDD, red then green):** three `openingHit` cases in `ar-engine.test.ts` from step 6's taps 8 and 10 (`logs/step-6/wall.logcat.txt`). 120 tests, typecheck, lint and prettier pass.
- **Device check (2026-11-07, dev client, Metro):** Openings mode, 12 taps on the plain wall with floor in view (`logs/fix-openings/`; `scripts/openings.js` summarises the temporary `[ar-opening]` lines, since removed).
  - Every tap took the nearest point on the wall (1.2–1.7 m); none got "No wall detected".
  - Tap 1 reproduced the bug's case: wall point at 1.45 m, the floor plane behind the wall at 1.92 m. The old rule would have taken the floor, 47 cm behind the wall; the fix took the wall point.
  - Two taps at the foot of the wall hit the floor plane and wall points at the same spot (4 cm apart); the fix took the point, which changes nothing there.
  - The phone state matches before and after; Metro and `adb reverse` are stopped.

## Fix: questions in the bottom bar (uncommitted, 2026-11-07)

- **Problem:** "Tracking was interrupted" and "The floor moved" were `Alert` dialogs. They open over the AR view, where a tap meant for the room answered them as they opened: step 4 (the user's tap hit Keep), step 5 (both floor-moved dialogs closed within about 1 s; which button is not recorded) and step 6 (a scripted Clear tap hit Restart room).
- **Change (`src/screens/ar-capture-screen.tsx` only):**
  - A `tracePrompt` state ('tracking-interrupted' | 'floor-moved') replaces both dialogs. Same titles and messages; the buttons are "Keep corners" / "Keep tracing" and "Restart room".
  - The question takes the hint line's place in the bottom bar, below the AR view, with `accessibilityLiveRegion="polite"` so TalkBack announces it like the dialog.
  - While it is open, an AR tap places nothing and shows "Answer the question below first."; the mode chips, Undo, Clear, the Restart AR chip and Finish room are disabled.
  - `restartAr` (Restart room, Restart AR, the photo step → Next room) clears it.
  - The two remaining `Alert`s (confirm Restart AR, replace an existing plan) open only from the user's own button press, so they stay.
- **No unit test:** the screen is covered by the device plan (spec, Testing Decisions); the change has no pure logic.
- **Device check (2026-11-07, dev client, Metro; `logs/trace-prompt/`, temporary `[ar-trace]` with the prompt and corner count, since removed):**
  - 2 corners, phone face down: a 2.8 s loss opened nothing (under 3 s, correct); about 10 s and 30 s losses opened "Tracking was interrupted" in the bar when tracking returned. The AR view stayed clear; the chips and Finish were dimmed (`prompt-1.png`).
  - An AR tap with the question open: the toast, and the room kept its 2 corners.
  - "Keep corners": the question closed, 2 corners, same frame, the hint back. "Restart room": a new frame, 0 corners, "Tracking good" 3.0 s later.
  - "The floor moved" was not seen: after the 30 s loss ARCore kept its map, and three floor taps placed corners normally. It shares the bar with the question above; only its text differs.
  - The phone state matches before and after; Metro and `adb reverse` are stopped.

## Analysis: what "The floor moved" means (2026-11-07, from logs only)

Question: after "The floor moved" → Keep tracing, a tap that hits only points is placed at the room's locked floor height. That is right if the refusal came from a leftover (stale) floor plane, and wrong if ARCore's map really moved. Script: `logs/floor-shift/timeline.js` (status changes, each tap's raw hits with heights, the corner rule's outcome). Feature and depth points describe the current map, so where they sit decides it.

- **Step 4 (`logs/step-4/session.logcat.txt`, 1 refusal): inconclusive.** A 6.3 s loss came before any corner; the lock (−1.115 m) was set after it. 3 s after corner 2 a tap hit an upward plane 10.1 cm lower (−1.216), with its point between the two (−1.169). The room was restarted at once, so no tap followed.
- **Step 5, event 2 (`logs/step-5/session.logcat.txt`, 1794112474, 2 refusals): the map moved.** Lock −1.104 (plane and points within 1–3 cm). 28 s later, **with no tracking loss in between**, plane and points both said −1.275 / −1.285 and −1.275 / −1.270. After Restart room the new session's floor was −1.216 (its own origin). The loss that preceded it (34.8 s) came before any corner, so no "Tracking was interrupted" question could fire.
- **Step 5, event 1 (1794111686, 3 refusals): the map moved, and stale planes stayed.** Lock −0.917 (plane and points agree). 5 s later the next spots' points were at −1.02 to −1.10 and by the refusals at about −1.12, while upward planes stayed stacked along the same line of sight (−0.99, −1.02, −1.14, −2.40). Corner 2 (98.0 s) passed the 10 cm check on a −0.993 plane and was placed at the old height.
- **Conclusion:** in both conclusive events the floor really moved in ARCore's map (17–20 cm). After Keep tracing, point-only taps land at the old height, about 17 cm above the real floor: roughly 20 cm short at 1.5 m. New corners either get refused or misplaced; only the corners already traced still line up with each other.
- **Also seen:** a big shift can come tens of seconds after a long loss, while tracking reports normal throughout.

## Fix: after the floor moved (uncommitted, 2026-11-07)

From the analysis above; the user chose "Restart room, or keep the corners to finish" and the refined check.
- **`placeCorner` (`src/lib/ar-engine.ts`):** after the lock, a tap is refused only when it has floor planes on its line of sight and **none** lies within 10 cm of the room's height. Before: the first floor plane decided. Ticket 19's `GHOST_FLOOR` (a stale plane 27 cm above a floor plane at the room's height) is now placed on the floor; step 5's real shifts (`SHIFTED_FLOOR`, `STACKED_FLOORS`) are still refused.
- **`ArCaptureSession.tapCorner` (`src/lib/ar-capture.ts`):** after a `floor-shifted` refusal, every corner tap is refused the same way, also after Clear; a new session (Restart room, Restart AR, Next room) starts over. Undo and Finish room still work on the corners traced.
- **Screen:** "The floor moved" now reads "AR tracking shifted under this room, so the corner was not placed: new corners would not line up with the ones already traced. Restart the room, or keep its corners to finish it as it is." Buttons: "Keep corners" and "Restart room". Each later corner tap reopens the question, so Restart room stays reachable (the Restart AR chip only shows when tracking is not good).
- **Tests (TDD, red then green):** fixtures `src/lib/__tests__/step-5-floor-shift-taps.ts` from step 5's log; `placeCorner`: both real shifts refused, the ghost floor placed within 1 cm of the floor-plane hit; `ArCaptureSession`: the refusal keeps the trace, the room takes no corner after it (even after Clear), and the ghost-floor tap is taken. 123 tests, typecheck, lint and prettier pass.
- **Not device-checked:** a floor shift cannot be caused on demand. The question uses the bar verified in "Fix: questions in the bottom bar"; only its text changed.
- **Openings too (follow-up, same day):** after a floor shift `ArCaptureSession.addOpening` returns false and the session exposes `floorMoved`. An Openings-mode tap then reopens "The floor moved" instead of placing; the opening panel's Add does the same if the shift came while it was open (and now says "Mark at least 2 corners…" if Undo left fewer than two, where it used to drop the opening silently). The question reads "…so it takes no more corners or openings: they would not line up with the ones already traced. Restart the room, or keep its corners to finish it as it is." One more test (124). Not device-checked, for the same reason.

## After that

- All six spec steps are done. Open items:
  - **Ticket 06:** closed without posting (2026-11-07). The drafts were refreshed for 3.0.3 first and stay in `upstream/` for reference.
  - **Decisions for the user:** the long loss between rooms (left for later).
  - Done since: "The floor moved" now closes the room to new corners (see "Fix: after the floor moved").
  - Done since: the questions moved to the bottom bar (see "Fix: questions in the bottom bar").
  - **Row 6 method:** repeat with a tape of 2–3 m when one is available.

## Practical notes

- The user commits; agents never run `git add` / `commit` / `push`.
- The phone's log ring buffer holds roughly the last 9 minutes, so untethered runs can be read after replugging.
- Play Services for AR was 1.57.262640093 on 2026-10-15 and 1.57.262640293 on 2026-11-07 (rows 1, 5 and 6 passed on it). Re-run plan rows 1, 5 and 6 when it changes.
- If port 8081 is taken on the Mac (Docker Desktop held it on 2026-11-07), run Metro with `--port 8082` and `adb reverse tcp:8081 tcp:8082`.
- A release build needs no Metro. Install it over the dev client with `adb install -r` (same debug keystore, app data kept), and reinstall the dev client APK afterwards.
- Camera access can be toggled over adb: `adb shell cmd sensor_privacy enable 0 camera` / `disable 0 camera`.
- Wall taps need some texture in view (furniture, the floor); a plain wall filling the whole view loses tracking.
- Taps on the AR view can answer a dialog that has just opened; check for one before a scripted tap (`logs/step-6/scripts/clear.sh`).
- **Suggested skills for the next session:** `tdd` (step 4's pure parts: the floor lock per room and the loss rule), `implement` (the spec steps), `code-review` (after each step), `diagnosing-bugs` (if a device run fails).
