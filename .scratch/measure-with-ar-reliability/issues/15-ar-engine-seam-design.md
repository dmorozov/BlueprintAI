# 15 — Decision: the `ArEngine` seam — interface shape and the Viro adapter

Type: grilling
Mode: HITL (with a prototype stub to react to)
Status: open
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

## Comments
- **2026-10-15, ticket 12:** the seam is now the hedge for keeping Viro (not controlling Viro was ruled out as a reason to replace it). Ticket 19 settles the hit-selection rule's first cut (plane, then `DepthPoint`, then feature point) and whether depth is on by default.
- **2026-10-15, ticket 19 (input for the hit rule and lifecycle):**
  - Viro reports ARCore's depth hits as `FeaturePoint` (a Viro bug, ticket 06), so the adapter cannot tell depth from feature points today; the seam's `hit kind` should allow "point (depth or feature)" for Viro.
  - **Floor corners:** place the tap where its ray meets the floor plane's height, not at the hit point. Hit points near the floor landed on objects 10–26 cm up (−8% and −39% length errors); the ray-at-floor-height gave −1.8 / +1.3 / −2.8%.
  - **Walls:** take the depth or feature point (10/10 on the wall with depth on; 0/12 with depth off).
  - **Tracking loss:** after a long loss ARCore rebuilds its map and old planes stay at stale heights (six floor heights in one session), and a hit test can return several of them along one ray. The seam's lifecycle needs a "tracking was lost long enough that earlier corners are suspect" signal; Viro gives only the tracking state.
  - Today's first cut is `pickViroHit` in `src/lib/viro-interop.ts` (plane in extent, then point, then a plane's unbounded extension).
