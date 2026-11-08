<!--
DRAFT (ticket 06) — post as a comment on https://github.com/ReactVision/viro/issues/568
-->

A data point and partial answers to your camera-config and 3.0.3 questions, from a Samsung Galaxy S22 Ultra (SM-S908U) on Android 16, with the same `@reactvision/react-viro` 2.58.1 (and since then 3.0.3), Expo SDK 57 and React Native 0.86.3 (New Architecture).

**No flapping here.**
- **Starts:** 10 of 10 cold launches reached `TRACKING_NORMAL` 1.3–3.6 s after the view attached, and stayed there. On 3.0.3, 10 of 10 again (debug and release builds).
- **Planes:** floor planes arrived within seconds, and most floor taps hit one.
- **Clock warning:** with Play Services for AR 1.57.262640093, ARCore logged `FEATURE_DSP_CAM_IMU_DESYNC` once ("Camera to IMU clock offset (-5.90ms) exceeds threshold (5ms)") right after start, with no effect on tracking.

**Yes, Viro uses a fixed camera config, and not ARCore's default.**
- **Where:** in the `SessionNative` constructor (`android/viroar/src/main/cpp/arcore/ARCore_Native.cpp`, v2.58.1 through v3.0.3, and still on `main`).
- **What it picks:** the config with the **largest CPU image** ("the default is typically 640×480 which produces too few SIFT features for reliable cross-platform cloud anchor matching").
- **Always applied,** whether or not cloud anchors are used (`provider="none"` in our case).
- **On the S22U** it logs:

  ```
  I ViroARCore: Camera config 0: CPU image 640x480
  I ViroARCore: Camera config 1: CPU image 1280x720
  I ViroARCore: Camera config 2: CPU image 1920x1080
  I ViroARCore: Selected camera config 2: CPU image 1920x1080 (status=0)
  ```

- **Why it could matter for #568:** plain ARCore apps usually keep ARCore's default config, typically the 640×480 CPU image. If your A56 log shows the same `Selected camera config …` line with a large image, a CPU image that size every frame could plausibly upset ARCore's camera/IMU timing on a mid-range phone, while it is fine on an S22U. That is a guess, not something we have tested.
- **A cheap way to test it:** a virocore build that skips `ArSession_setCameraConfig` in that constructor, or one that only applies it when a cloud-anchor provider is set.

**On 3.0.3:** we found no change to the ARCore session set-up between 2.58.1 and 3.0.3.
- **ARCore client:** the bundled ARCore client library (`arcore_client`) is byte-identical in the two packages.
- **Session code:** between the virocore `v2.58.1` and `v3.0.3` tags, `ARCore_Native.cpp` only gains a camera-pose getter, `VROARSessionARCore.cpp` only changes its ReactVision cloud-anchor code, and `VROARFrameARCore.cpp` is unchanged. Session creation, the camera-config choice above and resume are the same.
- **On the S22U:** 3.0.3 logs the same `Selected camera config 2: CPU image 1920x1080 (status=0)` line and tracks the same as 2.58.1, so upgrading alone is unlikely to change what you see on the A56.
