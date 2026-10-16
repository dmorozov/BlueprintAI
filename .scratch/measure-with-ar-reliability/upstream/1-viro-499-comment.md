<!--
DRAFT (ticket 06) — post as a comment on https://github.com/ReactVision/viro/issues/499
(it answers @oliedis's request for logcat). Cross-link from #513 with draft 1b below.
-->

Here is logcat from a Samsung Galaxy S22 Ultra on Android 16. In our case the black view turned out to be our app's own mistake, but tracking it down exposed a Viro gap that makes this class of report hard to diagnose.

**Setup:** Samsung Galaxy S22 Ultra (SM-S908U), Android 16 (API 36, security patch 2026-08-05), Google Play Services for AR 1.56.262080393 (later 1.57.262640093), `@reactvision/react-viro` 2.58.1, Expo SDK 57, React Native 0.86.3 (New Architecture), development build.

### Our black view: the AR scene was rendered without a navigator

Our screen rendered a `<ViroARScene>` directly, without a `<ViroARSceneNavigator>` around it. Only the navigator creates the AR view (`VRTARSceneNavigator` is the only class that constructs `ViroViewARCore`), so no ARCore session ever started. Everything else looked healthy, which is why it read like this issue. The only Viro lines in logcat were:

```
I Viro    : ARCore availability check returned [SUPPORTED_INSTALLED]
I Viro    : === JNI setAnchorDetectionTypes called ===
```

There was no `onTrackingUpdated` callback in 20 s, `dumpsys media.camera` showed no camera client at all, and the view stayed black. With the navigator mounted, a healthy start on the same phone logs:

```
I ViroAR  : === onAttachedToWindow START ===
I Viro    : ARCore installed on device
I .../session_create.cc: Entering ArSession_create
I ViroARCore: Selected camera config 2: CPU image 1920x1080 (status=0)
I Viro    : AR session resumed
```

With the navigator mounted, the app reached `TRACKING_NORMAL` on 10 of 10 cold launches, 1.3–3.6 s after `onAttachedToWindow`. Background→foreground, and returning from an expo-camera screen, also tracked every time. Google's `hello_ar_kotlin` tracks on this phone too.

**A quick check for others seeing a black background:** if logcat has no `=== onAttachedToWindow START ===` and no `AR session resumed`, no AR engine was created, and the cause is in the app's component tree rather than in ARCore. If those lines are there and tracking still never arrives, the logs below are what would separate the two cases.

### The gap: an app cannot tell its user why AR failed

When ARCore does fail, Viro gives the app nothing to act on:

- **Session creation, resume and per-frame update ignore ARCore's `ArStatus`.** In `android/viroar/src/main/cpp/arcore/ARCore_Native.cpp` (v2.58.1), `SessionNative::resume()` and `SessionNative::update()` call `ArSession_resume` and `ArSession_update` and drop the result, as does the `ArSession_create` call in the `SessionNative` constructor.
- **"AR session resumed" is logged even when the resume failed.** `VROARSessionARCore::run()` logs it unconditionally.
- **Start-up failures go only to logcat.** `StartupListenerARCore.onFailure` in `VRTARSceneNavigator` logs `onRendererFailed [error: X], message [Y]` and does not reach JS.
- **The result:** a failed session looks exactly like a slow one (forced `TRACKING_UNAVAILABLE`, then silence). Our app now reads its own logcat to find reasons, which is fragile.

**Offer:** we have a patch that adds an `onSessionError` event to `ViroARScene`, carrying the operation, the raw `ArStatus` and its name. It reports failed `ArSession_resume` and `ArSession_update` calls (update only when the status changes), plus the start-up failures that today only reach the `onRendererFailed` log line. It follows the same path as your `onDepthReady` (virocore + bridge + `ViroEvents`). It compiles on v2.58.1 and applies cleanly to 3.0.1. We have not run it on a device yet. Would you take it as a PR?
