# Feasibility of forking and rebuilding virocore's Android renderer

Research dates: 2026-09-22 and 2026-09-23. Ticket: `.scratch/measure-with-ar-reliability/issues/08-research-virocore-rebuild-feasibility.md`.

Method: I cloned `ReactVision/virocore` and `ReactVision/viro` into the session scratchpad. I built both AARs on this Mac, compared them byte for byte with the AARs in `node_modules`, and prototyped patches (a) and (c) there far enough to compile them. Other sources: the installed packages (read-only), Google's ARCore 1.56.0 artifacts, GitHub's API for CI runs and releases, and docs.expo.dev. **VERIFIED** means read or built from the primary source named; **UNVERIFIED** means not confirmed. Nothing ran on the phone.

## 0. Context that changed since the ticket was written

- The Dead session on the S22 Ultra was app-side: H0, the navigator was never mounted, fixed in ticket 00. With the navigator mounted, Viro tracks 10/10 cold launches, 1.3–2.5 s to "Tracking good" (tickets 00 and 03), and H1–H4 are not supported on this phone. So a fork is **no longer a fix for tracking**. What remains is the acceptance-bar item "every failure surfaces a human-readable ARCore reason", plus the spec requirement for plane-less `DepthPoint` hits on plain walls.
- Ticket 04 has built the cheap alternative: `modules/ar-session-guard`, which tails `logcat --pid=<self>`, and `src/lib/ar-diagnostics.ts`, which turns the forwarded lines into milestones and failures. §4 compares the two approaches, and reports a format mismatch in 04's `onRendererFailed` regex.
- `@reactvision/react-viro` 3.0.0 and 3.0.1 shipped on 2026-09-20/21 and change nothing relevant here (§1).

## 1. Sources read (commits/tags) and which virocore commit matches the 2.58.1 AARs

Clones (scratchpad, read-only use):
- `ReactVision/virocore`, tag **`v2.58.1` = `d86dee6620bc950991daf86cd6ee966a2087f04f`** (2026-08-17, "docs: 2.58.1 notes"). Also read: `main` = `v3.0.1` = `efa030be` (2026-09-21).
- `ReactVision/viro`, tag **`v2.58.1` = `85f537d6fbdc3bc05d0542552a2bcc90583e3509`** (2026-08-17, "v2.58.1"). Also read: `main` = `882687b` (v3.0.1).

**The 2.58.1 AARs correspond to virocore `v2.58.1` (VERIFIED by rebuild):**
- The four AARs in `node_modules/@reactvision/react-viro/android/*/` are byte-identical (SHA-1) to the ones committed in `viro@v2.58.1` (`android/{arcore_client,gvr_common,react_viro,viro_renderer}/…aar`). `viro_renderer-release.aar` was last changed by viro commit `85f537d` ("v2.58.1"), made 9 s after virocore's `d86dee66`.
- I rebuilt `:viroreact:assembleRelease` from virocore `v2.58.1` (§2.4) and compared it with the shipped `viro_renderer-release.aar` file by file. **`classes.jar` is byte-identical.** So are `AndroidManifest.xml`, `R.txt`, all assets, and every prebuilt `.so`, including the 1.51 `libarcore_sdk_c.so`. `libviro_arcore.so` has identical dynamic symbols and identical strings, and differs only in its GNU build-id. `libviro_renderer.so` differs only by the ReactVisionCCA code: the shipped one has `NEEDED libreactvisioncca.so` plus 65 extra `ReactVisionCCA::*`/`rv*` symbols, and the open-source build compiles the stubs (§2.2). Android sources are identical from `1e4031c9` to `d86dee66` (the commits in between touch iOS and docs only), and the shipped `ARSessionRecorder` already contains `1e4031c9`'s `MediaCodec.getInputImage` fix.
- Both builds used the same compiler. The shipped `.comment` reads `Android (12285214 … based on r522817b) clang version 18.0.2`, which is NDK 27.1.12297006. The shipped binary embeds the maintainer's source paths (`/Users/dorantes/Documents/ViroWorkspace/virocore/ViroRenderer/…`), so **upstream's release AARs are built on a macOS workstation**, from a `ViroWorkspace/` folder that holds `virocore/`, `viro/` and the private `reactvisioncca/` side by side (see `copyReleaseAAR` in `android/viroreact/build.gradle` L113–120 and `RVCCA_DIR` in `android/sharedCode/CMakeLists.txt` L466).

New since the ticket was written: **`@reactvision/react-viro` 3.0.0 (2026-09-20) and 3.0.1 (2026-09-21) are on npm (`latest` = 3.0.1)**. They declare `expo >=57 <58` and `react-native >=0.86 <0.87`. In 3.0.1, `ArSession_create`/`resume`/`update` still discard their status (`ARCore_Native.cpp` L989, L1119, L1123 @v3.0.1), and `renderFrame` is unchanged. The 3.0 work is VPS, world mesh, scan and Quest shared anchors. **Upgrading to 3.0.x does not remove the need for any patch below.**

## 2. Q1 — Build system

### 2.1 What the repo expects

virocore `android/` @v2.58.1:

