# Spec: Measure with AR — reliable on Android 16 (Samsung S22 Ultra)

Status: ready-for-agent (the device-run steps need the user with the phone)
Written: 2026-10-15 · Map: `.scratch/measure-with-ar-reliability/map.md` (tickets 00–19)

## Problem Statement

On the user's Samsung Galaxy S22 Ultra (Android 16), **AR tap-to-trace** was unusable. The Measure with AR screen showed a black camera area, "Tracking lost" in the badge, and no way forward: a **Dead session**. The original diagnosis blamed an Android 16 / Samsung bug in Viro, the AR engine (ReactVision/viro#499, #513). That pointed toward replacing the AR engine, a multi-week job.

Once AR works, the user still needs it to be trustworthy:

- **Measured lengths must be right.** The app's tap handling turned a 0.91 m tape into 0.56 m on one try.
- **Plain walls must take taps.** Openings are marked on painted walls with no texture.
- **Failures must be explained.** The user must never stare at a silent black view.
- **Interrupted tracking must not corrupt a room.** Putting the phone down long enough to lose tracking, or restarting AR, must not silently corrupt the room being traced or merge it with rooms it does not line up with.

## Solution

**The investigation found the Dead session was the app's own bug** (H0: the screen never mounted `ViroARSceneNavigator`, so no AR engine was ever created). It was fixed in ticket 00. Viro, with three small fixes, then met the whole acceptance bar on the phone. **So the AR engine stays Viro**, behind one engine interface, and the remaining work is in the app:

1. **Already in the app (tickets 00, 04, 19):**
   - the navigator is mounted;
   - a camera wait lets expo-camera release the camera before AR starts;
   - every failure gets a readable reason, read from the app's own log;
   - Depth-API hits are on, so plain-wall taps land.
2. **To build (this spec):**
   - an `ArEngine` seam that moves engine health into one Viro component;
   - corner placement at the floor height of the room being traced;
   - a new **Tracking frame** for every engine session, which fixes a merge bug after Restart AR;
   - tracking-loss safeguards;
   - small markers;
   - an upgrade to Viro 3.0.3.

What the user sees:

- AR reaches "Tracking good" within a few seconds.
- Corners land on the floor even when the tap first hits something else.
- Lengths are within 3% (measured: −1.8 / +1.3 / −2.8%).
- Taps on a plain wall land on the wall.
- Every failure says why and what to do.
- After an interruption the app warns or refuses a corner, instead of drawing a wrong room.

## User Stories

