# 15 — Decision: the `ArEngine` seam — interface shape and the Viro adapter

Type: grilling
Mode: HITL (with a prototype stub to react to)
Status: resolved (2026-10-15)
Blocked by: 09
Part of: ../map.md

## Question

Define the interface `ar-capture-screen.tsx` codes against so any engine can be swapped or A/B'd on the phone:

- Lifecycle: mount/unmount/restart (fresh session ⇒ new tracking frame), pause/resume semantics, readiness.
- Events: `trackingState` (`normal | limited | lost | unavailable` + `reason`), `sessionError` (typed reason + human-readable text), `ready`.
- `hitTest(x, y)` result: world position (meters, Y-up), hit kind (`plane | point | depth`), distance/confidence — and how `ArCaptureSession`'s `ArTrackingQuality` maps from it. Today `ar-capture.ts` maps Viro `TRACKING_NORMAL/LIMITED` to confidence 1.0/0.7 and the screen takes `results[0]` regardless of hit type; ARCore's model is `TRACKING | PAUSED | STOPPED` plus a `TrackingFailureReason`. Propose the mapping table (e.g. TRACKING with no reason → `normal`; TRACKING with `INSUFFICIENT_FEATURES` / `EXCESSIVE_MOTION` / `INSUFFICIENT_LIGHT` → `limited`; PAUSED/STOPPED → `unavailable`) and a hit-selection rule (prefer plane/depth hits over bare feature points).
- Marker rendering (engine-drawn vs RN overlay) and optional `captureFrame()`.
- What the **Viro adapter** can and cannot provide (from ticket 07's findings) and how the owned module (ticket 09) fills the gaps.

Deliver a TypeScript interface plus an adapter sketch (prototype stub, no wiring), and decide it with the user. The seam is agreed in principle (Round 2, Q13); this ticket fixes its shape.

## Answer

**A deep module around Viro, shaped by what the AR screen needs (decided with the user, 2026-10-15).** The prototype stub type-checks and lints clean; it is not wired:
- `../prototypes/15-ar-engine-seam/ar-engine.ts`: the interface and `placeCorner`.
- `../prototypes/15-ar-engine-seam/viro-ar-engine-view.tsx`: the Viro implementation sketch and the status mapping table.

### Decisions

1. **Scope:** no A/B harness, and nothing built for a second engine. A/B in one APK is impossible anyway: two ARCore engines clash (tickets 10, 11). The screen depends only on the seam, so a swap means writing one replacement component.
2. **Engine health lives inside the engine component:** the camera wait, the log tail with ar-diagnostics, the 10 s dead-session timer, and Viro's forced "unavailable" at mount. The screen renders one `ArEngineStatus`: `starting | tracking{quality, advice} | lost{reason} | dead{reason}`. The mapping from Viro is a pure function (`viroEngineStatus`; the table is in the stub).
3. **Every fresh engine session is a new tracking frame:** first mount, Restart AR, and photo step → Next room. The component reports `onFrameStart(frameId)`, and the screen saves rooms under it.
   - **This fixes a bug.** `handleRestartAr` remounts the engine but keeps `arSessionId`, so a room traced after Restart AR is merged by `mergeSameFramePlans` with earlier rooms as if they shared a frame.
4. **The engine returns every hit plus the camera position** (`hitTest(x, y) → { hits: {kind: plane|point, position, facesUp}[], camera }`). A pure-TS resolver decides what a tap means.
   - Hit kinds are only plane or point, because Viro reports depth hits as feature points (ticket 19).
   - The plane's unbounded extension (`EstimatedHorizontalPlane`) is dropped.
   - Openings keep today's rule: the wall point, then `locateOnWall`.
5. **A corner's floor height:** each trace (one room's corners) locks its floor height at its first corner that hits an upward-facing plane. After that, a corner is where the tap's line of sight meets that height. Before the lock, the preferred hit is used, as today.
   - On ticket 19's taps this turns −7.8 / +1.0 / −39% into −1.8 / +1.3 / −2.8%.
   - The lock resets with the trace: Clear, undoing to zero corners, Next room, and restart.