| Item | Value | Source |
|---|---|---|
| Gradle wrapper | **8.3** (`gradle-8.3-all.zip`) | `android/gradle/wrapper/gradle-wrapper.properties` L3 |
| AGP | **8.2.0** | `android/build.gradle` L8 |
| Kotlin Gradle plugin | 2.0.0 (the `ext.kotlin_version = '1.8.21'` is unused) | `android/build.gradle` L2, L10 |
| JDK | **17** (`sourceCompatibility VERSION_17`; CI uses `setup-java` 17). `jitpack.yml` still says `openjdk11`, which is stale: AGP 8.x needs 17 | `viroar/build.gradle` L8–11, `.github/workflows/pull-request.yml` L14–18, `jitpack.yml` |
| compileSdk / targetSdk / minSdk | **33** / 33 / 24 | `viroreact/build.gradle` L5, L17–18; same in `viroar`, `virocore`, `sharedCode` |
| NDK | **27.1.12297006** (the same NDK the app uses) | `viroreact/build.gradle` L19, `viroar/build.gradle` L16 |
| CMake | `cmake_minimum_required(VERSION 3.4.1)`, no version pinned in Gradle, so AGP's default **3.22.1** | `sharedCode/CMakeLists.txt` L1 |
| C++ flags | `-std=c++14 -frtti -fexceptions`, `ANDROID_STL=c++_shared`, `-Wl,-z,max-page-size=16384` (16 KB pages) | `viroreact/build.gradle` L31–37; `sharedCode/CMakeLists.txt` L519 |
| ABIs | `arm64-v8a`, `armeabi-v7a` (x86 excluded; an x86_64 `libarcore_sdk_c.so` rides along) | `viroreact/build.gradle` L25, L76 |
| Modules | `settings.gradle` includes `:sharedCode, :libs:gvr, :virocore, :viroreact, :viroar, :openxrtest`. **`:viroreact` produces the renderer AAR the npm package ships.** It uses `sharedCode/src/main/{java,res,assets,jniLibs}` plus `viroar/build/natives/jni`. `:viroar` builds `libviro_arcore.so` (2 C++ files). `:sharedCode` exists "only … to make Android Studio's internal compiler work" | `settings.gradle` L3; `viroreact/build.gradle` L43–54, L128–133; `viroar/CMakeLists.txt`; `sharedCode/build.gradle` L5–8 |
| Java deps | `com.google.ar:core:1.51.0`, `androidx.media3:*:1.1.1`, `protobuf-javanano:3.0.0-alpha-7`, `org.khronos.openxr:openxr_loader_for_android:1.1.49` (from the checked-in local Maven repo `android/openxr_sdk/maven`) | `viroreact/build.gradle` L97–111; `android/build.gradle` L22 |

viro (JS package + bridge) `android/` @v2.58.1, needed for any change that must reach JS:

| Item | Value | Source |
|---|---|---|
| Gradle wrapper | **8.13** | `android/gradle/wrapper/gradle-wrapper.properties` L4 |
| AGP / KGP | 8.2.0 / 1.8.0, plus `com.facebook.react` from `../node_modules/@react-native/gradle-plugin` | `android/build.gradle` L13–15; `android/settings.gradle` L1–16 |
| `:viro_bridge` | compileSdk 34, Java 1.8 source level, `compileOnly com.facebook.react:react-android:<version read from ../node_modules/react-native/package.json>`, `implementation 'com.google.ar:core:1.43.0'`, `project(':viro_renderer')` (the prebuilt AAR) | `android/viro_bridge/build.gradle` L10–39, L105–125 |
| Release script | `prepare_release.sh`: `npm run build`, `npm run test`, `npx react-native config > android/.gradle/autolinking.json`, `./gradlew -PnodeExecutable=… :viro_bridge:assembleRelease`, copy to `android/react_viro/react_viro-release.aar`, `npm pack` | `prepare_release.sh` L15–60 |
| devDependencies | `react-native ~0.86.0` (lock: 0.86.0), `expo ~57.0.0` (lock: 57.0.2) | `package.json`, `package-lock.json` |

### 2.2 Third-party dependencies and checked-in prebuilts

Nothing is fetched or compiled from source at build time except Maven artifacts. Every native third-party library is **checked in as a prebuilt binary** (60 `.so`/`.a`/`.aar` files in the repo):

- **Bullet** (`libBulletCollision/Dynamics/SoftBody.so`, `libLinearMath.so`), **FreeType** (`libfreetype.so`, `libfreetyped.so`), **protobuf-lite** (`libprotobuf-lite.a`), **GVR** (`libgvr.so`, `libgvr_audio.so`; headers `android/libs/gvr/include`, "GVR Android SDK 1.130.0"; Java AAR `android/libs/gvr/sdk-common-1.180.0.aar`): `android/sharedCode/src/main/jniLibs/{arm64-v8a,armeabi-v7a}/`, imported in `sharedCode/CMakeLists.txt` L390–450.
- **ARCore C stub `libarcore_sdk_c.so` (1.51)**: `android/viroar/src/main/jniLibs/{arm64-v8a,armeabi-v7a,x86,x86_64}/`, imported in `viroar/CMakeLists.txt` L22–25. Header `android/libs/arcore/include/arcore_c_api.h` (7,802 lines; last updated by `b02139ca` "feat: update to arcore 1.51.0", 2025-11-26).
- **OpenXR loader** 1.1.49 AAR (local Maven repo, Prefab), `android/openxr_sdk/maven/...`.
- **OpenCV**: headers only (`android/libs/opencv/include`), with no Android library linked.
- **Filament**: not used. There is no Filament anywhere in the Android build. Viro has its own GL renderer (`ViroRenderer/*.cpp`, compiled into `libviro_renderer.so`).
- **ReactVisionCCA** (`libreactvisioncca.so`, ReactVision's cloud anchors): a **proprietary, optional prebuilt** built from a private repo. CMake enables it only if both the `.so` and `../../../reactvisioncca/include/ReactVisionCCA/RVCCACloudAnchorProvider.h` exist. Otherwise it "compile[s] stub implementations that report the feature as unavailable" (`sharedCode/CMakeLists.txt` L457–484). The `.so` is checked in, but the header is not, so **every open-source build is stubbed**: ReactVision cloud anchors and the ReactVision Geospatial provider are off. The app uses neither. The `.so` still gets packaged, unlinked, from `jniLibs`.
- Chromium's ARCore client: not involved. The Java side is Google Maven `com.google.ar:core:1.51.0` (renderer) and `1.43.0` (bridge, plus the npm package's `arcore_client/core-1.43.0.aar` with its `libarcore_sdk_c.so` removed — ticket 07 §6).

### 2.3 Build docs and CI

