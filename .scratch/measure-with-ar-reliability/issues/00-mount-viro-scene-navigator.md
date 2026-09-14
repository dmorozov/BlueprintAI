# 00 — The app never mounts ViroARSceneNavigator: no AR engine is ever created

Type: task
Mode: AFK fix, HITL test (user moves the phone)
Status: resolved (2026-09-14)
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

## Answer

**H0 confirmed and fixed: the Dead session no longer reproduces on the S22 Ultra.** The fix is uncommitted in the working tree.

### Before the fix

HEAD `5fb190e`, cold launch via `blueprintai://ar-capture`:
- **The screen mounted.** Logcat shows `Viro: ARCore availability check returned [SUPPORTED_INSTALLED]` and `Viro: === JNI setAnchorDetectionTypes called ===`.
- **No AR engine started.** No navigator lifecycle line and no tracking update appeared in 15 s.
- **The log tag in the Do-list is wrong.** Viro logs the lifecycle under `ViroAR`, not `VRTARSceneNavigator`. The only `VRTARSceneNavigator` string in logcat is RN's "Could not find generated setter for …VRTARSceneNavigatorManager" warning, printed at app start for every Viro manager. It proves nothing.

Bytecode check of `react_viro-release.aar`:
- `VRTARSceneNavigator` is the only class that does `new ViroViewARCore`.
- `ARSceneModule.performARHitTestWithPoint` rejects with "expected ViroARSceneNavigator as parent" unless the scene's grandparent is the navigator.

### Fix (`src/screens/ar-capture-screen.tsx`)

- **The screen renders `<ViroARSceneNavigator initialScene={TRACING_SCENE} provider="none">`.** It is keyed on `sceneAttempt`, so Restart AR now remounts the whole engine. `provider="none"` matches the app.json plugin config; without it the navigator defaults to `"reactvision"`.
- **`TracingScene` is a stable module-level component.** The navigator captures `initialScene` once, in its constructor. The scene reads corners, the scene ref and callbacks from a React context.
- **Correction to Do step 2:** the navigator renders scenes as ordinary React children of `VRTARSceneNavigator` (`_renderSceneStackItems`), not in its own React root, so context flows through.
  - `viroAppProps` was not used: the navigator mutates one stable object in place, which React Compiler (enabled here) can memoize past.
- **`viroSafeStyle` still wraps both Viro components**, and positioning stays on the plain RN wrapper View.

### Second defect, found and fixed: hit-test units

- **The Android path works in pixels.** Viro's bridge passes `x`/`y` unscaled as `int`s: `ViroViewARCore.performARHitTest(Point)` → `RendererARCore.performARHitTestWithPoint(float, float)`. The renderer hit-tests against ARCore's display geometry, which is set from the GL surface size in physical pixels.
- **The screen passed dp.** RN `locationX/Y` are density-independent, so every tap would have hit-tested at 1/2.8125 of its position on this phone.
- **Fix:** new `viroHitTestPoint()` in `src/lib/viro-interop.ts` scales and rounds on Android and passes through on iOS, with 3 unit tests. iOS units are unverified, because Viro ships no iOS sources.

**Checks:** `tsc` exit 0, `eslint` exit 0, `vitest` 64/64.

### Device results

Setup: the 2026-09-13 debug APK (native deps unchanged since), JS from Metro, ARCore 1.56.262080393. Timings come from logcat epoch timestamps.

| Check | Result |
|---|---|
| 10 consecutive cold launches (hand-held, moving; the views showed a table, a wall corner and a carpet strip) | **10/10**: navigator attached, tracking `UNAVAILABLE → NORMAL`, "Tracking good" **1.29–1.48 s** after `ViroAR: === onAttachedToWindow START ===`. The first launch after the fix, before the 10: 1.49 s |
| Background → foreground (Home, 5 s) | `AR session paused` → `AR session resumed`, same navigator, no remount; "Tracking good" **0.99 s** after resume |
| Capture → back → AR (ticket 03 path 2, 1 run) | expo-camera released the camera 1.38 s after back; the navigator attached 0.54 s later with no other client holding the camera; "Tracking good" **1.77 s** after attach |
| Photo assist → back → AR (path 3) | **N/A**: `EXPO_PUBLIC_PHOTO_ASSIST_URL` is unset, so the screen is unreachable in this build |
| In AR: Finish room → Reference photos → Next room (path 4, 1 run) | The navigator detached and ARCore released the camera 0.70 s after the tap; expo-camera preview was live. On Next room the navigator attached after 0.30 s with a new `ArSession_create`; "Tracking good" **2.18 s** after attach. A same-app camera client disconnected 0.38 s *after* ARCore connected (expo-camera's asynchronous release, or eviction per ticket 07), with no effect on tracking |
| Tap → hit test → corner | A tap at px (540, 1400) on the wall–carpet junction registered a corner. The marker was drawn under the tap, centred ≈ (535, 1335) given its 5 cm lift. The unscaled dp point would have been (192, 649) |

**Evidence:** `logs/ticket-00/` (gitignored) holds per-run logcats and screenshots, plus the trial scripts in `scripts/`.

### Caveats and what was not covered

- **Protocol deviations.**
  - Cold launches were timed from engine attach, not from the start of motion, over mixed surfaces rather than strictly a textured floor.
  - Background→foreground, path 2 and path 4 ran once each; ticket 03 asks for two runs per path.
  - Path 2 ran with the phone resting still.
- **Error surfacing is untouched.** This is acceptance-bar item 4. No failure occurred, and Viro still discards `ArStatus` (ticket 07). The screen's `onError` handler is still dead code.
- **Corner positions across background→foreground were not tested.** ARCore removed its planes after resume ("Plane … no longer tracked: removing"). This bears on *Multi-room tracking-frame semantics*.
- **Pushed screens were not tested.** Under pushed screens such as `/blueprint`, the AR screen stays mounted and Viro detaches/reattaches with the view.
- **The two extra corners during the tap test were not a bug.** They came from the tester's fingers: logcat `InputDispatcher` touch-downs with no matching adb request.

### Consequences for the map

Tracking now works, so this ticket's own rule applies:
- **Tickets 04/05/12/13/14** need re-scoping around a working Viro baseline. The Track B question becomes Depth-API hits, error surfacing and ownership, not a broken screen.
- **Tickets 01/02** lose their original purpose, since there is no dead session to capture on this phone. Re-scope or close them.

None of this was done here.

## Comments