1. As a person measuring a room, I want Measure with AR to reach "Tracking good" within a few seconds of moving my phone over the floor, so that I can start tapping corners right away.
2. As a person measuring a room, I want the badge to say "Starting AR…" while the engine starts, so that a normal start-up does not look like a failure.
3. As a person measuring a room, I want AR to keep tracking when I switch to another app and come back, so that I do not lose my trace.
4. As a person measuring a room, I want AR to start cleanly after I have used Capture, Photo assist or reference photos, so that using the camera elsewhere never breaks AR.
5. As a person measuring a room, I want to be told why AR did not start, and what to do, within about 10 seconds, so that I am never left with a black view and no way forward.
6. As a person measuring a room, I want to be told when camera permission is missing, so that I can allow it in settings.
7. As a person measuring a room, I want to be told when Google Play Services for AR is missing, declined or out of date, so that I can install or update it.
8. As a person measuring a room, I want to be told when the camera image is dark or blank, including when camera access is turned off in Quick Settings, so that I can fix it.
9. As a person measuring a room, I want to be told which app is holding the camera, so that I can close it; and I want AR to resume by itself when I come back.
10. As a person measuring a room, I want a Restart AR button whenever tracking is not good, so that I can recover a stuck session myself.
11. As a person measuring a room, I want a confirmation before Restart AR discards my traced corners, so that I do not lose work by accident.
12. As a person measuring a room, I want to tap where two walls meet the floor and have the corner placed on the floor, even if my tap first hits a skirting board, a tape case or my foot, so that wall lengths are right.
13. As a person measuring a room, I want measured wall lengths within 3% of a tape measure at 1–3 m, so that the floor plan is usable.
14. As a person measuring a room, I want to tap a plain painted wall to place a door or window, so that openings land on the wall even where it has no texture.
15. As a person measuring a room, I want small corner markers, so that a marker never hides the spot I am about to tap.
16. As a person measuring a room, I want to be warned when tracking was interrupted for a few seconds while I was tracing, so that I can choose to keep my corners or restart the room.
17. As a person measuring a room, I want the app to refuse a corner when the floor has visibly moved (tracking was rebuilt), and to tell me why, so that one bad corner does not distort the whole room.
18. As a person measuring several rooms, I want rooms traced in one tracking frame to line up automatically, so that I do not have to align them.
19. As a person measuring several rooms, I want a room traced after Restart AR or after the reference-photo step not to be merged with earlier rooms as if aligned, so that the combined plan is never silently wrong; I can align it in the align editor instead.
20. As a person measuring a room, I want reference photos to keep working between rooms, so that I can keep records without affecting AR.
21. As a person on a phone without ARCore support, I want to be told AR measuring is unavailable, so that I can use another measurement path.
22. As a developer, I want the AR screen to depend on one engine interface, so that replacing Viro later means writing one component.
23. As a developer, I want the engine status rules as a pure, tested function, so that start-up and failure behaviour can be checked without a phone.
24. As a developer, I want corner placement as a pure, tested function, so that its accuracy can be checked against logged real taps.
25. As a maintainer upgrading Viro, I want tests built from real Viro and ARCore log lines, so that a changed log format fails a test instead of silently losing failure reasons.
26. As a maintainer, I want a written device test plan, so that each Viro or ARCore update can be re-checked on the phone the same way.

## Implementation Decisions

### The AR engine: Viro stays (tickets 12, 14, 19)