- There are no Android build instructions beyond the comments in the Gradle files. `android/libs/readme.txt` holds one sentence about jniLibs. `README.md` points to the docs site.
- CI (`.github/workflows/pull-request.yml`): on `ubuntu-latest` with JDK 17, runs `cd android && ./gradlew :viroreact:assembleDebug` and `./gradlew :viroreact:check`, and uploads the AARs as workflow artifacts. It has been green on every `main` push checked, including `d86dee66` (run 32096236866, 2026-08-18) and `efa030be` (3.0.1).
- Release (`.github/workflows/release.yml`): on a tag, runs `./gradlew :viroreact:assembleRelease` and creates a GitHub release. The `files:` globs are written relative to `android/`, but the step runs at the repo root, so **no GitHub release has any assets** (API: `v2.58.1`, `v3.0.0`, `v3.0.1` all have empty `assets`). The AARs users actually get are the ones committed into the `viro` repo, built on the maintainer's Mac (§1).
- Dependabot's Gradle-wrapper-9.7.0 and media3-1.11.0 PRs **failed** CI (runs 31357400954, 31460391331 …, 2026-08-10/11). The build is pinned to the Gradle 8.3 / AGP 8.2 generation and does not move to the app's Gradle 9 toolchain.

### 2.4 Build attempt on this Mac

**Result: it builds today, unmodified, in under 2 minutes. There was no blocker.**

Environment: macOS 26.6.2 (arm64), JDK `17.0.14-jbr` (sdkman), NDK 27.1.12297006, CMake 3.22.1 (from the Android SDK), Node 24.18.0 / npm 11.16.0. I pointed the Android SDK at an isolated root in the scratchpad (symlinks to the installed NDK, CMake and build-tools) so AGP's auto-installs would not touch `~/Library/Android/sdk`.

Renderer (virocore `v2.58.1`):
```
cd virocore/android
ANDROID_HOME=<scratch-sdk> JAVA_HOME=~/.sdkman/candidates/java/17.0.14-jbr \
  ./gradlew --no-daemon --stacktrace :viroreact:assembleRelease
```
- Gradle 8.3 was downloaded by the wrapper. AGP 8.2 **auto-installed "Android SDK Platform 33 (revision 3)" and "Build-Tools 34.0.0"**, which were missing, because the app's SDK only has platforms 36/36.1 and build-tools 35–37.
- `BUILD SUCCESSFUL in 1m 58s` (62 tasks). The output had 4,886 compiler warnings and no errors. It produced `viroreact/build/outputs/aar/viroreact-release.aar` (12.66 MB) and, through `copyReleaseAAR`, also `../../../viro/android/viro_renderer/viro_renderer-release.aar`.
- The result is identical to the shipped AAR except for the ReactVisionCCA stubs (§1).
- Logs: `logs/ticket-08/build-logs/attempt1.log`.

Bridge (viro `v2.58.1`), following upstream's `prepare_release.sh`:
```
cd viro && npm ci --ignore-scripts          # 1,229 packages, 6 s
npx react-native config > android/.gradle/autolinking.json
cd android && ANDROID_HOME=<scratch-sdk> JAVA_HOME=…17.0.14-jbr \
  ./gradlew --no-daemon -PnodeExecutable="$(command -v node)" :viro_bridge:assembleRelease
```
- `BUILD SUCCESSFUL in 3m 28s`, using Gradle 8.13 from the wrapper.
- **`classes.jar`, `AndroidManifest.xml` and `R.txt` are byte-identical to the shipped `react_viro-release.aar`** (351 of 351 classes the same). Log: `logs/ticket-08/build-logs/bridge1.log`.

Patched builds, all green:
- virocore `v2.58.1` + patch (a): 17 s incremental, after one missing `#include "VROARScene.h"`.
- viro `v2.58.1` + patch (a), built against that patched renderer AAR: 8 s. `tsc --noEmit` reports no errors in the touched files; its 40 errors are all in `*.web.tsx`/`components/Web/*`, which import the uninstalled optional `@reactvision/viro-web-renderer`.
- virocore `v2.58.1` + (a) + (c): 32 s.
- virocore **`v3.0.1`** + (a): 47 s, a clean full build.

Logs: `logs/ticket-08/build-logs/attempt{2..5}*.log`. Diffs: `logs/ticket-08/patches/{virocore-patch-a,virocore-patch-ac,viro-patch-a}.diff`.

Total build time spent: about 10 minutes, far inside the 45-minute box.

Minimum a machine needs: JDK 17; Android SDK platform 33 and build-tools 34 (AGP installs both if licences are accepted); NDK 27.1.12297006; CMake 3.22.1; and, for the bridge only, Node plus `npm ci` in the viro checkout. The Gradle 8.3 and 8.13 wrappers are self-contained. The app's own toolchain (AGP 8.12 / Gradle 9.3.1) is **not** used to build virocore: the AARs are built in their own Gradle projects and consumed as files, so the toolchain mismatch does not matter.

Side effect (fixed): my first run's `build-tools` symlink pointed into the real SDK, so AGP installed Build-Tools 34.0.0 into `~/Library/Android/sdk/build-tools/34.0.0`. I moved it back out into the scratchpad right away, and the user's SDK is as it was. The Gradle wrappers (8.3-all, 8.13-bin) and their dependency caches live in `~/.gradle` as usual.

## 3. Q2 — The patches that matter

All line numbers below are at virocore `v2.58.1` (`d86dee66`) or viro `v2.58.1` (`85f537d`), unmodified.

### 3.1 Patch (a): propagate `ArStatus` from create/resume/update to JS

**Where the status is lost:**

