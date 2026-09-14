# AR engine alternatives for BlueprintAI (Expo SDK 57 / RN 0.86, Android-first)

Research date: 2026-09-14. Scope: replace `@reactvision/react-viro` 2.58.1 for "AR tap-to-trace" (camera background + 6-DoF tracking + tracking-state callback + screen-point hit-test in meters + simple markers). No paid AI APIs; on-device ML acceptable; a self-hosted MoGe-2 service already exists as a secondary path.

Legend: **VERIFIED** = read from a primary source (official docs, GitHub repo/API, npm registry, Maven artifact). **UNVERIFIED** = inferred, from secondary sources, or not checked on a device.

---

## 0. Bottom line

1. **Best fit: a small custom Expo Module (Kotlin) that wraps ARCore 1.56.0 directly**, rendering the camera with the `hello_ar_kotlin` sample's `BackgroundRenderer` on a `GLSurfaceView` inside an `ExpoView`. Everything the app needs (camera background, tracking state, `Frame.hitTest`, markers) is ~15 sample files plus ~400 lines of glue. Estimated 3–6 dev-days to a working prototype, 1–2 weeks hardened. It is the only option whose every dependency is Google-maintained and whose ARCore version is current (1.56.0, published 2026-09-04, `targetSdk 37`, 16 KB-aligned).
2. **Cheapest experiment first: `@stewmore/expo-ar` 0.2.2** (MIT, Expo Modules API, SceneView 2.3.0 + ARCore 1.48.0, `raycast(x,y)` + `onTrackingStateChange`, ships a config plugin, requires Expo SDK 56+). It already does 90% of what BlueprintAI needs, but it is a 3-star, single-maintainer project with 17 open issues and no commits since 2026-06-11. Worth a half-day trial; not something to depend on long-term without forking.
3. **WebXR in `react-native-webview` is not viable**: Chrome Platform Status lists no WebView milestone for the WebXR Device API, the AR Module, Hit-test, or DOM Overlay; the 2020 intent said "WebView support is planned" and it never shipped; a Google maintainer stated "WebXR is not allowed in a WebView". Chrome Custom Tabs/TWA run WebXR, but the AR session owns the screen, so RN cannot draw the tap-to-trace UI over it.
4. **On-device monocular depth cannot replace ARCore tracking** for floor plans. Best small metric model numbers (Depth Anything V2 ViT-S, in-domain NYU: AbsRel 0.073) mean roughly ±7% per measurement (~±30 cm on a 4 m wall) with scale/intrinsics ambiguity and no multi-frame registration. Fine as an "assist" (as MoGe-2 already is), not as the measurement source.
5. **Headless ARCore (no GL rendering) is not officially supported**: `Session.update()` throws `MissingGlContextException` "if there is no OpenGL context available", and the C API also returns `AR_ERROR_TEXTURE_NOT_SET`. An offscreen pbuffer EGL context + dummy external texture is a plausible workaround (UNVERIFIED), but it does not simplify the module much because ARCore also owns the camera; the Shared Camera mode is Camera2-only and its sample still renders via GL.
6. **Finding that changes the diagnosis**: both ARCore 1.56.0 *and* Viro's bundled 1.43.0 `libarcore_sdk_c.so` (arm64) are 16 KB page-aligned (checked from the Maven AARs), so 16 KB paging is not the cause of the black camera. The first thing to test on the S22 Ultra is Google's own `hello_ar_kotlin` (see §9).

---

## 1. Baseline facts (all VERIFIED unless marked)

