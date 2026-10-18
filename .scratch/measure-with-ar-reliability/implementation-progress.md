# Implementation progress — Measure with AR reliability

Spec: `docs/specs/measure-with-ar-reliability.md` (Implementation Steps 1–6, device test plan rows 1–9).
Step 2's device smoke test ran on 2026-10-17: all planned rows pass. Next: the user reviews the deviations below and commits step 2.

## Where things stand

| Spec step | State |
|---|---|
| 1. Seam types and pure logic | **Done, committed** (`6bbe482 step 1`) |
| 2. `ViroArEngineView` | **Code done, device smoke passed (2026-10-17); uncommitted** |
| 3. Tracking frames | **Code done as part of step 2** (uncommitted); plan row 8 passed |
| 4. Corner placement + tracking-loss rules | Not started |
| 5. Viro 3.0.3 | Not started |
| 6. Release-build check | Not started |

Also open: **ticket 06**. The four upstream drafts in `upstream/` are waiting to be posted. Send the comment and issue links back so they can be recorded on the ticket and it can be closed.

## Step 2 working tree (uncommitted)

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
- **About 1 s of "Tracking lost" after returning from Home.** On each resume Viro reports `unavailable`. The engine had already tracked, so the status is `lost`, and the guidance card shows "Tracking lost — move the phone slowly, or tap Restart AR below." for 0.8–0.9 s before "Tracking good". This could be shown as `starting` instead, which would need a resume signal in the engine view.
- **A flash of `waitingForCamera` at every mount.** `cameraFree` starts false, so the status shows `waitingForCamera: true` for about 30–40 ms until `awaitBackCameraAvailable` resolves. The badge stays "Starting AR…"; only the centre card's text flips for a frame or two.
- **A young session held still has nothing to hit.** After a cold start with the phone held still, the first 4 taps (3–16 s after "Tracking good") got `raw=[]` from Viro, which shows the "No surface detected" toast. Feature-point hits started about 19 s in. After Restart AR with the phone moving, the first tap (about 3 s in) hit `ExistingPlaneUsingExtent`. `raw=[]` means this is not caused by `toArHit` dropping `EstimatedHorizontalPlane`; none was seen in any tap. This is worth considering for step 4's guidance.
- **Hit types seen on the phone:** `ExistingPlaneUsingExtent` and `FeaturePoint` only.

**Test-harness notes:**
- While tracking was `lost`, uiautomator twice failed to find the Restart AR chip by its content-desc, so it was tapped by its coordinates. It was found normally a few seconds later.
- A first row 8 attempt was discarded: the screen was left (a back tap between runs) and re-entered, which gives a new frame without Restart AR.

## After that

- **Step 4:**
  - Keep the floor height **per room** in the screen or `ArCaptureSession`: Clear and Undo keep it; Next room, Restart AR and a new frame reset it.
  - Place corner taps with `placeCorner`.
  - Show the `floor-shifted` refusal message, and the keep-or-restart prompt after a tracking loss ≥ 3 s mid-trace.
  - First log a few plane hits' `transform.rotation` on the phone to confirm the `facesUp` rule (floor vs wall).
  - Device: plan rows 6 (tape within 3%) and 7 (loss warning / shift refusal).
- **Step 5:** bump `@reactvision/react-viro` to 3.0.3 and rebuild the dev client (`cd android && ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a`, as in ticket 04). Re-check the four milestone log strings and `onRendererFailed` in a device log, then run plan rows 1–6.
- **Step 6:** plan row 9 on a release build. If `logcat --pid` cannot be read there, record that the app falls back to generic reasons.

## Practical notes

- The user commits; agents never run `git add` / `commit` / `push`.
- The phone's log ring buffer holds roughly the last 9 minutes, so untethered runs can be read after replugging.
- Play Services for AR was 1.57.262640093 on 2026-10-15. Re-run plan rows 1, 5 and 6 when it changes.
- **Suggested skills for the next session:** `tdd` (step 4's pure parts: the floor lock per room and the loss rule), `implement` (the spec steps), `code-review` (after each step), `diagnosing-bugs` (if a device run fails).