| Call | Where | What happens today |
|---|---|---|
| `ArSession_create` | `android/viroar/src/main/cpp/arcore/ARCore_Native.cpp` L978 (`SessionNative::SessionNative`) | Return value dropped. `_session` is an uninitialised member (`ARCore_Native.h` L278), and the constructor goes straight on to `ArCameraConfigFilter_create(_session, …)` and the camera-config loop, which logs `Selected camera config …` at L1019. What a failed create then does (null-session crash or garbage) is **UNVERIFIED**. In practice most create failures are pre-empted by `ArCoreApk.requestInstall` (`ViroViewARCore.java` L620–656). |
| `ArSession_resume` | `ARCore_Native.cpp` L1107–1109, called from `VROARSessionARCore::run()` (`android/sharedCode/src/main/cpp/arcore/VROARSessionARCore.cpp` L214–227) | Dropped. `run()` then logs `pinfo("AR session resumed")` (L223) **unconditionally**. `run()` executes on the first `renderFrame()` (via `initARSession`, `VROSceneRendererARCore.cpp` L435–476) and on every `onResume()` (L559–581). The resumes inside `updateARCoreConfig()` (L522, L544) are dropped too. |
| `ArSession_update` | `ARCore_Native.cpp` L1111–1113, called every frame from `VROARSessionARCore::updateFrame()` (L929–930) | Dropped, with nothing logged. |
| `ArSession_configure` | `ARCore_Native.cpp` L1082–1091 | **Checked**, and turned into `ConfigStatus`. A failure is only `pwarn("Failed to configure AR session (status %d)")`'d, under the log tag `Viro` (`VROARSessionARCore.cpp` L543; `ViroRenderer/VROLog.h` L144, L164–166). |
| Startup (install, permission) | `ViroViewARCore.StartupListener.onFailure(StartupError, String)` (`ViroViewARCore.java` L103–119, enum L153–199) | The bridge's `VRTARSceneNavigator.StartupListenerARCore.onFailure` is `Log.e("Viro", "onRendererFailed [error: " + error + "], message [" + errorMessage + "]"); // No-op` (viro `VRTARSceneNavigator.java` L170–173). Nothing reaches JS. |
| Tracking reason | `FrameNative::getTrackingState` / `getTrackingFailureReason` (`ARCore_Native.cpp` L623–660) → `VROARCameraARCore.cpp` L69–105 | `PAUSED` and `STOPPED` both become `Unavailable`. `BAD_STATE` → `None` (L94–95), and **`AR_TRACKING_FAILURE_REASON_CAMERA_UNAVAILABLE` (5, "camera is in use by another application", `arcore_c_api.h` L1100–1106) → `None`** (else branch, `ARCore_Native.cpp` L657–659). `(Unavailable, None)` is also the initial state, so the change-only `VROARScene::setTrackingState` (`ViroRenderer/VROARScene.cpp` L245–258) emits nothing. |

**The patch, prototyped and compiled on both 2.58.1 and 3.0.1 (VERIFIED as a build; runtime UNVERIFIED):**

Renderer (virocore): 13 files, +192/−15 (`logs/ticket-08/patches/virocore-patch-a.diff`).
- `ARCore_API.h` L413–415: `resume()`/`update()` return `int` (the `ArStatus`). Add `getCreateStatus()` and `getStatusName(int)`.
- `ARCore_Native.{h,cpp}`: store `ArSession_create`'s status and skip the camera-config code when it fails. Return the statuses from `resume()`/`update()`. Add a name table for the `ArStatus` values that `arcore_c_api.h` documents for create/resume/update (L2226–2271, L3240–3281, L3363–3403), and null-guard the destructor.
- `VRORendererARCoreNative_JNI.cpp`: add `nativeGetARCoreSessionCreateStatus`, `nativeGetARCoreStatusName`, `nativeDestroyARCoreSession`.
- `RendererARCore.java` L49–57: `onARCoreInstalled` returns `false` and destroys the session when create failed. `ViroViewARCore.java`: a new `StartupError.ARCORE_SESSION_CREATE_FAILED`; L636 routes it to `notifyRendererFailed` with the status name.
- `VROARSessionARCore.cpp`: `run()` logs and reports `resume` failures. `updateFrame()` reports `update` failures **edge-triggered**, on the first failure and each change, not 30 events a second. Add `#include "VROARScene.h"`.
- `ViroRenderer/VROARScene.{h,cpp}`: an optional `VROARSceneDelegate::onSessionError(op, status, name)` (next to `onDepthReady`, L52) plus `notifySessionError`.
- `ARSceneController_JNI.{h,cpp}`: `onSessionError` for both delegates, a copy of the `onDepthReady` pattern at L2102/L2240, calling Java `onSessionError(String,int,String)`. `ARScene.java`: `Listener.onSessionError` as a `default` no-op (next to L100), plus the JNI entry.

Bridge and JS (viro): 5 files, +51/−1 (`logs/ticket-08/patches/viro-patch-a.diff`).
- `ViroEvents.ON_SESSION_ERROR = "onSessionErrorViro"`, exported in `VRTARSceneManager` (next to L103).
- `VRTARScene.onSessionError` emits `{operation, status, code, message?}` (next to L228).
- `StartupListenerARCore.onFailure` keeps the `Log.e` and also emits `operation: "startup", code: <StartupError>` to the child `VRTARScene`s on the main looper.
- `ViroARScene.tsx`: an `onSessionError` prop and the `onSessionErrorViro` mapping (optional; see §5).

This was the pattern upstream used for `onDepthReady` (virocore `db9c88e1` + `f5426846`, 101 lines; viro `dd0ea14`).

Not in the prototype, but cheap to add in the same pass:
- route `configure` failures through the same event;
- map `CAMERA_UNAVAILABLE` and `BAD_STATE` to their own `TrackingStateReason`s, and `STOPPED` to its own state, instead of `None`/`Unavailable`.

**Estimate: 1.5–2 days** to a reviewed patch with device evidence. The prototype is about 0.5 of that. The rest:
- the tracking-reason mapping and `configure`;
- app-side mapping into `ar-diagnostics`;
- forcing each failure on the S22U: another app holding the camera, camera permission revoked mid-session, Play Services for AR disabled.

### 3.2 Patch (b): camera background before tracking is Normal

**Settled from source: 2.58.1 already draws the live camera while tracking is not Normal, as long as the session is running. Patch (b) is not needed.** The "render black" reading comes from a stale comment, not the code path.

