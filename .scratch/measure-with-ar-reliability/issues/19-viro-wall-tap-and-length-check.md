# 19 — Task: check Depth-API wall taps and metric length on Viro 2.58.1

Type: task
Mode: AFK build, HITL test (user moves the phone)
Status: resolved (2026-10-15)
Blocked by: 12
Part of: ../map.md

## Question

Does Viro 2.58.1, with depth turned on, meet the spec's **Depth-API plain-wall requirement** on the S22U, and do lengths measured with AR tap-to-trace come out right in meters? Ticket 12 made this the last gate before the engine decision.

Build (app code only; 2.58.1 already ships the native depth path, ticket 08 §3.4, so the installed APK is reused):
- `depthEnabled` on `ViroARSceneNavigator`, plus a way to switch it off for the comparison runs.
- Hit selection instead of `results[0]`: a detected plane first, then a `DepthPoint`, then a bare feature point.
- A temporary log line per tap (hit types returned, the type chosen, distance, position) and on `onDepthReady`; removed after the runs, like ticket 04's `[ar-trace]`.

Pass bar (ticket 12):
- **Plain wall:** with depth on, 1–3 m from a plain painted wall, at least 9 of 10 taps hit the wall. Repeat with depth off for comparison.
- **Length:** two taps on the ends of a tape-measured 1–3 m length are within 3%, three tries.
- **Room corners:** about 20 taps at 1–4 m with depth on and off. Record the hit types only; no pass mark. These set the defaults (depth on or off, whether bare feature points are accepted).

Resolution records the pass counts, the per-tap hit types, the length errors, and the outcome branch from ticket 12:
- **Pass:** ticket 13 closes as not needed, ticket 14 resolves as "keep Viro", and ticket 16 goes out of scope.
- **Wall taps fail:** ticket 13 runs, re-scoped to wall taps directly on ARCore.
- **Only the length check fails:** open a diagnosis ticket first, since tap-to-position mapping affects any engine.

## Answer

**Pass: with depth on, Viro 2.58.1 lands plain-wall taps on the wall, and ARCore's metric scale is within 3%. The length errors came from how the app places a corner, which is diagnosed here and is engine-agnostic. The user accepted this as the pass branch (2026-10-15).** Phone: S22U, Android 16, **Play Services for AR 1.57.262640093** (it auto-updated from 1.56 since ticket 04).

### What was built (working tree, uncommitted; no APK rebuild, the ticket 04 APK was reused)

- `depthEnabled={DEPTH_HITS_ENABLED}` (true) on `ViroARSceneNavigator`.
- `pickViroHit` in `src/lib/viro-interop.ts`, with 5 tests (suite 85): a hit inside a detected plane, then a depth or feature point, then a plane's unbounded extension (which can lie behind a wall), keeping ARCore's nearest-first order within a type. It replaces `results[0]`.
- The temporary `[ar-hit]` tap log and `onDepthReady` log are removed again (grep count 0).

### Viro never reports `DepthPoint` on Android (corrects ticket 08 §3.4)

`HitResultNative::acquireTrackable` (`android/viroar/src/main/cpp/arcore/ARCore_Native.cpp`) returns a trackable only for `AR_TRACKABLE_PLANE`, and `nullptr` otherwise. So `VROARFrameARCore::hitTest` never reaches its `DepthPoint` branch, and every depth hit arrives in JS as `FeaturePoint` with `hasDepthData: false`. The same code is in virocore v2.58.1 (`d86dee66`), v3.0.3 and `main`. ARCore's depth hits do work underneath (below); only the label is lost. The fix is one line (wrap any trackable, since `PlaneNative::getType` already maps depth points); it goes to ticket 06. Source copies: `logs/ticket-19/ARCore_Native.cpp`, `VROARFrameARCore.cpp`.

### Results

Three AR sessions. Session 1 was disturbed by a tracking loss; sessions 2 and 3 were settled. `onDepthReady` fired 2 s after resume with depth on; with depth off Viro logged `setDepthEnabled: false` and `Setting ARCore depth mode: DISABLED`.