- **The engine stays Viro.**
  - `@reactvision/react-viro` 2.58.1 today. Upgrade to **3.0.3**, which fixes a SIGSEGV when the navigator remounts (virocore PR #398); the app remounts on Restart AR and Next room.
  - 3.0.x keeps RN 0.86 / Expo 57 peers, the same ARCore build (Java 1.43 / native 1.51), the same depth support, and the four log strings the app parses.
  - The upgrade needs a native rebuild.
- **No virocore fork.** It stays the documented fallback: about 3–4.5 days, then 0.5–1 day per upstream release (ticket 08). It becomes worth it only if:
  - the spec later needs ARCore's exact create/resume/update statuses and upstream declines the status-to-JS change (ticket 08 patch (a)), or
  - code comes to depend on telling depth hits from feature points.
- **No owned ARCore module** (tickets 09, 10, 13). Two ARCore engines cannot ship in one APK, so the engines cannot be A/B tested side by side.
- **Not applied:**
  - The #1762 sensor hold and `HIGH_SAMPLING_RATE_SENSORS`: there was no sensor failure on the phone, and every registration returned OK (ticket 04).
  - The ARCore client swap: a no-op here (ticket 07).
- **No toolchain change** (ticket 11).
- **Depth-API hits are on** (`depthEnabled`).
  - With depth, 10/10 plain-wall taps land on the wall, within 4.5 cm of one plane; without it, 0/12 (ticket 19).
  - Viro reports every depth hit as `FeaturePoint`, because its `acquireTrackable` only wraps planes, so the app never relies on the `DepthPoint` label.

### Failure reasons (tickets 04, 12)

- **Viro passes no ARCore failure to JS.** The local native module (`ar-session-guard`, Android only) provides:
  - a back-camera availability wait;
  - the app's own `logcat --pid` lines, filtered to deterministic signatures.

  `ar-diagnostics` turns those lines into engine milestones, failures and the client that holds the camera.

- **What the user is told:**
  - **Exact reasons:** install / update / declined / unsupported / permission (Viro's `onRendererFailed`), the #1762 sensor failure, another app holding the camera, and blank frames (privacy toggle → "insufficient light").
  - **Otherwise a best guess** from how far start-up got.
  - **The catch-all is a Dead session:** no tracking within 10 s.
  - A readable best guess meets the bar (ticket 12); ARCore's exact status is not required.
- **The camera wait:** each engine session mounts only after the back camera is free, capped at 3 s. If another app keeps the camera, AR starts anyway, and ARCore evicts that app because ours has focus.

### The `ArEngine` seam (ticket 15)

A deep module around Viro, shaped by what the AR screen needs; nothing is built for a second engine. The screen depends only on these types (trimmed from the ticket 15 prototype):

```ts
type Vec3 = [number, number, number];
type ArEngineStatus =
  | { kind: 'starting' }
  | { kind: 'tracking'; quality: 'normal' | 'limited'; advice: string | null }
  | { kind: 'lost'; reason: string } // tracked before, not now
  | { kind: 'dead'; reason: string }; // a Dead session
interface ArHit {
  kind: 'plane' | 'point';
  position: Vec3;
  facesUp: boolean;
}
interface ArTap {
  hits: ArHit[];
  camera: Vec3;
} // hits nearest first
interface ArEngineHandle {
  hitTest(x: number, y: number): Promise<ArTap>;
} // RN units
interface ArEngineViewProps {
  markers: readonly Vec3[];
  onStatusChange(status: ArEngineStatus): void;
  onFrameStart(frameId: string): void; // once per engine session = a new tracking frame
}
// The screen restarts the engine by changing the component's React key.
```

- **`ViroArEngineView`, the only implementation, owns:**
  - the camera wait;
  - the log watch and ar-diagnostics;
  - the 10 s Dead-session timer;
  - Viro's forced "unavailable" report at mount (only real tracking, limited or normal, proves the engine alive);
  - the navigator, scene and markers;
  - the dp → physical-px tap conversion;
  - Viro's hit types.
- **Status mapping** (a pure function `viroEngineStatus`):

  | Viro / log tail            | Status                                           |
  | -------------------------- | ------------------------------------------------ |
  | a logged failure           | dead (its message)                               |
  | not tracked, timer running | starting                                         |
  | not tracked, timer expired | dead (best-guess reason)                         |
  | NORMAL                     | tracking normal                                  |
  | LIMITED                    | tracking limited + advice for reason 2/3/4       |
  | UNAVAILABLE after tracking | lost (names the camera holder when there is one) |

- **Hit mapping:**
  - `ExistingPlaneUsingExtent` → `plane`. `facesUp` is true when the hit pose's pitch and roll are both under 15°; **verify on the device**.
  - `FeaturePoint` and `DepthPoint` → `point`.
  - `EstimatedHorizontalPlane` (a plane's unbounded extension, which continues behind walls) is dropped.
  - The camera position comes from `getCameraOrientationAsync`, fetched in parallel with the hit test.
- **Markers:** engine-drawn spheres, 3 cm (today's 20 cm spheres hid the tape's end).
- **No `captureFrame()`:** reference photos stay on expo-camera.

### Corners and the floor (tickets 15, 19)

- **The floor height is locked per trace.** A trace (one room's corners) locks its floor height at its first corner tap that hits an upward-facing plane below the camera. That hit is the Corner.
  - Before the lock, a tap uses its preferred hit (plane, then point), as today.
- **After the lock,** a Corner is where the tap's line of sight meets the locked floor height. The line runs from the camera through the plane hit if there is one, else through the nearest hit.
- **Why:** on ticket 19's tape taps, the hit point gave −7.8 / +1.0 / −39%; the floor-height rule gives −1.8 / +1.3 / −2.8%.
- **The lock resets** with the trace: Clear, undo to zero corners, Next room, Restart AR, and the photo step → Next room.
- **Openings** keep today's rule: the hit point, located on the nearest wall in plan.
- **Implementation:** a pure `placeCorner(tap, floorY)` → `{ok: true, corner, floorY} | {ok: false, reason: 'no-hit' | 'floor-shifted'}`.

### Tracking frames and tracking loss (tickets 15, 19)

- **Every engine session is a new Tracking frame:** first mount, Restart AR, and photo step → Next room. The screen saves each room under the frame id from `onFrameStart`.
  - **This fixes a bug.** Restart AR kept the old `arSessionId`, so `mergeSameFramePlans` merged rooms from different frames as if aligned.
- **Floor-shift refusal:** a corner tap whose floor plane is more than **10 cm** from the locked height is refused: "The floor moved; tracking was interrupted." This is the signature of ARCore rebuilding its map (ticket 19: old planes stayed at six stale heights in one session).
- **Long-loss warning:** when tracking returns after a loss of **≥ 3 s**, with corners already traced, the app asks: "Tracking was interrupted; earlier corners may be off. Keep, or restart this room?"
- **Background → foreground** keeps the engine session and its frame (Viro pauses and resumes ARCore; ticket 04). Only a long loss triggers the warning.

### Reference photos (ticket 16, out of scope)

The engine stays Viro, so reference photos stay on expo-camera. The photo step unmounts the engine, and the camera wait guarantees an orderly hand-off back (0 evictions in ticket 04, at about +0.7 s).

## Testing Decisions

- **Test external behaviour through the seam's pure functions,** with inputs taken from real device logs, not invented ones. The screen itself stays untested in code and is covered by the device plan.
- **Unit tests (Vitest, node environment):**
  - **`placeCorner`:** fixtures built from ticket 19's logged taps (`logs/ticket-19/`, gitignored; copy the few needed taps into the test as literals). Cases:
    - the three tape tries land within 3%;
    - the first floor-plane hit locks the height;
    - before the lock the preferred hit is used;
    - a floor plane > 10 cm from the lock is refused;
    - no hits gives `no-hit`;
    - an upward line of sight gives `no-hit`.
  - **`viroEngineStatus`:** every row of the mapping table, including the forced-unavailable start and a logged failure that beats tracking.
  - **ar-diagnostics:** the existing 16 tests stay. Add cases for any log line Viro 3.0.3 changes (none expected).
  - **Hit mapping (`toArHit`):** the type mapping, the dropped extension, and `facesUp` from rotations recorded on the device.
- **Prior art:** `src/lib/__tests__/ar-diagnostics.test.ts` (real S22U log lines as fixtures), `viro-interop.test.ts` (hit picking), `ar-capture.test.ts` (`ArCaptureSession`).
- **Device test plan (S22U, Android 16; record the Play Services for AR version):**

  | #   | Check                                                                           | Pass                                                                                                 |
  | --- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
  | 1   | 10 consecutive cold launches into Measure with AR, moving over a textured floor | 10/10 reach "Tracking good" ≤ 5 s after moving                                                       |
  | 2   | Home for 5 s, then back                                                         | 3/3 keep the session and reach "Tracking good" again without a restart                               |
  | 3   | Capture → Back → AR; Photo assist → Back → AR; Reference photos → Next room     | 2/2 each; 0 camera evictions                                                                         |
  | 4   | Permission denied; camera off in Quick Settings; another app holds the camera   | each shows its readable reason; Quick Settings and the camera holder recover without a restart       |
  | 5   | Plain painted wall, 1–3 m, depth on                                             | ≥ 9/10 taps on the wall                                                                              |
  | 6   | Tape on the floor, 1–3 m, corner taps through the app                           | 3/3 within 3%                                                                                        |
  | 7   | Put the phone down ≥ 10 s mid-trace, then resume                                | the long-loss warning shows; a corner on a shifted floor is refused                                  |
  | 8   | Finish room → Restart AR → trace a second room                                  | the two rooms get different frame ids and are not merged                                             |
  | 9   | One run of 1–3 and 5–6 on a **release** build                                   | failure reasons still appear (`logcat --pid` readable outside a debuggable build); tracking as above |

- **When to re-run:** after any Viro upgrade (1–6), after an ARCore update seen on the phone (1, 5, 6), and before a release (all).

## Implementation Steps

Each step is sized for one `/implement` session. Steps 1–4 are AFK code with a short device check; steps 5 and 6 need the user with the phone.

1. **Seam types and pure logic** (about 0.5 day).
   - Add the `ArEngine` types, `placeCorner` and `viroEngineStatus` from the ticket 15 prototype, with their unit tests.
   - No screen change yet.
2. **`ViroArEngineView`** (1–1.5 days).
   - Move the camera wait, log watch, Dead-session timer, navigator, scene and markers (3 cm) out of the AR screen into the component.
   - The screen renders `ArEngineStatus` for the badge and the guidance card, and calls `hitTest` through a ref.
   - Device smoke: plan rows 1 (×3), 2 and 4 (permission).
3. **Tracking frames** (about 0.25 day).
   - Save rooms under `onFrameStart`'s id. Restart AR and the photo step get new frames through remounting.
   - Device: plan row 8.
4. **Corner placement and tracking-loss rules** (0.5–1 day).
   - Floor lock per trace, using `placeCorner` for corner taps.
   - The floor-shift refusal message and the long-loss keep/restart prompt.
   - Device: verify `facesUp` against logged plane-hit rotations, then plan rows 6 and 7.
5. **Viro 3.0.3** (about 0.5 day plus a device session).
   - Bump the package and rebuild the dev client.
   - Re-check the four milestone strings and `onRendererFailed` in a device log.
   - Plan rows 1–6.
6. **Release-build check** (about 0.5 day).
   - Plan row 9 on a release build. If `logcat --pid` is not readable there, keep the Dead-session catch-all and show generic reasons. Record the result.

**Total: about 3.5–4.5 dev-days**, with three device sessions.

## Recorded Experiment Results

Phone: Samsung Galaxy S22 Ultra `SM-S908U`, Android 16, security patch 2026-08-05; Play Services for AR 1.56.262080393 (tickets 00–04), then 1.57.262640093 (ticket 19). All runs used debug builds.

| Ticket     | Question                                          | Result                                                                                                                                                                            |
| ---------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 00         | Why the Dead session?                             | The navigator was never mounted, so there was no engine (H0). Fixed: 10/10 cold launches tracked 1.29–1.48 s after attach. Also fixed: taps hit-tested in dp instead of px        |
| 01         | Logcat of a failing mount                         | Only H0 reproduces (pre-fix screen, 3/3). H1–H4 not supported; the #1762/#1784-style strings appear in healthy sessions too, so they are noise                                    |
| 02         | Google's `hello_ar_kotlin` on the phone           | Tracks, depth supported, no flapping, no sensor failure. ARCore itself works on this firmware                                                                                     |
| 03         | Does expo-camera use before AR break it?          | 8/8 tracked. On Reference photos → Next room, ARCore evicted expo-camera's client (harmless; now avoided by the camera wait)                                                      |
| 04         | Viro + camera wait + log-based reasons vs the bar | Cold 10/10 (1.29–3.60 s attach → tracking); bg→fg 3/3; camera paths 6/6 with 0 evictions; readable reasons for permission, Quick Settings, foreign camera holder                  |
| 05, 17     | ARCore bisect; second device                      | Not needed (02 passed)                                                                                                                                                            |
| 07         | Research: quick fixes inside Viro                 | Recipes for the navigator, sensor hold, camera guard and ARCore swap; error surfacing needs a rebuild or the log tail                                                             |
| 08         | Research: fork virocore?                          | Feasible, 3–4.5 days, no showstoppers; builds reproduce the shipped AARs                                                                                                          |
| 09, 10, 11 | Research: owned module, expo-ar, toolchain raise  | Owned module 6–9 days + spikes; expo-ar cannot coexist with Viro; raise not worth it                                                                                              |
| 12         | Track A outcome                                   | Viro passes the bar; best-guess reasons acceptable; not controlling Viro is no reason on its own to replace it                                                                    |
| 13         | Owned-module spike                                | Not needed (19 passed)                                                                                                                                                            |
| 19         | Wall taps and length on Viro                      | Plain wall 10/10 with depth (0/12 without); ARCore scale within 3% when corners sit at the floor height; Viro mislabels depth hits; ARCore keeps stale planes after a map rebuild |

## Effort and Risks

- **Effort:** about 3.5–4.5 dev-days, plus about 2 hours of device runs per session.
- **Risks:**
  - **Viro is maintained by a small team that has not replied on the Android 16 issues.** Mitigated by the seam (one component to replace) and the documented fork (ticket 08). Track viro#499/#568.
  - **Log-string fragility:** the failure reasons depend on Viro's log text. Mitigated by fixture-based tests and a check on every upgrade (the missed space after `error:` in ticket 04 shows the risk).
  - **Release builds:** reading the app's own log there is unverified (plan row 9). If it fails, users get the generic reason and the 10 s catch-all.
  - **Other Samsung Android 16 phones:** viro#568 (Galaxy A56) reports tracking flapping, and ARCore's #1784/#1785 report the camera-to-motion-sensor clock-offset issue. The S22U logged that offset warning once (−5.9 ms) without effect. There is no second test device.
  - **ARCore updates arrive silently** (1.56 → 1.57 during this work). Re-run plan rows 1, 5 and 6 when the version changes.
  - **`facesUp` from Viro's hit pose is unverified;** step 4 checks it first.
  - **Single-device evidence,** and one length session (3 tries) under the final rule. Plan row 6 repeats it.

## Out of Scope

- iOS AR parity (ARKit / RoomPlan). Android-first; iOS keeps compiling with Viro's iOS side.
- Replacing Viro (an owned ARCore module or `@stewmore/expo-ar`), forking virocore, and removing the Viro dependency.
- Frame capture from the engine for reference photos (ticket 16).
- WebXR inside a WebView; expo-camera preview plus ARCore poses.
- On-device depth models as the measuring engine; model-assisted corner suggestions.
- Paid external AI APIs.
- Toolchain raise to compileSdk 37 / Kotlin 2.4.

## Further Notes

- **Upstream (ticket 06, open, HITL: the agent drafts, the user posts):**
  - viro#499 with the S22U results (the Dead session was app-side), plus an offer of the status-to-JS change (ticket 08 patch (a)).
  - The depth-label bug with its one-line fix.
  - A reply on viro#568 asking for a `hello_ar` run.
  - The ARCore #1762/#1784 posts were dropped (they don't apply to this phone).
- **Still open (Not yet specified on the map):**
  - error UX beyond ticket 04's messages (retry policy, prompting the install);
  - EAS Build / CI for the local native module, only if EAS is adopted.
- **Research** (throwaway branches, never pushed):
  - `research/viro-quick-fix-recipes` (07)
  - `research/virocore-rebuild-feasibility` (08; also `.scratch/measure-with-ar-reliability/research/virocore-rebuild-feasibility.md`)
  - `research/owned-arcore-expo-module-design` (09)
  - `research/expo-ar-evaluation` (10)
  - ticket 11's toolchain report in `.scratch/measure-with-ar-reliability/research/research-toolchain-upgrade.md`
- **Evidence:** `logs/ticket-00` to `-04`, `-08` and `-19` (gitignored, local to this Mac).
- **Prototype:** `.scratch/measure-with-ar-reliability/prototypes/15-ar-engine-seam/`.