- `renderFrame()` (`VROSceneRendererARCore.cpp` L120–166) returns through `renderWaitingForTracking` only while `!_session->isReady()` (L138–141), i.e. before the scene and session are wired. Otherwise it always runs `_session->updateFrame()` (L144) and `updateARBackground(frame, backgroundNeedsReset)` (L145) **before** looking at tracking. `updateARBackground` sets the camera quad as the root portal's background as soon as it gets non-NaN texcoords (L234–240). That does not depend on the tracking state.
- When tracking is not `Normal` (L161–165), `renderWaitingForTracking` (L417–428) runs `prepareFrame` and **`renderEye`** (L425). Its only "black" is the comment at L418–419. `renderEye` → `VROChoreographer` → `VROPortalTreeRenderPass::render(…, renderBackgrounds = true, …)` (`ViroRenderer/VROPortalTreeRenderPass.cpp` L86) → `portal->renderBackground` (L207) → `VROPortal::renderBackground` draws `_background` if set (`ViroRenderer/VROPortal.cpp` L113–125). The quad is screen-space (`setScreenSpace(true)`, `VROSceneRendererARCore.cpp` L441), so the identity camera pose does not matter. The OES camera texture is refreshed by every successful `ArSession_update`, whatever the tracking state.
- `git log -L` shows this function has had the same structure since 2017 (`2cd3b495`, `7d1e37fb`, `76a5c8f5`).

So the view is black in only two cases:
1. **The session never runs.** A failed `ArSession_resume` means every `update` fails and the texture never fills. That is a patch (a) case, and it needs a reason, not a background.
2. **An edge case:** if the very first frame's texcoords are NaN, `updateARBackground` returns (L227–228) and retries only when the display geometry changes. The background could then stay unset. Viro's own comment says NaN is "common on first frame after camera switch, and always for front camera" (`ARCore_Native.cpp` L708–709). A 3-line hardening in `renderFrame`: keep `backgroundNeedsReset = true` until `getRootNode()->getBackground()` is set. That costs **0.25 day** if a device ever shows it; it is **UNVERIFIED** that it ever happens on the back camera.

So the #1784-style state (VIO flapping TRACKING↔PAUSED) should show the camera in Viro as it does in hello_ar. That contradicts claims-verification item (3) and ticket 07 §1's reading, which both followed the comment. Two side notes:
- While tracking is not Normal, Viro keeps drawing scene nodes with the last camera pose, so the marker spheres can drift. Hiding them in JS while tracking is not Normal is enough.
- **Device check still owed (UNVERIFIED on the S22U), about 5 minutes:** screen-record a cold launch with the lens close to a blank wall or ceiling, so ARCore cannot initialise. A live image before "Tracking good" confirms this section.

**Estimate: 0 days** (0.25 optional hardening).

### 3.3 Patch (c): ARCore client 1.56 consistently

Today there are three ARCore versions in the APK:
- 1.43 Java client plus 1.43 `libarcore_sdk_jni.so` (npm `android/arcore_client/core-1.43.0.aar`);
- the renderer's 1.51 `libarcore_sdk_c.so` (`android/viroar/src/main/jniLibs/*/`) and 1.51 header;
- Gradle `com.google.ar:core:1.51.0` in the renderer, and `1.43.0` in the bridge.

These are compile-time only: file AARs carry no POM, so the app's only runtime Java client is `:arcore_client` (app `android/app/build.gradle` L161–164, generated by Viro's plugin, `withViroAndroid.js` L113–143).

The renderer part is **prototyped and built** (VERIFIED as a build; `attempt4-patch-ac.log`):
- Copy `jni/{arm64-v8a,armeabi-v7a,x86,x86_64}/libarcore_sdk_c.so` from `com.google.ar:core:1.56.0` (Google Maven; SHA-1 `0cd1c7cd…`) over `android/viroar/src/main/jniLibs/*/`.
- Replace `android/libs/arcore/include/arcore_c_api.h` with the one from `google-ar/arcore-android-sdk` tag `v1.56.0` (`3abfeb18`). The 1.51 → 1.56 header diff adds exactly two functions, `ArFrame_acquireDepthImageMeters` and `ArFrame_acquireRawDepthImageMeters`, and removes none.
- Bump `com.google.ar:core:1.51.0` → `1.56.0` in `viroreact/build.gradle` L105, `sharedCode/build.gradle` L49 and `virocore/build.gradle` L97.

The build is clean, with only pre-existing deprecation warnings for cloud-anchor and geospatial functions. The packaged `jni/arm64-v8a/libarcore_sdk_c.so` is Google's 1.56 file (same SHA-1, version string `1.56`, LOAD segments 16 KB-aligned). compileSdk 33 accepted the 1.56 AAR, which ships no `aar-metadata.properties`.

Still to do:
- repack `arcore_client` as `core-1.56.0.aar` minus its `jni/*/libarcore_sdk_c.so` (the renderer provides that one; this mirrors how 1.43 is shipped today);
- bump the bridge's `com.google.ar:core:1.43.0` (viro `android/viro_bridge/build.gradle` L121) and rebuild the bridge;
- on the device, check that logcat shows `SDK build name: 1.56` and that tracking has not regressed.

Consequence (ticket 07 §6): `min_apk_version` rises to 261960000, so `ArCoreApk.requestInstall` will require Play Services for AR ≥ 1.56 on users' phones.

The upstream precedent is the 1.51 bump: `b02139ca`, 18 files. Two of those were real code changes, in `VROImageAndroid.cpp` and `ARImageTarget.java`, and 1.56 needed none.

**Estimate: 0.5 day.**

### 3.4 Patch (d): Depth-API `DepthPoint` hit results

**Already in 2.58.1. No fork is needed for it.**
- Native: `VROARFrameARCore::hitTest` maps `arcore::TrackableType::DepthPoint` → `VROARHitTestResultType::DepthPoint` and attaches the distance as depth data (`android/sharedCode/src/main/cpp/arcore/VROARFrameARCore.cpp` L111, L134; ray variant L186, L209). `PlaneNative::getType` maps `AR_TRACKABLE_DEPTH_POINT` (`ARCore_Native.cpp` L345).
- JNI → JS: `"DepthPoint"` (`ARUtils_JNI.cpp` L306) reaches the JS `ViroARHitTestResult.type` union (viro `components/Types/ViroEvents.ts` L359).
- Depth mode: `ViroARSceneNavigator depthEnabled` (TS doc L118–131: "depth data will be available for hit tests (DepthPoint type)"; `@ReactProp(name = "depthEnabled")`, `VRTARSceneNavigatorManager.java` L105) → `OcclusionMode.DEPTH_ONLY` (`VRTARSceneNavigator.java` L404) → `DepthMode::Automatic` (`VROARSessionARCore.cpp` L1504) → `ArConfig_setDepthMode` (`ARCore_Native.cpp` L1220). Viro falls back to disabled with a `pwarn` if the device does not support it (L408).
- It was added in virocore `c0cb9387` (2026-01-14, "add depth-based ar hit test"). `onDepthReady` (virocore `f5426846`) tells JS when DepthPoints become possible.