| Check | Depth on | Depth off |
|---|---|---|
| **Plain wall, same wall** (user-confirmed) | Session 2: **10/10 on one plane**, residual RMS 2.9 cm, max 4.5 cm, at 0.95–1.5 m, 0.2–1.0 m above the floor | Session 3: **0/12 on the wall**. Top row 3/3 no hit; bottom row 3/3 went to the floor plane; middle row 6 points 0.7–1.0 m from the camera, 0.9 m above the floor, off the wall |
| **Room corners** | Session 2: 12 taps, 8 plane / 4 point, 0 misses. Session 1: 11 taps, 6 plane / 5 point, 0 misses | Session 3: 13 taps, 10 plane / 3 point, 0 misses |

**Wall: pass, and depth is what makes it pass.** Session 1's wall taps (depth on, 8–16 s after start while ARCore was still building its first map) scattered RMS 14.5 cm; tap only once tracking has settled.

**Length (3 ft = 0.914 m tape, session 2, 1.3–2.0 m from the camera):**

| Try | App as built (the hit point) | Tap ray placed at the floor plane's height |
|---|---|---|
| 1 (near) | 0.84 m (−7.8%): the end tap hit something 10 cm up (tape case) | 0.90 m (**−1.8%**) |
| 2 | 0.92 m (+1.0%) | 0.93 m (**+1.3%**) |
| 3 (far) | 0.56 m (−39%): the start tap hit something 26 cm up | 0.89 m (**−2.8%**) |

- **ARCore's scale: pass, 3/3 within 3%.** The app as built: 1/3.
- **Diagnosis:** with no detected plane under a tap at the tape's end, the nearest point along the ray was on an object above the floor, and the app took it. A floor corner should instead be placed where the tap ray meets the floor plane's height. This is the hit rule for ticket 15 and a spec implementation step. Any engine would need it, so it does not bear on the engine choice.
- Session 1's tries (4 ft −6.5%, 3 ft +2.8%, 3 ft +15%) are not counted: see the next section.

### Tracking loss rebuilds the map, and the old floors stay at stale heights

- Session 1: VIO stopped tracking 21:08:18–21:09:29 (phone set down to fetch the tape) and briefly twice more.
- ARCore then started new maps (`MultiMapManager added ADF` at 21:09:40, 21:10:27, 21:11:29), and the alignment only partly succeeded (`The alignment optimization problem is not solved`, `VIO_PROCESS_MAP_CONSTRAINT_FAIL`).
- Floor planes ended up at six heights, 1.38 to 2.91 m below the origin, and hit tests returned several of them stacked along one ray. Session 2 (one map, no loss) kept every floor hit within 4 cm of one height across about 9 m.
- **Consequence for the spec:** corners traced before a long tracking loss, and planes detected before it, cannot be trusted afterwards. The app needs a tracking-loss rule (warn, or restart the trace). This is engine-agnostic: it is ARCore's map behaviour.

### Other observations

- `FEATURE_DSP_CAM_IMU_DESYNC` once, at 21:07:05: "Camera to IMU clock offset (-5.90 ms) exceeds threshold (5 ms)". This is the #1784/#1785 signature on Samsung Android 16. It occurred once, early in session 1, and tracking was otherwise normal; ticket 06 can mention it.
- **Process:**
  - Unplugging USB drops the dev client's live link to Metro, so a later code change only lands after an app relaunch.
  - The phone's log ring buffer (5 MiB compressed, about 9 minutes here) held the untethered sessions.
  - The USB connection dropped twice; switching USB mode to File transfer restored it.

### Defaults this sets

- **Depth on** (`DEPTH_HITS_ENABLED = true`): walls need it, and corners hit equally well either way.
- **Accept feature or depth points** as a fallback; corners needed them in 4/12 (depth on) and 3/13 (depth off).
- **Hit rule:** project floor-corner taps onto the floor plane's height; for wall taps, take the depth or feature point. Ticket 15 fixes this in the seam.

### Outcome (ticket 12's pass branch, confirmed by the user)

- Ticket 13 closes as not needed.
- Ticket 14 resolves as "keep Viro".
- Ticket 16 goes out of scope.

**Evidence:** `logs/ticket-19/` (gitignored, 167 MB):
- logs: `session.logcat.txt`, `untethered{,2,3}.logcat.txt`, `metro.log`;
- `phone-state-{before,after}.txt` (they match);
- screenshots;
- the Viro source copies;
- `scripts/arhit.js`, the tap summariser.

## Comments
