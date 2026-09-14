# 00 — The app never mounts ViroARSceneNavigator: no AR engine is ever created

Type: task
Mode: AFK fix, HITL test (user moves the phone)
Status: open
Blocked by: —
Part of: ../map.md

## Question

**Confirmed app-side defect, found while resolving ticket 07 and verified independently in this repo.**

`src/screens/ar-capture-screen.tsx` renders `<ViroARScene>` **bare**. In `@reactvision/react-viro` 2.58.1, `ViroViewARCore` — the object that creates the ARCore session, drives the GL renderer and draws the camera — is constructed **only** by `VRTARSceneNavigator` (i.e. the JS `ViroARSceneNavigator` component). `VRTARScene` on its own is a plain `ReactViewGroup`: it creates no view and no session.

Verified in this repo (2026-09-14):
- `grep -rn "SceneNavigator" src/` → **no matches**; `git log -S "SceneNavigator" -- src/` → **never present**.
- The only Viro import is in `ar-capture-screen.tsx` (`ViroARScene`, `ViroMaterials`, `ViroSphere`, `ViroTrackingStateConstants`, `isARSupportedOnDevice`, `requestRequiredPermissions`).
- The package does export `ViroARSceneNavigator` (`node_modules/@reactvision/react-viro/index.ts`).

This produces **exactly** the Dead session signature: black view, `onTrackingUpdated` never fires, "Restart AR" remounts nothing that owns a session. It also explains both log lines in `docs/issues/measure-with-AR-dead-camera-issue.md` **without** any working session: "ARCore availability check returned [SUPPORTED_INSTALLED]" comes from the screen's own `isARSupportedOnDevice()` call, and `setAnchorDetectionTypes` is a `VRTARScene` prop setter that runs on the view manager regardless.

**This displaces H1–H4 as the leading hypothesis and must be tested before any of them.** It is also the cheapest possible fix.

Do:
1. Confirm on the device in ~2 minutes: `adb logcat` while entering the screen and look for `VRTARSceneNavigator: === onAttachedToWindow START ===`. Its **absence** confirms no AR engine instance exists.
2. Restructure the screen to render `<ViroARSceneNavigator initialScene={{scene: ...}} />` with the tracing scene as `initialScene`, passing state via `viroAppProps` (or a module-level store) since the scene renders inside the navigator's own React root. Keep `viroSafeStyle` discipline (`src/lib/viro-interop.ts`) and the existing hit-test/tap flow; `performARHitTestWithPoint` is called on the **scene** ref, which the navigator supplies.
3. Re-run the acceptance protocol (10 cold launches, ≤ 5 s to "Tracking good", background→foreground, the ticket 03 navigation paths).

Resolution records: whether the navigator log line was absent before the fix, whether tracking now starts, and the pass counts. **If tracking now works**, tickets 04/05/12/13/14 are re-scoped around a working baseline (the Track B engine question becomes about Depth-API hits, error surfacing and ownership — not about a broken screen); **if it still fails**, the upstream hypotheses H1/H2 return and tickets 01/02 proceed with a genuinely-mounted engine.

## Comments