App-side work (ticket 13 / the engine seam, not the fork):
- pass `depthEnabled` on the navigator;
- stop treating `results[0]` as type-agnostic in `ar-capture-screen.tsx` L435–449;
- prefer plane hits, and accept `DepthPoint` on walls.

Whether a plain-wall tap on the S22U returns a `DepthPoint` is **UNVERIFIED** (ticket 13 owns that). ARCore's docs promise it with depth enabled.

**Estimate for the fork: 0 days** (app wiring: about 0.25 day).

## 4. Patch (a) vs ticket 04's logcat-tail module

Ticket 04 as it stands in the working tree (read, not run):
- `modules/ar-session-guard` runs `logcat --pid=<self> -T <now> -v brief ReactNativeJS:S *:V` from inside the app and forwards lines that match the `AR_LOG_FILTER` regex as `onArLog`.
- `src/lib/ar-diagnostics.ts` folds each line into four milestones: `engine-attached` ← `=== onAttachedToWindow START ===`, `arcore-ready` ← `ARCore installed on device`, `session-created` ← `Selected camera config`, `session-resumed` ← `AR session resumed`.
- It also records failures (`onRendererFailed [error:X], message [Y]` → per-`StartupError` text; `Failed to register sensor to queue` → `SENSOR_REGISTRATION_FAILED`) and foreign camera clients (`CameraManagerGlobal … state now CAMERA_STATE_…`).
- `stalledReason()` infers a reason from the furthest milestone reached when no tracking update arrives in time.
- On the S22U it receives Viro's lines within about 50 ms (coordinator's device note).

**Format mismatch in ticket 04's `onRendererFailed` regex (VERIFIED against the shipped binary):**
- The real log line has a **space after `error:`**. The bridge source is `"onRendererFailed [error: " + error + …` (viro `VRTARSceneNavigator.java` L171 @v2.58.1). The shipped `react_viro-release.aar`'s `VRTARSceneNavigator$StartupListenerARCore.class` holds the constant `"onRendererFailed [error: "` (25 bytes, trailing space).
- `RENDERER_FAILED = /onRendererFailed \[error:(\w+)\], message \[(.*)\]/` (`src/lib/ar-diagnostics.ts` L58) does not match `onRendererFailed [error: ARCORE_UNKNOWN], message [...]`. I checked with node: `exec` returns `null`.
- The pre-filter (`'onRendererFailed [error:'`) does pass the line, so a real startup failure is forwarded and then silently dropped, falling through to the stall timeout's generic reason.
- The tests pass only because their fixtures omit the space (`src/lib/__tests__/ar-diagnostics.test.ts` L47, L79–80, L88, L128), and the comment at `ar-diagnostics.ts` L56 quotes the format without it.
- Fix in 04's lane (this ticket does not edit it): `\[error:\s*(\w+)\]`, plus a fixture with the real format.

**Which failure class each approach can report:**

| Failure class (ArStatus / source) | Where Viro 2.58.1 leaves it | Logcat tail (ticket 04) | Rebuild with patch (a) |
|---|---|---|---|
| Install / update / declined / unsupported / camera permission (`StartupError`) | `Log.e("Viro", "onRendererFailed [error: X], message [Y]")` only | **Yes, exact code**, once the regex allows the space. `ARCORE_UNKNOWN` hides the real exception class, which Viro logs as `Log.i("Viro", "Error: Unknown error when installing ARCore", e)` with the stack trace (`ViroViewARCore.java` L647–649); the tail could match `UnavailableException` subclass names there, and doesn't today | Yes, the same code as a typed JS event (`operation: "startup"`). The patch can also pass `e.getClass()` instead of `ARCORE_UNKNOWN` |
| `ArSession_create` fails (`AR_UNAVAILABLE_SDK_TOO_OLD`, `…DEVICE_NOT_COMPATIBLE`, `AR_ERROR_FATAL`, `…CAMERA_PERMISSION_NOT_GRANTED`) | Status dropped (`ARCore_Native.cpp` L978); possible native crash (UNVERIFIED) | **Inferred only**: no `Selected camera config` line → "ARCore could not create an AR session". No status. A native crash kills the tail with the process | **Yes, exact status name** (`ARCORE_SESSION_CREATE_FAILED` + `AR_UNAVAILABLE_…`), with no crash |
| `ArSession_resume` fails, #1762 sensor variant (`AR_ERROR_FATAL`) | Dropped; `"AR session resumed"` logged anyway | **Yes**, via ARCore's own deterministic `Failed to register sensor to queue` line | Yes (`resume` / `AR_ERROR_FATAL`). The sensor line stays the better *explanation* |
| `ArSession_resume` fails for another reason (`AR_ERROR_CAMERA_NOT_AVAILABLE`, `…CAMERA_PERMISSION_NOT_GRANTED`, `AR_ERROR_ILLEGAL_STATE`, other `AR_ERROR_FATAL`) | Dropped; `"AR session resumed"` logged anyway | **No.** Only indirect evidence: a foreign camera client from CameraManagerGlobal lines (a Samsung/Android 16 log; other builds may not log it), else the stall-timeout guess | **Yes, rebuild only**: exact status, at first start and on every background → foreground `run()` |
| `ArSession_update` fails mid-session (`AR_ERROR_CAMERA_NOT_AVAILABLE` "camera was removed during runtime", `…SESSION_PAUSED`, `…FATAL`, `…MISSING_GL_CONTEXT`, `…TEXTURE_NOT_SET`) | Dropped silently, every frame | **No** (nothing is logged in-process; CameraService's eviction logs belong to `system_server`'s pid, which `--pid` filters out) | **Yes, rebuild only**, edge-triggered |
| Tracking `PAUSED` with reason `CAMERA_UNAVAILABLE` (5), `BAD_STATE` (1), or `STOPPED` | Collapsed to `(Unavailable, None)`, i.e. no JS event (`ARCore_Native.cpp` L631–659, `VROARCameraARCore.cpp` L77–103) | **No** | **Rebuild only** (the mapping change listed in §3.1; +0.25 day) |
| Tracking `PAUSED` with light / motion / features reasons | Already reaches JS via `onTrackingUpdated(state, reason)` | n/a (JS has it) | n/a |
| `ArSession_configure` fails (unsupported config) / depth mode unsupported | `pwarn` under tag `Viro`: `Failed to configure AR session (status %d)`, `Requested depth mode %d not supported…` (`VROARSessionARCore.cpp` L543, L408) | Yes, if those strings are added to the filter (they are not today) | Yes, if routed (not in the prototype yet) |
| GL/EGL failure (H4) or native crash | GLSurfaceView throws, or SIGSEGV | No (the process dies) | No (the process dies) |

