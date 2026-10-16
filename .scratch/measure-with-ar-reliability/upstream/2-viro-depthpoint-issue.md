<!--
DRAFT (ticket 06) — open as a NEW issue on https://github.com/ReactVision/viro/issues
Title: Android: performARHitTestWithPoint never returns DepthPoint — depth hits arrive as FeaturePoint
-->

**Setup:** `@reactvision/react-viro` 2.58.1 (also checked in virocore `v3.0.3` and `main`), `ViroARSceneNavigator depthEnabled`, Samsung Galaxy S22 Ultra, Android 16, Google Play Services for AR 1.57.262640093.

### What happens

With `depthEnabled`, `onDepthReady` fires about 2 s after the session starts, and depth hits do come back from ARCore. But every one of them reaches JS as `type: "FeaturePoint"` with `hasDepthData: false`. `DepthPoint` never appears.

We confirmed depth is working underneath on a plain painted wall:
- **Depth on:** 10 of 10 taps returned a hit, all within 4.5 cm of one plane.
- **Depth off:** the same wall gave no hit on its plain upper part.

### Cause

`HitResultNative::acquireTrackable()` in `android/viroar/src/main/cpp/arcore/ARCore_Native.cpp` returns a trackable only for planes:

```cpp
ArTrackableType type;
ArTrackable_getType(_session, trackable, &type);
if (type == AR_TRACKABLE_PLANE) {
    return new PlaneNative(ArAsPlane(trackable), _session);
} else {
    return nullptr;
}
```

So in `VROARFrameARCore::hitTest` (`android/sharedCode/src/main/cpp/arcore/VROARFrameARCore.cpp`):
- every non-plane hit has `trackable == nullptr`;
- the `TrackableType::DepthPoint` branch, and the `setDepthData` call after it, never run;
- the hit falls through to `FeaturePoint`.

It also leaks: the `ArTrackable` acquired for a non-plane hit is never released (`ArTrackable_release` sits in `PlaneNative`'s destructor, which is never created for these hits). With depth on, nearly every tap leaks one reference.

### Possible fix (not built or tested by us)

Wrap every trackable, not just planes. `PlaneNative::getType()` already maps `AR_TRACKABLE_DEPTH_POINT` and `AR_TRACKABLE_INSTANT_PLACEMENT_POINT`, and its destructor releases the reference:

```cpp
Trackable *HitResultNative::acquireTrackable() {
    ArTrackable *trackable;
    ArHitResult_acquireTrackable(_session, _hitResult, &trackable);
    return new PlaneNative(ArAsPlane(trackable), _session);
}
```

- **Why this is safe today:** `acquireTrackable` has one caller, `VROARFrameARCore::hitTest` and its ray variant, and both call plane-only methods only after `getType() == Plane`.
- **A tidier version:** a small generic `TrackableNative` wrapper for non-plane hits.

Happy to open a PR if that helps.
