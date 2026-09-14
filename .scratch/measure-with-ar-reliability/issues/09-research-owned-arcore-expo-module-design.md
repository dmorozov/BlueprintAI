# 09 — Research: design for an owned Kotlin Expo Module over ARCore 1.56 (the AR engine replacement)

Type: research
Mode: AFK
Status: resolved (2026-09-14)
Blocked by: —
Part of: ../map.md

## Question

Produce a concrete design for a **local Expo Module** (`create-expo-module --local`, e.g. `modules/expo-arcore-view`) that implements the *AR engine* contract this app needs — nothing more:

- An `ExpoView` hosting the camera background rendered with Google's `hello_ar_kotlin` `BackgroundRenderer` (Apache-2.0), plus simple tap markers; no 3D scene graph.
- ARCore `Session` lifecycle bound to the host Activity (Expo Modules `OnActivityEntersForeground/Background`, view attach/detach), including `ArCoreApk.requestInstall` handling and clean camera release; the **#1762 sensor workaround** applied before session creation.
- Events: `onTrackingChanged` (state + `TrackingFailureReason`), `onSessionError` (every `ArStatus` surfaced with a human-readable reason), `onReady`.
- `hitTest(x, y)` returning plane, feature-point **and Depth-API `DepthPoint`** hits (`Config.DepthMode.AUTOMATIC` when `isDepthModeSupported`), with hit type and distance.
- `captureFrame()` for reference photos (from the AR camera image; format/resolution) so expo-camera never has to coexist with the session.
- iOS: a stub `ExpoView` ("AR not available yet") so `ios/` compiles.

Answer, citing the Expo Modules API docs (https://docs.expo.dev/modules/ — native view tutorial, config plugins/mods) and ARCore 1.56 docs:
1. View surface choice inside a Fabric / expo-router stack: `GLSurfaceView` vs `TextureView` z-order and back-navigation behaviour; threading between the GL thread and JS events. **Compare three rendering designs:**
   - **A — GL (hello_ar):** `BackgroundRenderer` on a GLSurfaceView, default `TextureUpdateMode.BIND_TO_TEXTURE_EXTERNAL_OES`.
   - **B — GL-free (verified possible in principle, UNVERIFIED in combination):** since ARCore 1.37, `Config.TextureUpdateMode.EXPOSE_HARDWARE_BUFFER` (API 27+) lets `Session.update()` run with **no EGL/GL context** (Google's `hello_ar_vulkan_c` sample, pinned to 1.56.0, calls update from a plain SurfaceView thread with no GLES code). Combined with **Shared Camera** (Camera2 — the app owns the `CameraDevice`, adds its own preview `Surface` alongside ARCore's surfaces), the module could show the camera via an ordinary Camera2 preview on a SurfaceView/TextureView and use ARCore purely for poses and hit-tests — zero OpenGL code, simpler z-order. Check whether Shared Camera and `EXPOSE_HARDWARE_BUFFER` can be combined, and what Shared Camera costs (Camera2 boilerplate, focus/exposure ownership, ARCore's own ImageReader).
   - **C — SceneView 2.3.3** (View-based, ARCore 1.52.0, kotlin-stdlib 2.2.21, no compileSdk floor — fits today's toolchain; last release 2026-01-13, the maintained 4.x line is Compose-only and needs compileSdk 37 / Kotlin 2.4.10). Maintenance risk vs. convenience.
2. Config plugin: CAMERA permission, `com.google.ar.core` `meta-data` (required vs optional), minSdk, `HIGH_SAMPLING_RATE_SENSORS`, Gradle dependency `com.google.ar:core:1.56.0` (verified: no Kotlin dependency, no `minCompileSdk` stamp — compileSdk 36 is fine). **Coexistence with Viro:** `@reactvision/react-viro` bundles `arcore_client/core-1.43.0.aar` as a project dependency, so adding `com.google.ar:core:1.56.0` yields duplicate classes while Viro is installed (ticket 11). Design how the A/B period works: exclude/swap Viro's `arcore_client` (ticket 07's recipe), or keep the owned module on a branch without Viro until ticket 14 decides.
3. Dev-build and EAS implications of a local module with native code; how `expo prebuild` picks it up.
4. A test plan on the S22U (the acceptance bar), the biggest unknowns to spike first (ticket 13), effort estimate (days) and risks.

Findings go to `docs/research/owned-arcore-expo-module-design.md` on branch `research/owned-arcore-expo-module-design` (link it here). Primary sources only; mark UNVERIFIED anything not confirmed.

## Answer

Report: `docs/research/owned-arcore-expo-module-design.md` on branch `research/owned-arcore-expo-module-design`. A skeptic pass reviewed it against primary sources.

**Design: feasible and recommended** - a local Expo Module `modules/expo-arcore-view` whose `ExpoView` hosts a **GLSurfaceView** driven by Google's `hello_ar_kotlin` `SampleRender`/`BackgroundRenderer` (GLES 3, `setPreserveEGLContextOnPause(true)`, continuous render), keeping the default Z-below order so RN overlays composite over SurfaceView's hole punch. TextureView is the fallback only if the spike shows transition artifacts. (Design B - GL-free via `EXPOSE_HARDWARE_BUFFER` + Shared Camera - was not selected: the GL path is what Google's sample and its Apache-2.0 code give for free.)

**Session lifecycle is view-owned:** attach/visible + activity resumed -> permission check -> `ArCoreApk.requestInstall` -> #1762 no-op sensor hold -> `Session()` -> configure (`DepthMode.AUTOMATIC` when `isDepthModeSupported`) -> `resume()` with `CameraNotAvailableException` retried 3x -> `onReady` on first frame; pause on detach/hidden/background; `close()` on a background scope from `OnViewDestroys`. **Every exception surfaces as `onSessionError`** - the Java API throws, so nothing can be silently swallowed (the exact failure mode of the current engine).

**Threading:** Expo view `AsyncFunction`s are forced onto the main queue by expo-modules-core, so `hitTest`/`captureFrame` hop to the GL thread via `GLSurfaceView.queueEvent` and post results back.

**`hitTest(x,y)`** converts dp->px, runs against the current frame, and returns plane / point / **DepthPoint** hits with kind, position and distance. **`captureFrame()`** renders the camera texture into an FBO and reads it back (ARCore's CPU image is only 640x480; the GPU texture is ~1920x1080), returning the shape `preparePhoto()` already consumes - which is how reference photos stop needing expo-camera at all.

**Config plugin** (`app.plugin.js`, **must be listed explicitly** in app.json - autolinking never applies a local module's plugin): CAMERA, HIGH_SAMPLING_RATE_SENSORS (normal, no prompt), `meta-data com.google.ar.core=optional`. Gradle: `com.google.ar:core:1.56.0` - POM depends only on `androidx.annotation:1.3.0`, no `aar-metadata` (no `minCompileSdk`), minSdk 24 = Expo default; its manifest `targetSdk 37` is harmless because the app sets 36. **Confirms ticket 11: no toolchain change needed.**

**Effort:** 1.5-2 days of spikes + **6-9 dev-days** to the acceptance bar, +1-2 days to remove Viro (~2-3 calendar weeks for one developer with the phone available).

**Gate:** do not start before spike S1 - unmodified `hello_ar_kotlin` on the S22U (ticket 02). If the sample cannot track on this firmware, no engine choice helps.

## Comments