Summary:
- **The logcat tail reports:** the startup classes (with an exact code once the regex is fixed), the #1762 sensor failure, and a foreign camera holder. For everything else it gives an inferred "how far start-up got" reason.
- **Only a rebuild reports:** the exact `ArStatus` of create, of non-sensor resume failures, and of any mid-session update failure; and `CAMERA_UNAVAILABLE`/`BAD_STATE`/`STOPPED` tracking states.
- The tail's other costs:
  - it depends on log strings (fragile across Viro upgrades, as the space shows);
  - it depends on logd not dropping lines under ARCore's `E native` spam (UNVERIFIED);
  - it is verified only on a debuggable build (release builds should also be able to read their own pid's log, per ticket 07's AOSP citation; UNVERIFIED on device).
- The cheapest acceptable combination is **04's tail now, plus a 2–3 s "session never produced a frame" rule**. With the tail, the acceptance bar ("never a silent black view") can be met by inferred reasons. Exact ARCore reasons for the camera and update classes need patch (a).

## 5. Q3 — Shipping the rebuilt AARs

How the app consumes Viro today (VERIFIED):
- Viro's config plugin appends four file-AAR subprojects to the generated `android/settings.gradle` (`withViroSettingsGradle`, `node_modules/@reactvision/react-viro/dist/plugins/withViroAndroid.js` L137–146), each with `projectDir` in `node_modules/@reactvision/react-viro/android/{arcore_client,gvr_common,viro_renderer,react_viro}`.
- It adds `implementation project(':gvr_common' | ':arcore_client' | ':react_viro' | ':viro_renderer')` to `app/build.gradle` (L113–122 of the plugin; app `android/app/build.gradle` L161–164).
- Each subproject is two lines: `configurations.maybeCreate("default"); artifacts.add("default", file('….aar'))`. patch-package or `pnpm patch` would have to carry binary AAR diffs. That is not viable, and pnpm's `node_modules` entries point into a shared store anyway.

Options, best first:

1. **Vendored AARs + a small app config plugin (recommended).**
   - Commit `vendor/viro/android/{viro_renderer,react_viro,arcore_client}/` into the app repo. Each directory gets the same two-line `build.gradle` and the rebuilt AAR (12.7 MB + 0.5 MB + about 0.3 MB). Drop the unused proprietary `libreactvisioncca.so` from the vendored renderer AAR (§6).
   - Add a plugin, e.g. `plugins/with-vendored-viro.js`, using `withSettingsGradle` to rewrite the `projectDir` lines for those three to `../vendor/viro/android/…`. Keep `gvr_common` from npm.
   - Mod ordering (VERIFIED from `@expo/config-plugins` 57.0.9 `build/plugins/withMod.js` L180–204): a later-registered mod's action runs **first** and then calls `nextMod`, the earlier-registered one. So this plugin must be listed **before** `@reactvision/react-viro` in `app.json` `plugins` for its action to run after Viro's `+=` append. Ticket 07 §6 says "after"; that is backwards for same-type mods. Verify with `npx expo prebuild --clean` and `grep projectDir android/settings.gradle`.
   - Keep `@reactvision/react-viro` pinned to exactly the version the AARs were built from (2.58.1), because the JS package and the bridge AAR share prop and event names.
   - **No JS fork is needed:** `ViroARScene` spreads `{...this.props}` onto the native `VRTARScene` (viro `components/AR/ViroARScene.tsx` L508–509), and event registration comes from the native view manager's exported constants. The app can therefore pass `onSessionErrorViro` through a typed wrapper in its `ArEngine` seam. UNVERIFIED that Fabric interop delivers a new legacy direct event, but `onTrackingUpdatedViro` and `onDepthReadyViro` use exactly this path and work.
2. **Fork `ReactVision/viro`** (JS plus committed AARs), consumed as an `npm pack` tarball (`file:vendor/reactvision-react-viro-2.58.1-bp.1.tgz`) or a git dependency. A git dependency makes pnpm run the package's `prepare` (`npm run build`: `tsc` plus copy) at install. The fork is only worth it if JS types or behaviour must change. virocore's `copyReleaseAAR` already writes the renderer into a sibling viro checkout (`android/viroreact/build.gradle` L113–120), so a `virocore`/`viro` fork pair matches upstream's own workflow.
3. Publish the AARs to a Maven repo (JitPack or GitHub Packages): more infrastructure than one app needs, and `jitpack.yml` is stale (openjdk11).

**Maintenance cost of tracking upstream:**
- Cadence: upstream shipped 11 releases between 2026-05-10 and 2026-09-21: 2.55.0, 2.56.0, 2.57.0/.1/.2/.3/.5, 2.58.0/.1, 3.0.0/.1 (GitHub releases API). That is about 2.5 a month.
- Cost per adopted release:
  - re-apply the patch set;
  - rebuild both AARs (about 1–2 min + 4 min on this Mac);
  - repack the 1.56 client;
  - run the acceptance bar on the phone (the hands-on part).
  That is about **0.5–1 day per adopted release**, and zero while pinned.