6. **Tracking loss mid-trace: both rules.**
   - Refuse a corner whose floor plane is more than **10 cm** from the locked height ("the floor moved; tracking was interrupted"). That is ticket 19's ghost-floor signature.
   - When tracking returns after a loss of **≥ 3 s** with corners traced, warn: "Tracking was interrupted; earlier corners may be off. Keep, or restart this room?"
7. **Markers stay engine-drawn (Viro spheres), but 3 cm** instead of 20 cm; a 20 cm sphere hid the tape's end in ticket 19.
8. **No `captureFrame()`:** reference photos stay on expo-camera (ticket 16 is out of scope).
9. **Glossary:** `CONTEXT.md` gains **Tracking frame** (the coordinate system of one engine session; avoid "AR session" and "frame group" for it) and **Corner** (where two walls meet the floor, placed where the line of sight meets the trace's floor height).

### What the Viro implementation can and cannot provide

| Seam item | Viro 2.58.1 |
|---|---|
| Status `starting / tracking / lost` | Yes: `onTrackingUpdated` plus the forced-unavailable rule |
| Status `dead` with a reason | Exact for logged startup failures, #1762 and a foreign camera client; otherwise a best guess (ticket 04 / 12) |
| Hit kinds | Plane in extent, or point. Depth vs feature is not distinguishable (Viro bug, ticket 06) |
| `facesUp` | From the hit pose's rotation (pitch and roll < 15°). **UNVERIFIED:** ticket 19 logged positions only; check on the device when implementing |
| Camera position at the tap | `getCameraOrientationAsync` (deprecated in Viro's typings but working), fetched in parallel with the hit test |
| A new tracking frame | Only by remounting the navigator. Viro reports no ARCore map rebuild, hence rule 6 |

### For the spec (ticket 18): implementation steps

1. Move the stub to `src/lib/ar-engine.ts` and `src/components/viro-ar-engine-view.tsx`, with unit tests:
   - `placeCorner`, against ticket 19's logged taps;
   - `viroEngineStatus`, against ticket 04's states.
2. Move the camera wait, log watch, timer and Viro rendering out of `ar-capture-screen.tsx`.
3. Key the screen's `arSessionId` to `onFrameStart` (fixes the Restart AR bug).
4. Keep the floor lock per trace in the screen (or in `ArCaptureSession`), with the loss warning and the shift refusal.
5. Verify `facesUp` on the device, then rerun the acceptance runs and ticket 19's length check through the app.

## Comments
- **2026-10-15, ticket 12:** the seam is now the hedge for keeping Viro (not controlling Viro was ruled out as a reason to replace it). Ticket 19 settles the hit-selection rule's first cut (plane, then `DepthPoint`, then feature point) and whether depth is on by default.
- **2026-10-15, ticket 19 (input for the hit rule and lifecycle):**
  - Viro reports ARCore's depth hits as `FeaturePoint` (a Viro bug, ticket 06), so the adapter cannot tell depth from feature points today; the seam's `hit kind` should allow "point (depth or feature)" for Viro.
  - **Floor corners:** place the tap where its ray meets the floor plane's height, not at the hit point. Hit points near the floor landed on objects 10–26 cm up (−8% and −39% length errors); the ray-at-floor-height gave −1.8 / +1.3 / −2.8%.
  - **Walls:** take the depth or feature point (10/10 on the wall with depth on; 0/12 with depth off).
  - **Tracking loss:** after a long loss ARCore rebuilds its map and old planes stay at stale heights (six floor heights in one session), and a hit test can return several of them along one ray. The seam's lifecycle needs a "tracking was lost long enough that earlier corners are suspect" signal; Viro gives only the tracking state.
  - Today's first cut is `pickViroHit` in `src/lib/viro-interop.ts` (plane in extent, then point, then a plane's unbounded extension).
