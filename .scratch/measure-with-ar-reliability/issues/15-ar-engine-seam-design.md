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