### ARCore SDK for Android
| Fact | Value | Source |
|---|---|---|
| Latest client SDK on Google Maven | **1.56.0** (metadata `lastUpdated` 2026-08-31; 1.55.0 was never published) | https://dl.google.com/dl/android/maven2/com/google/ar/core/maven-metadata.xml |
| 1.56.0 release | 2026-09-04; "ARCore's `targetSdkVersion` has been updated to Android API level 37"; new `acquireDepthImageMeters` / `acquireRawDepthImageMeters` (float meters) | https://github.com/google-ar/arcore-android-sdk/releases (via API) |
| Android 16 | 1.52.0 (2025-12-12): "Verified this version of ARCore is compatible with Android 16 MR1" | same |
| Prior targetSdk bumps | 1.50.0 → API 36 (2025-07-11); 1.46.0 → API 35 (2024-10-10) | same |
| 1.56.0 AAR manifest | `minSdkVersion="24"`, `targetSdkVersion="37"`; no `aar-metadata.properties` → no `minCompileSdk` constraint imposed on the app | downloaded `core-1.56.0.aar` |
| 16 KB page size | `libarcore_sdk_c.so` / `libarcore_sdk_jni.so` (arm64-v8a) `PT_LOAD p_align = 16384` in **both 1.56.0 and 1.43.0** as currently served by Google Maven. A repo contributor stated "upgrade to at least 1.46, which is the first one that supports Android 15's new 16 KB page size" (issue #1685, 2025-01-21); the 1.43.0 artifact on Maven today is nonetheless aligned (possibly re-published; UNVERIFIED why) | ELF header check of downloaded AARs; https://github.com/google-ar/arcore-android-sdk/issues/1685 |
| Kotlin | `hello_ar_kotlin` sample: `compileSdk 37`, `minSdk 24`, `targetSdk 37`, Java 17, `com.google.ar:core:1.56.0`, `de.javagl:obj:0.4.0` | https://github.com/google-ar/arcore-android-sdk/blob/main/samples/hello_ar_kotlin/app/build.gradle |
| Manifest requirements | `<uses-permission android:name="android.permission.CAMERA"/>`; AR-required: `<uses-feature android:name="android.hardware.camera.ar"/>` + `<meta-data android:name="com.google.ar.core" android:value="required"/>`; AR-optional: `value="optional"` and **no** `uses-feature`. Runtime: `ArCoreApk.checkAvailability()` then `ArCoreApk.requestInstall()` before `Session` | https://developers.google.com/ar/develop/java/enable-arcore |
| Hit test | `Frame.hitTest(xPx, yPx)` returns "an ordered list of intersections with scene geometry, nearest hit first" over `Plane`, `Point`, `DepthPoint` (depth enabled); `hitTestInstantPlacement` needs `InstantPlacementMode.LOCAL_Y_UP` + TRACKING. Pose in meters via `HitResult.getHitPose()` | https://developers.google.com/ar/reference/java/com/google/ar/core/Frame |
| Sample hit filter | `Plane → isPoseInPolygon && distanceToPlane > 0; Point → orientationMode == ESTIMATED_SURFACE_NORMAL; InstantPlacementPoint/DepthPoint → true` | `HelloArRenderer.kt` |
| Depth API | Depth-from-motion, no ToF needed; best 0.5–5 m; "Surfaces with few or no features, such as white walls, will be associated with imprecise depth"; depth hit-tests "work even on non-planar and low-texture areas". **Samsung Galaxy S22 Ultra 5G: Depth API supported** | https://developers.google.com/ar/develop/java/depth/overview ; https://developers.google.com/ar/devices |
| `Session.update()` | "This call may cause off-screen OpenGL activity… Throws `CameraNotAvailableException`… `SessionPausedException`… **`MissingGlContextException` if there is no OpenGL context available**." C API adds **`AR_ERROR_TEXTURE_NOT_SET`** | https://developers.google.com/ar/reference/java/com/google/ar/core/Session ; `libraries/include/arcore_c_api.h` |
| Texture modes | Default `BIND_TO_TEXTURE_EXTERNAL_OES` (needs `setCameraTextureName(s)`); `EXPOSE_HARDWARE_BUFFER` (API 27+): camera image via `Frame.getHardwareBuffer()`, texture names ignored, "client app is responsible for binding it to a GL_TEXTURE_EXTERNAL_OES (OpenGL ES) or VkImage (Vulkan)". Docs do not say whether a GL context is still required for `update()` in this mode (UNVERIFIED) | https://developers.google.com/ar/reference/java/com/google/ar/core/Config.TextureUpdateMode ; https://developers.google.com/ar/develop/java/vulkan |
| Shared Camera | `Session(context, EnumSet.of(Session.Feature.SHARED_CAMERA))`; **Camera2 only**; ARCore needs "1x YUV CPU stream (640x480) for motion tracking" + "1x GPU stream, typically 1920x1080"; app "must not call setRepeatingRequest" while ARCore is active; `SharedCamera.setAppSurfaces()` — "One additional surface with a CPU resolution is guaranteed"; feature is current (1.51.0 updated its sample). The `shared_camera_java` sample still draws the preview via `GLSurfaceView` + `BackgroundRenderer` in both AR and non-AR modes and calls `update()` on the GL thread | https://developers.google.com/ar/develop/java/camera-sharing ; https://developers.google.com/ar/reference/java/com/google/ar/core/SharedCamera ; `SharedCameraActivity.java` |

### Expo SDK 57 / RN 0.86
| Fact | Value | Source |
|---|---|---|
| SDK 57 ↔ RN | React Native **0.86** | https://docs.expo.dev/versions/v57.0.0/ |
| New Architecture | "SDK 55 and later run entirely on the New Architecture. The New Architecture is always enabled and cannot be disabled." Interop layers for legacy modules/view managers remain ("the interop is not perfect… particularly those shipping… custom view managers") | https://docs.expo.dev/guides/new-architecture/ |
| Expo Modules API + new arch | "all modules written using the Expo Modules API support the New Architecture by default"; performance comparable to Turbo Modules (JSI) | same; https://docs.expo.dev/modules/overview/ |
| Native views | `View(MyView::class) { Prop(...); Events(...); AsyncFunction(...) }`; view extends `ExpoView`; events via `val onX by EventDispatcher()`; JS side `requireNativeViewManager('Name')` | https://docs.expo.dev/modules/native-view-tutorial/ ; https://docs.expo.dev/modules/module-api/ |
| Module lifecycle | `OnCreate`, `OnDestroy`, `OnActivityEntersForeground/Background`; `ReactActivityLifecycleListener` (onCreate/onResume/onPause/onDestroy/onNewIntent/onBackPressed) auto-registered via `*Package.kt` | https://docs.expo.dev/modules/android-lifecycle-listeners/ |
| Local module | `npx create-expo-module@latest --local` → `modules/<name>/{android,ios,src,expo-module.config.json}`; add Gradle deps in `modules/<name>/android/build.gradle`; dev build required | https://docs.expo.dev/modules/get-started/ |
| Config plugins | `withAndroidManifest` (xml2js JSON), `withAppBuildGradle`, `withProjectBuildGradle`, `withGradleProperties`, `withMainActivity`… ; a local package ships `app.plugin.js`; mods run only during `npx expo prebuild` | https://docs.expo.dev/config-plugins/mods/ ; https://docs.expo.dev/config-plugins/introduction/ |
| Android defaults | `compileSdkVersion 36`, `targetSdkVersion 36`, `minSdkVersion 24` (fallbacks in `ExpoModulesCorePlugin.gradle` @ `sdk-57`); Kotlin fallback 2.0.21 (RN 0.86 gradle-plugin: Kotlin **2.1.20**, AGP 8.12.0); RN community template 0.86: compileSdk 36, NDK 27.1.12297006 | expo/expo `sdk-57` branch; react-native `0.86-stable` `packages/gradle-plugin/gradle/libs.versions.toml` |
| RN 0.86 | Released 2026-06-11; no breaking changes; `ViewUtil.getUIManagerType` deprecated "as part of the removal of the legacy architecture" | https://reactnative.dev/blog/2026/06/11/react-native-0.86 |

### Current engine: `@reactvision/react-viro`
- Latest **2.58.1** (2026-08-18), MIT, `peerDependencies`: `react-native >=0.83.0 <0.87.0`, `expo >=55 <58`; README: "New Architecture (Fabric) required". No `codegenConfig` (legacy view managers via interop). (npm registry)
- Bundles **`com.google.ar:core:1.43.0`** (`android/viro_bridge/build.gradle`, 2024-05-14 SDK). (GitHub code search)
- Issue #499 (2026-07-21, Galaxy S24 / Android 16 / Viro 2.57.4): "Camera texture never connects to ARCore session — background permanently black", `TRACKING_UNAVAILABLE` forever, other AR apps work. Maintainer (2026-08-24): "We've been unable to reproduce this issue… if we're able to get some logcat outputs…". Open.
- Issue #513 (2026-08-07, Galaxy A54 / Viro 2.43.6 / SDK 54): same symptom. Maintainer: upgrade to 2.58.5 (Expo 56/57). Open. (Note: npm latest is 2.58.1; "2.58.5" in the comment is UNVERIFIED as published.)
- Release notes: 2.57.2 finished 16 KB alignment (NDK r27); 2.57.5 removed a "black-passthrough" workaround after "the renderer began handling camera-texture binding natively".

---

## 2. Option A — Custom Expo Module wrapping ARCore directly (Kotlin)

### Minimal architecture
```
modules/arcore-trace/
  expo-module.config.json        { "platforms": ["android"], "android": { "modules": ["expo.modules.arcoretrace.ArTraceModule"] } }
  app.plugin.js                  withAndroidManifest: CAMERA permission, uses-feature android.hardware.camera.ar,
                                 meta-data com.google.ar.core=required (or optional)
  android/build.gradle           implementation 'com.google.ar:core:1.56.0'
  android/src/main/java/expo/modules/arcoretrace/
    ArTraceModule.kt             Module { Name("ArTrace"); View(ArTraceView::class) { Prop("planeMode"); Prop("depth");
                                   Events("onTrackingState","onHit","onError","onReady");
                                   AsyncFunction("hitTest") { view: ArTraceView, x: Float, y: Float -> ... } } }
    ArTraceView.kt               ExpoView hosting a GLSurfaceView (or TextureView + own EGL) ; owns Session lifecycle
    ArTraceRenderer.kt           GLSurfaceView.Renderer: setCameraTextureNames, session.update(), displayRotation,
                                 backgroundRenderer.drawBackground, marker draw, hit-test queue
    samplerender/*               copied from arcore-android-sdk samples/hello_ar_kotlin (Apache-2.0)
    helpers/*                    DisplayRotationHelper, TrackingStateHelper, CameraPermissionHelper, ARCoreSessionLifecycleHelper
  src/ArTraceView.tsx            requireNativeViewManager('ArTrace') + typed props/events
```

Files actually needed from the sample (sizes from the repo tree): `BackgroundRenderer.java` (10.5 KB), `SampleRender.java` (5.4 KB), `Shader.java` (23 KB), `Texture.java` (6.8 KB), `Mesh.java` (7.4 KB), `Framebuffer.java` (6.1 KB), `VertexBuffer/IndexBuffer/GpuBuffer/GLError` (~13 KB), `DisplayRotationHelper.java` (5.9 KB), `TrackingStateHelper.java` (3.5 KB), `CameraPermissionHelper.java` (2.3 KB), `ARCoreSessionLifecycleHelper.kt` (5.2 KB), plus the sample's GLSL shaders under `assets/shaders/`. `PlaneRenderer` (13 KB) is optional (visual plane feedback). Markers: a ~100-line unlit point/quad shader, or reuse `Mesh` with a tiny OBJ.

### What the JS contract looks like
- Props: `planeDetection: 'none'|'horizontal'|'vertical'|'both'`, `depth: boolean`, `instantPlacement: boolean`, `markers: {id, position:[x,y,z]}[]`.
- Events: `onTrackingState({state:'TRACKING'|'PAUSED'|'STOPPED', reason})` (from `Camera.trackingState` / `trackingFailureReason` on each frame, debounced), `onReady`, `onError({code})` (ARCore install/unavailable/camera exceptions).
- `hitTest(x, y): Promise<{position:[x,y,z], normal?, kind:'plane'|'depth'|'point'|'instant'} | null>` — queue the request, execute on the GL thread inside `onDrawFrame` with the latest `Frame`, resolve the promise (ARCore hit tests need the current frame; `AsyncFunction` on views is dispatched on the main queue per Expo docs, so hop to the GL thread).

### Toolchain compatibility (VERIFIED)
- ARCore 1.56.0 AAR: minSdk 24, no `minCompileSdk` requirement → builds with Expo SDK 57's default `compileSdk 36`. Its manifest `targetSdkVersion 37` does not override the app's declared `targetSdk` (release note only warns apps that omit it).
- Kotlin: ARCore is a Java AAR; Expo SDK 57's Kotlin (2.0.21 fallback / RN 2.1.20) is fine.
- Expo Modules API views are Fabric-compatible by construction.

### Rendering-backend choices
| Backend | Pros | Cons / risks |
|---|---|---|
| **A1. `hello_ar_kotlin` GL (`GLSurfaceView` + `BackgroundRenderer`)** — recommended | Google-maintained reference code for exactly this SDK version; ~15 files; Apache-2.0; no third-party AAR | You own ~1k lines of GL plumbing; `GLSurfaceView` z-order inside RN view tree (`setZOrderMediaOverlay`, or switch to `TextureView` + own EGL) — UNVERIFIED with expo-router transitions |
| A2. SceneView **4.35.0** (Maven Central 2026-09-11; README says 4.36.0) | Active (pushed 2026-09-14, 1.3k stars, Apache-2.0); `ARSceneView` composable with `onSessionUpdated(session, frame)` → `frame.hitTest`; ARCore **1.54.0**, Filament 1.72.1 | **Compose-only** ("exclusively a Jetpack Compose API") → needs `ComposeView` inside `ExpoView`; AAR `minCompileSdk=37`; POM requires **Kotlin stdlib 2.4.10** and Compose BOM 2026.06.01 → almost certainly incompatible with Expo SDK 57's Kotlin 2.0/2.1 toolchain without bumping `kotlinVersion`/`compileSdkVersion` via `expo-build-properties` (UNVERIFIED whether expo-modules-core builds under Kotlin 2.4) |
| A3. SceneView **2.3.0** (2025-04-19; what `expo-ar` uses) | Classic `ARSceneView` View; Kotlin 2.0.21; no compileSdk constraint; ARCore **1.48.0**; lifecycle-driven session | Frozen line (no releases since 2.3.0); ARCore 1.48 predates the "verified with Android 16 MR1" 1.52 release (client/runtime compatibility UNVERIFIED on Android 16) |
| A4. Filament directly (v1.76.1, 2026-09-09) | Production renderer | Filament ships no ARCore sample (only `sample-hello-camera` via Camera2 `Stream`); you would re-implement SceneView's ARCore↔Filament bridge — more work than A1 for zero benefit here |

### Effort estimate (A1)
- Prototype (camera + tracking event + hit-test promise + markers, config plugin, TS wrapper): **3–6 dev-days**.
- Hardening (ARCore install flow via `ArCoreApk.requestInstall` from the Expo activity, permission flow, rotation/`setDisplayGeometry`, pause/resume with expo-router, error events, depth toggle, instant-placement fallback, `TrackingFailureReason` UX): **+1 week**.
- Risk: low-to-medium; every dependency is Google's and current.

---

## 3. Option B — WebXR via `react-native-webview` (not viable)

VERIFIED evidence:
- Chrome Platform Status (API): WebXR Device API — Chrome desktop 79, Android 79, **WebView: none**. WebXR AR Module — Android 81, **WebView: none**. WebXR Hit-test — 81, **WebView: none**. WebXR DOM Overlay — 83, WebView none. WebXR Depth API — 90, WebView none. https://chromestatus.com/feature/5680169905815552 , /5450241148977152 , /4755348300759040 , /6048666307526656 , /5742647199137792
- blink-dev "Intent to Implement and Ship: WebXR AR Module" (2020-01-15): "The WebView support is planned." — never shipped per the above. https://groups.google.com/a/chromium.org/g/blink-dev/c/BXxS2U5EaN0/m/cSVmzxSmDQAJ
- Google `model-viewer` maintainer (2022): "WebXR is not allowed in a WebView. However, it is enabled in the new and improved replacement: WebLayer" (WebLayer "hasn't become a public API yet"). https://github.com/google/model-viewer/discussions/3096
- `react-native-webview` 14.0.1 (2026-06-20) wraps Android System WebView (npm registry).

Chrome Custom Tabs / Trusted Web Activity: they run in Chrome, so `immersive-ar` + hit-test work there, but an immersive session takes over the display; the only UI allowed is the page's own DOM Overlay. RN cannot render over it, receive the taps, or stream results back except through URL/deep-link/postMessage round-trips. That would mean rewriting the tap-to-trace screen in web tech and losing RN control — **conclusion: not viable** for this app. (Reasoning; no primary source claims otherwise.)

---

## 4. Option C — Other React Native AR libraries (Sept 2026)

| Package | Latest / date | Maintenance | New arch | Engine / ARCore | License | Hit-test | Verdict |
|---|---|---|---|---|---|---|---|
| `@reactvision/react-viro` | 2.58.1 / 2026-08-18 | Active (pushed 2026-09-14, 24 open issues) | Legacy view managers via interop (no codegen) | Own renderer, ARCore **1.43.0** | MIT | Yes | Broken on user's device (#499/#513 unresolved) |
| **`@stewmore/expo-ar`** | 0.2.2 / 2026-06-11 | 1 maintainer, 3 stars, 17 open issues, last commit 2026-06-11 | Expo Modules API (yes by construction) | SceneView 2.3.0 + ARCore **1.48.0**; `ExpoArView extends ExpoView`, ~550 lines | MIT | `raycast(x,y)` → `frame.hitTest` filtered to `Plane/Point/DepthPoint`; `onTrackingStateChange`, `onReady`, `onTap`, anchors; config plugin `app.plugin.js`; Expo SDK 56+, dev builds only | **Try first (0.5 day)**; fork if adopted |
| `@sceneview-sdk/react-native` | 4.31.0 / 2026-08-17 | Same org as SceneView, "Status: Alpha" | Not Fabric ("traditional view managers"; Android via Compose) | SceneView 4.x | Apache-2.0 | Partial (Android reports model names only); tracking state and anchors **not exposed** | Not fit |
| `react-native-ar-viewer` | 0.1.17 / 2023-03-21 | Dead | No | Sceneform (archived by Google 2021) | MIT | No (model viewer) | No |
| `react-native-arcore` | 0.0.1 / 2017-08-29 | Dead | No | — | Apache-2.0 | — | No |
| `ar-core-react-native` | 1.2.4 / 2021-05-11 | Dead | No | — | — | — | No |
| `@azesmway/react-native-unity` | 1.1.1 / 2026-08-07 | Active | `codegenConfig` present | Unity as a Library + AR Foundation (full ARCore) | MIT (Unity runtime under Unity's own terms — UNVERIFIED cost tier) | Yes (AR Foundation raycast) — but all AR logic lives in C#, RN↔Unity via string messages | Heavy: Unity project + build pipeline, large APK (UNVERIFIED size), two toolchains. Only if you also want a 3D editor |
| Niantic Lightship ARDK | 3.17 "last full release of the 3.x version" (docs) | Unity/AR Foundation only | — | — | Niantic terms | — | No RN path; exclude |
| 8th Wall | WebAR; commercial license US$700/project/month (2024 blog); hosted platform reportedly retired 2026-02-28 (UNVERIFIED) | — | — | — | Paid | — | Excluded (paid, web-only, and WebView-blocked per §3) |
| "expo-arcore" / "expo-ar" (Expo-official) | Not found on npm search (`arcore`, `sceneview`) | — | — | — | — | — | Does not exist |

Sources: npm registry JSON for each package; https://github.com/stewartmoreland/expo-ar (build.gradle, `ExpoArView.kt`); https://github.com/sceneview/sceneview ; https://www.nianticspatial.com/docs/nsdk/3.17.0/ (via search snippet).

---

## 5. Option D — Non-AR on-device measurement with a local model

**Verdict: not a realistic replacement for tracked hit-tests; usable only as an assist.**

What exists (VERIFIED):
- **Depth Anything V2 metric** (official `depth-anything/Depth-Anything-V2-Metric-Indoor-{Small,Base,Large}-hf`): Small = 24.8 M params, fine-tuned on synthetic Hypersim, `max_depth = 20 m` indoor. Paper (arXiv 2406.09414, Table 4a, *in-domain* NYU-D fine-tune): ViT-S AbsRel **0.073**, δ1 0.961; ViT-B 0.063; ViT-L 0.056. The released Hypersim-fine-tuned (zero-shot) models have **no published real-world metric numbers**. Only Safetensors/Transformers are published officially; HF search shows no TFLite/CoreML/ExecuTorch metric exports, only community ONNX (`77ukhtar/depth-anything-v2-metric-onnx`, quality UNVERIFIED). Qualcomm AI Hub ships DA-V2 **Small relative** (inverse) depth only: 24.7 M params, 94.3 MB fp32, TFLite/ONNX/QNN, 518×518, ~12–25 ms on Snapdragon 8 Elite Gen 5 / Dragonwing — useful for speed expectations, useless for meters. https://huggingface.co/qualcomm/Depth-Anything-V2 ; https://github.com/DepthAnything/Depth-Anything-V2/blob/main/metric_depth/README.md
- **MoGe-2** (microsoft/MoGe, MIT + DINOv2 Apache-2.0): `moge-2-vits-normal` **35 M** params, `moge-2-vitb-normal` 104 M, `moge-2-vitl` 326 M; all metric-scale. Author-published ONNX: `Ruicheng/moge-2-vits-normal-onnx` (`model.onnx` **140.9 MB** fp32, 2025-07-11), outputs affine point map + normal + mask + metric scale; **focal/shift recovery and reprojection "cannot be exported to ONNX"** and must be re-implemented on device. Paper (arXiv 2507.02546) reports only ViT-L metric point-map errors (NYUv2 Rel 4.44 %, iBims-1 5.63 %) and A100 latency (29–39 ms); **no ViT-S accuracy or mobile numbers** (UNVERIFIED on phone). MoGe-3 (370 M / 1.25 B) is now listed — server-only. https://github.com/microsoft/MoGe ; https://github.com/microsoft/MoGe/blob/main/docs/onnx.md
- **Runtimes for RN**: `react-native-executorch` 0.10.2 (2026-09-11, codegen, Expo deps), `onnxruntime-react-native` 1.24.3 (2026-03-05; Android EPs NNAPI/XNNPACK/QNN), `react-native-fast-tflite` 3.0.1 (2026-04-21, Nitro, GPU/NNAPI delegates, Expo config plugin). Conversion of the metric DA-V2 Small to LiteRT via ai-edge-torch is plausible (standard ViT/DPT ops) but UNVERIFIED.
- **ML Kit**: no depth/measurement/3D API. **MediaPipe Tasks**: no depth task; Objectron (3D pose) "Support ended" 2023-03-01. https://developers.google.com/ml-kit ; https://developers.google.com/edge/mediapipe/solutions/guide
- **ARCore Depth API** needs an ARCore session anyway (§1) — but on the S22 Ultra it *is* supported, and `DepthPoint` hit results are exactly what fixes tapping corners on featureless white walls. This is an argument for Option A with `Config.DepthMode.AUTOMATIC`, not for a standalone model.
- **Apple RoomPlan**: iOS 16+, LiDAR only; outputs walls/doors/windows with dimensions (§7).

Why a single-image model cannot give floor-plan-grade metric dimensions:
1. Scale ambiguity: metric models hallucinate scale from priors; MoGe-2 itself lists "ambiguity in real-world metric scale can also lead to deviations in out-of-distribution scenarios". Camera intrinsics help but Android exposes `LENS_INTRINSIC_CALIBRATION` only on some devices (UNVERIFIED for S22 Ultra); ARCore's `Camera.getImageIntrinsics()` needs the session you are trying to avoid.
2. Error budget: ~5–7 % relative error at best → ±20–30 cm on a 4 m wall, worse at corners/edges and on textureless walls; users of floor-plan tools expect ±2–5 cm.
3. No registration: the app needs corners across many views in one frame of reference. Without 6-DoF tracking that is multi-view SfM — not feasible on-device inside an Expo app; ARCore already solves this.
4. Realistic use: keep the existing MoGe-2 server path (and optionally a small on-device model) to *suggest* wall lines/heights or sanity-check a trace, never as the measurement source.

---

## 6. Option E — ARCore for tracking only, camera shown by something else ("Measure-style")

VERIFIED constraints:
- `Session.update()` requires a current OpenGL context on the calling thread (`MissingGlContextException`) and, in default texture mode, a texture (`AR_ERROR_TEXTURE_NOT_SET`). ARCore opens the camera itself (non-shared mode), so `expo-camera`/CameraX cannot hold the camera concurrently.
- Shared Camera: Camera2 only; the app may add extra output surfaces (`setAppSurfaces`, "one additional surface with a CPU resolution is guaranteed") but must not call `setRepeatingRequest` while ARCore is active; Google's own sample still renders the preview through GL and calls `update()` on the GL thread.
- `EXPOSE_HARDWARE_BUFFER` (API 27+) delivers each frame as an `AHardwareBuffer`; the app must bind it to a GL external texture or a `VkImage`. Docs are silent on whether `update()` still needs a GL context in this mode.
- Headless requests to Google are unanswered (issue #1375, open since 2022-04-28: "Currently it seems that a GLContext is required but there's no good documentation…").

Assessment:
- "Plain CameraX preview + ARCore for poses" is **not possible** (camera ownership). "Camera2 preview surface via Shared Camera + ARCore poses + pbuffer EGL for `update()`" is *theoretically* possible but UNVERIFIED, adds Camera2 session management, is limited to a CPU-resolution app surface, and ends up **more** code than A1. Not recommended.
- A pbuffer EGL context + dummy `GL_TEXTURE_EXTERNAL_OES` (~40 lines) is a cheap trick if you ever need tracking with no visible camera (e.g., background pose logging) — test before relying on it.

---

## 7. iOS parity (brief)

- Same Expo Module shape with ARKit: `ARSession.raycast(_:)` (iOS 13+) returns `[ARRaycastResult]` "sorted from nearest to furthest" with `worldTransform`; render the camera with `ARSCNView`/`ARView`. `@stewmore/expo-ar` already bridges ARKit + ARCore behind one TypeScript contract (worth reading even if not adopted). https://developer.apple.com/documentation/arkit/arsession/raycast(_:)
- **RoomPlan** (iOS 16+, LiDAR devices only): interactive scan producing walls, doors, windows, openings with dimensions, exportable as USD. Ideal for LiDAR iPhones as a "scan the whole room" mode; non-LiDAR iPhones fall back to tap-to-trace. https://developer.apple.com/documentation/roomplan

---

## 8. Comparison table

| Option | Maturity / maintenance | New-arch compat | Expo integration | ARCore version | License | Effort | Key risks |
|---|---|---|---|---|---|---|---|
| **A1. Custom Expo Module + `hello_ar_kotlin` GL** | Google sample code, current | Native (Expo Modules API) | Local module + `app.plugin.js` | **1.56.0** | Apache-2.0 sample / MIT app | 3–6 d prototype, +1 wk hardening | GLSurfaceView z-order in RN tree; you own GL plumbing; ARCore install flow in dev client |
| A2. Custom Expo Module + SceneView 4.35 | Active, Compose-only | Native | Local module; needs `compileSdk 37` + Kotlin 2.4.10 | 1.54.0 | Apache-2.0 | 2–5 d if toolchain aligns | Likely toolchain blocker with Expo SDK 57 (Kotlin 2.0/2.1) — UNVERIFIED |
| A3. Custom Expo Module + SceneView 2.3.0 | Frozen since 2025-04 | Native | Local module | 1.48.0 | Apache-2.0 | 2–4 d | Old ARCore client on Android 16 (UNVERIFIED); no upstream fixes |
| **C. `@stewmore/expo-ar` 0.2.2** | Tiny, single maintainer, stale 3 mo | Native | Drop-in (plugin included), SDK 56+ | 1.48.0 (via SceneView 2.3.0) | MIT | 0.5 d trial; fork ≈ A3 | Bus factor; same Android 16 unknown as A3 |
| Viro 2.58.1 (status quo) | Active but issue unresolved | Interop (legacy VMs) | Plugin | 1.43.0 | MIT | 0 | Black camera on Samsung/Android 16; maintainers cannot reproduce |
| B. WebXR in WebView | — | — | — | — | — | — | **Not supported in Android WebView** (Chrome Status) |
| B'. WebXR in Custom Tab / TWA | Chrome supports | n/a | Deep links only | Chrome's | — | Rewrite AR screen in web | RN cannot draw over the AR session |
| `@sceneview-sdk/react-native` | Alpha | Legacy VMs | Manual | 4.x | Apache-2.0 | — | No tracking state / anchors; hit-test partial |
| Unity as a Library + AR Foundation | Mature | codegen | Manual | AR Foundation's | MIT wrapper + Unity terms | Weeks | Two toolchains, APK size, C# logic |
| D. On-device depth model only | Research-grade | n/a | ExecuTorch/ORT/TFLite RN libs exist | none | MIT models | 1–2 wks | ±5–7 % error, scale ambiguity, no registration — assist only |
| E. Headless ARCore + external preview | Unsupported by Google | Native | Local module | 1.56.0 | — | > A1 | `update()` needs GL context; camera ownership |

---

## 9. Known unknowns to test on the device first (Samsung Galaxy S22 Ultra, Android 16, ARCore 1.56)

1. **Run Google's `hello_ar_kotlin` unchanged** (`com.google.ar:core:1.56.0`, compileSdk 37). If camera + planes + tap placement work, a custom module will work and Viro's failure is Viro-specific. If it fails, the device/Play-Services-for-AR install is the problem and no library will help. (~30 min; highest value.)
2. `adb shell getconf PAGE_SIZE` (expect 4096; both ARCore builds are 16 KB-aligned anyway) and `adb shell dumpsys package com.google.ar.core | grep versionName` (expect 1.56.x).
3. Capture Viro logcat during the black-camera state (the maintainers asked for it in #499): look for `TextureNotSetException`, `MissingGlContextException`, `CameraNotAvailableException`, or `ArCoreApk` availability errors; also confirm the resolved `com.google.ar:core` version in the app (`./gradlew :app:dependencies | grep com.google.ar`) — Viro declares 1.43.0.
4. Whether an **ARCore 1.48.0 client** (SceneView 2.3.0 / `expo-ar`) initializes and tracks on Android 16 + ARCore 1.56 runtime (decides between C/A3 and A1).
5. `expo-ar` 0.2.2 in a scratch Expo SDK 57 dev build: does it build (Kotlin 2.0.21 vs RN 0.86's 2.1.20), does `raycast` return `DepthPoint` hits on plain walls, how long until first `TRACKING`?
6. Depth: `session.isDepthModeSupported(AUTOMATIC)` on this device and the quality of `DepthPoint` hits on white walls at 1–4 m (the actual corner-tapping case); compare with `InstantPlacementPoint` fallback.
7. `GLSurfaceView` inside an `ExpoView` under Fabric + expo-router: z-order over/under sibling RN views, behaviour on push/pop and app background/foreground (`setZOrderMediaOverlay(true)` vs `TextureView` + own EGL).
8. If SceneView 4.x is attractive: does an Expo SDK 57 app build with `expo-build-properties { compileSdkVersion: 37, kotlinVersion: "2.4.10" }`? (Expected: expo-modules-core KSP mapping breaks — UNVERIFIED.)
9. Headless: does `Session.update()` succeed on a background thread with a pbuffer EGL context + dummy external texture, and does it still require a GL context under `TextureUpdateMode.EXPOSE_HARDWARE_BUFFER`?
10. `ArCoreApk.requestInstall(activity, …)` from inside the Expo dev client (activity result / `onResume` re-check via `OnActivityEntersForeground`).
11. Vertical-plane detection latency in typical rooms vs. tapping via depth/feature points; decide default `planeDetection` and whether markers should snap to plane polygons (`isPoseInPolygon`).

---

## Sources (primary)

- ARCore releases API: https://api.github.com/repos/google-ar/arcore-android-sdk/releases ; Maven metadata: https://dl.google.com/dl/android/maven2/com/google/ar/core/maven-metadata.xml ; AARs `core-1.56.0.aar`, `core-1.43.0.aar` (inspected)
- ARCore docs: https://developers.google.com/ar/develop/java/quickstart , /enable-arcore , /camera-sharing , /depth/overview , /vulkan ; reference `Session`, `Frame`, `SharedCamera`, `Config.TextureUpdateMode`, `MissingGlContextException`; `libraries/include/arcore_c_api.h`; devices list https://developers.google.com/ar/devices
- ARCore issues: #1685 (16 KB), #1375 (headless)
- Expo docs: https://docs.expo.dev/versions/v57.0.0/ , /modules/overview/ , /modules/module-api/ , /modules/native-view-tutorial/ , /modules/get-started/ , /modules/android-lifecycle-listeners/ , /config-plugins/introduction/ , /config-plugins/mods/ , /guides/new-architecture/ ; expo/expo `sdk-57` `ExpoModulesCorePlugin.gradle`
- React Native: https://reactnative.dev/blog/2026/06/11/react-native-0.86 ; `0.86-stable` gradle-plugin `libs.versions.toml`; community template `0.86-stable`
- Viro: npm registry `@reactvision/react-viro`; https://github.com/ReactVision/viro/issues/499 , /513 , /releases ; `android/viro_bridge/build.gradle`
- SceneView: https://github.com/sceneview/sceneview (README, `gradle/libs.versions.toml`, `arsceneview/build.gradle`, releases API); Maven Central `arsceneview-4.35.0.pom/.aar`, `arsceneview-2.3.0.pom/.aar`; npm `@sceneview-sdk/react-native`
- expo-ar: https://github.com/stewartmoreland/expo-ar (`android/build.gradle`, `ExpoArView.kt`, tree, commits); npm `@stewmore/expo-ar`
- WebXR: https://chromestatus.com/api/v0/features/… (5680169905815552, 5450241148977152, 4755348300759040, 6048666307526656, 5742647199137792); https://groups.google.com/a/chromium.org/g/blink-dev/c/BXxS2U5EaN0/m/cSVmzxSmDQAJ ; https://github.com/google/model-viewer/discussions/3096
- Models: https://github.com/DepthAnything/Depth-Anything-V2/blob/main/metric_depth/README.md ; https://arxiv.org/html/2406.09414 ; https://huggingface.co/qualcomm/Depth-Anything-V2 ; HF API search `Depth-Anything-V2-Metric`; https://github.com/microsoft/MoGe ; https://github.com/microsoft/MoGe/blob/main/docs/onnx.md ; https://arxiv.org/html/2507.02546 ; HF API `Ruicheng/moge-2-vits-normal-onnx`
- On-device runtimes: npm `react-native-executorch`, `onnxruntime-react-native`, `react-native-fast-tflite`; https://onnxruntime.ai/docs/install/
- ML Kit https://developers.google.com/ml-kit ; MediaPipe https://developers.google.com/edge/mediapipe/solutions/guide
- Apple: https://developer.apple.com/documentation/roomplan ; https://developer.apple.com/documentation/arkit/arsession/raycast(_:)
- Others: npm `react-native-ar-viewer`, `react-native-arcore`, `@azesmway/react-native-unity`, `react-native-webview`; Filament releases API + `android/samples`; Niantic docs (search snippet); 8th Wall pricing blog (secondary)
