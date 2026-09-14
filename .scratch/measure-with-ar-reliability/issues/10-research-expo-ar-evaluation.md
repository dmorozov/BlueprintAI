# 10 — Research: evaluate `@stewmore/expo-ar` as a trial engine or a vendoring starting point

Type: research
Mode: AFK
Status: resolved (2026-09-14)
Blocked by: —
Part of: ../map.md

## Question

`@stewmore/expo-ar` 0.2.2 (https://github.com/stewartmoreland/expo-ar) — verified so far (claims-verification, C8): one cross-platform Expo view backed by **ARKit on iOS and ARCore on Android** (Android side via **SceneView 2.3.0 → ARCore 1.48.0**), `raycast(x, y)` hit testing (`frame.hitTest`), `onTrackingStateChange { state }` event, MIT, built for **exactly Expo SDK 56** (SDK 57 compatibility unverified; Kotlin 2.0.21 vs our 2.1.20), one maintainer, last release v0.2.2 on 2026-06-11. Is it (a) usable as-is for a half-day trial on the S22U, (b) worth vendoring into `modules/` and adapting as the seed of ticket 09's owned module (bumping SceneView to 2.3.3 / ARCore 1.52, or replacing SceneView), or (c) to be discarded — mining only its `ExpoArView.kt` lifecycle pattern?

Review from source:
1. Architecture: view type (GLSurfaceView/TextureView/SceneView?), renderer, session lifecycle and camera release, threading, how errors are surfaced.
2. API surface vs. our AR-engine contract: hit-test result shape, tracking-state events, Depth API support, frame capture, iOS implementation (real or stub).
3. Compatibility: Expo SDK 57 / RN 0.86 new arch, ARCore 1.48 pinning (can it be bumped to 1.56 trivially?), config plugin, minSdk.
4. Health: license text, tests, open issues, last commit/release dates, bus factor.
5. A **trial recipe**: install, config plugin, a minimal screen mounted in this app's expo-router stack, what to watch in logcat, how to run the acceptance protocol.

Findings go to `docs/research/expo-ar-evaluation.md` on branch `research/expo-ar-evaluation` (link it here). Read the actual repository source; mark UNVERIFIED anything inferred.

## Answer

Report: `docs/research/expo-ar-evaluation.md` on branch `research/expo-ar-evaluation`. A skeptic pass reviewed it against primary sources.

**Verdict: (a) YES as a half-day diagnostic trial, (b) PARTIAL as a vendoring seed (~60% reusable), (c) discard its extensions.**

**As a trial, under four conditions:** build it **without Viro** (both ship ARCore Java classes and `libarcore_sdk_*.so` -> duplicate class/native-lib errors: the two engines **cannot be A/B'd in one APK**, which constrains the seam plan in ticket 15); grant camera permission from JS first; expect a **crash** rather than an error event if `Session.resume()` throws (SceneView 2.3.0 has no try/catch on `resume()`/`update()`; only `Session(context)` creation failures reach `onError`); and instrument timings in JS (the Kotlin has no logging).

**Reusable (the module shell):** `ExpoView` + `EventDispatcher` wiring, dp<->px `hitTest` filtered to `Plane|Point|DepthPoint`, column-major pose serialisation, a TS contract with Zod + a reducer hook + Jest tests, the config plugin, and a **real ARKit iOS implementation** (exceeds the map's compile-only stub requirement).

**Not reusable (the session core):** it delegates create/resume/pause/close to SceneView's `LifecycleObserver`, which (i) crashes on resume/update failures, (ii) **drops `TrackingFailureReason`** although SceneView computes it and ships human-readable strings, (iii) **permanently destroys** the SceneView + ARCore session on `onDetachedFromWindow` with no recreation - a Dead session by construction if react-native-screens ever detaches without unmounting, and (iv) applies config only at session creation (the README claims otherwise). Replace it with patched copies of `ARSceneView`/`ARCore`/`ArSession` (~1,100 lines, Apache-2.0) or the `hello_ar_kotlin` GL renderer.

**Health:** single author, 24 commits all within 2026-06-03..06-11, 3 stars / 0 forks, CI never compiles native code, LICENSE is MIT but carries Expo's "650 Industries" copyright line. **Do not depend on the npm package long-term.**

**Correction to an earlier lead:** SceneView 2.x did *not* end at 2.3.0 - **2.3.3** (2026-01-13, ARCore 1.52.0, Kotlin 2.2.21) and the 3.x line (3.6.2, ARCore 1.53.0) exist; only 4.x needs the ruled-out toolchain raise. ARCore 1.48->1.56 is a one-line Gradle bump (release notes 1.49-1.56 remove no APIs).

**Effort:** trial 0.5-1 day; vendoring to the acceptance bar 3-5 dev-days (vs 6-9 for a from-scratch module), with Filament (~7.4 MB arm64) as the extra APK cost.

## Comments