- Rebase evidence: the patch (a) prototype `git apply --3way`'d **cleanly onto virocore `v3.0.1`**, with 537 files and about 106k lines changed since 2.58.1 including `ARSceneController_JNI.cpp` (+487/−159), and built there in 47 s. The viro side also applies cleanly to `v3.0.1` (`git apply --check`).
- Forced upgrades: 2.58.1 declares `expo >=55 <58` and `react-native >=0.83 <0.87`, so the Expo SDK 58 / RN 0.87 move forces a Viro bump and a rebase.
- The cheapest way to drop the fork is to upstream patch (a). It is MIT, small, and in the style of upstream's own `onDepthReady` change, and the maintainers asked for failure logs in viro#499. Whether they would accept it is UNVERIFIED.

## 6. Q4 — License and effort

**License:**
- **MIT is confirmed for both repos** (VERIFIED). virocore `LICENSE`: "MIT License, Copyright (c) 2019 Viro Media, Inc, Copyright (c) 2021 Viro Community". viro `LICENSE`: the same plus "Copyright (c) 2025 ReactVision, Inc". GitHub's `license.spdx_id` is `MIT` for both. The npm package says `"license": "MIT"`.
- **Caveat: proprietary pieces inside the MIT tree.**
  - `android/sharedCode/src/main/cpp/arcore/VROCloudAnchorProviderReactVision.{h,cpp}` and `VROARFrameSnapshot.{h,cpp}` carry "Copyright © 2026 ReactVision. All rights reserved. Proprietary and Confidential" headers, yet sit in the MIT repo and compile into `libviro_renderer.so`, both upstream and in our build.
  - The checked-in `libreactvisioncca.so` is described as a "prebuilt proprietary cloud anchor library" (`sharedCode/CMakeLists.txt` L452–456).
  - Which terms govern those files is **UNVERIFIED**. The app already redistributes both through the stock npm AAR, so a fork does not make this worse. For a clean fork: drop `libreactvisioncca.so` from the vendored AAR (our stub build does not link it and nothing `loadLibrary`s it). Optionally exclude the two proprietary `.cpp` files behind the existing `RVCCA_AVAILABLE=0` stub path (UNVERIFIED that the stub path compiles without them). Or ask ReactVision.
- Third-party licences travel with the prebuilts as they do today: the ARCore SDK (ARCore Additional Terms of Service), GVR, OpenXR loader, Bullet, FreeType. A fork adds nothing new, except ARCore 1.56 under the same terms.

**Effort, Android only, one developer, with the phone available for hands-on runs:**

| Item | Days | Notes |
|---|---|---|
| Reproducible build + vendoring setup | 0.25 | Done in this session: both repos build unmodified, and outputs match the shipped AARs. Remaining: a `scripts/build-viro-aars.sh` with the pinned SDK 33 / build-tools 34 / NDK 27.1 / JDK 17 |
| (a) `ArStatus` → JS | 1.5–2 | Prototype compiled; add the tracking-reason mapping and `configure`, review, device failure-injection tests |
| (b) camera before Normal | 0 (0.25) | Not needed per source; the optional NaN-first-frame hardening only if the device check shows black |
| (c) ARCore 1.56 everywhere | 0.5 | Renderer part built; `arcore_client` repack, bridge bump, device check |
| (d) DepthPoint | 0 | Already in 2.58.1; about 0.25 of app wiring belongs to ticket 13 |
| Shipping (plugin, prebuild, pin, CI-free build notes) | 0.5–1 | §5 option 1 |
| **Total to acceptance** | **≈ 3–4.5** | Then **0.5–1 per adopted upstream release** |

For comparison:
- ticket 09's owned module: 1.5–2 days of spikes, 6–9 dev-days, and 1–2 days to remove Viro;
- ticket 04's logcat tail: already built.

**Showstoppers: none found.** Risks:
1. Every runtime claim about the patches is **UNVERIFIED on the device**: that the events reach JS under Fabric interop, and that failures surface as designed.
2. The fork is a long-lived binary vendor on a non-CI build (upstream itself ships AARs built on a laptop).
3. The licensing ambiguity of the proprietary files.
4. Expo 58 / RN 0.87 forces a rebase.

## 7. Answer

- **Verdict: a virocore/viro fork is feasible, and cheaper than it looked.**
  - It builds today on this Mac with no changes: JDK 17, NDK 27.1, AGP 8.2 / Gradle 8.3 in its own project, and AGP auto-installs SDK 33 / build-tools 34. The renderer builds in 2 min and the bridge in 3.5 min.
  - The output matches the shipped 2.58.1 AARs. `classes.jar` is identical in both. The only native difference is the stubbed proprietary cloud-anchor code.
  - The 2.58.1 AARs are virocore `v2.58.1` = `d86dee66` and viro `v2.58.1` = `85f537d` (VERIFIED by rebuild).
- **Per patch:**
  - **(a)** is the only one that needs native work: 1.5–2 days, with a prototype already compiling on 2.58.1 and 3.0.1.
  - **(b)** is not needed. Viro 2.58.1 draws the camera background whenever the session runs; the "black" is a stale comment. The view is black only when resume/update fail, which is case (a). 5-minute device check owed.
  - **(c)** is a 0.5-day swap that builds.
  - **(d)** is already in 2.58.1 (`depthEnabled` + `DepthPoint` hit type): 0 fork days.
  - Total ≈ 3–4.5 days, plus 0.5–1 day per adopted upstream release. 3.0.x fixes none of this.
- **Against ticket 04's logcat tail:**
  - The tail already reports startup/install/permission failures and the #1762 sensor failure, and infers the rest from milestones.
  - Only a rebuild reports the exact `ArStatus` of create, of non-sensor resume failures (camera not available, permission, illegal state) and of mid-session `update` failures, plus the `CAMERA_UNAVAILABLE`/`BAD_STATE`/`STOPPED` tracking states.
  - **Found:** 04's `onRendererFailed` regex misses the real log format, which has a space after `error:`, so real startup failures are forwarded and then dropped.
- **Recommendation:** ship 04's tail with the regex fixed, and do (d) in the app now. Take the fork only if the spec demands exact ARCore reasons for the camera and update classes. If it does, vendor the two rebuilt AARs through an app config plugin listed before Viro in `app.json`, and offer patch (a) upstream.
