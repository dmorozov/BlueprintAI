# 13 — Prototype: owned ARCore Expo Module spike on the S22 Ultra

Type: prototype
Mode: HITL (user moves the phone; agent builds)
Status: open
Blocked by: 02, 09, 10, 12
Part of: ../map.md

## Question

Does a **minimal** owned module — camera background + tracking state/error events + `hitTest` (incl. Depth-API hits) — track reliably on this phone and behave inside the app's expo-router stack under Fabric (z-order over/under RN views, back navigation, remount, background/foreground)?

Build the spike per ticket 09's design (seeded from `@stewmore/expo-ar` if ticket 10 says so), mounted on a throwaway screen behind a dev-only entry point, with the #1762 sensor workaround applied. If ticket 09 leaves the rendering design open, spike **both** A (GL `BackgroundRenderer`) and B (GL-free: Shared Camera preview + `EXPOSE_HARDWARE_BUFFER`) — B's feasibility is the single biggest simplification on the table and is unverified. Run the acceptance protocol (10 cold launches, ≤ 5 s to tracking, background/foreground) and log every `ArStatus`/`TrackingFailureReason`.

Depth/plane data to collect on this device: `session.isDepthModeSupported(AUTOMATIC)`; time to first vertical plane in two rooms; hit type and distance for ~20 corner taps at 1–4 m with depth on vs off; does a `DepthPoint` hit land on a plain painted wall? These numbers set the module's defaults (`DepthMode`, `PlaneFindingMode`, whether to accept feature-point hits).

Build note: `com.google.ar:core:1.56.0` collides with Viro's bundled `arcore_client` 1.43 (duplicate classes — ticket 11); on the spike branch either exclude/swap Viro's `arcore_client` per ticket 07 or temporarily drop the Viro plugin.

This is evidence for ticket 14, not production code — throwaway branch, no polish. Record pass counts, logcat excerpts, the spike's branch, and the concrete Fabric/lifecycle problems hit.

## Comments
