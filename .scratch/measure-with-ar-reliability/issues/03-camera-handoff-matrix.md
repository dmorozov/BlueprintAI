# 03 — Camera-handoff matrix: does expo-camera use before AR correlate with dead sessions?

Type: task
Mode: HITL (user moves the phone)
Status: open
Blocked by: —
Part of: ../map.md

## Question

Hypothesis H3: the app mounts `expo-camera`'s `CameraView` on three screens (Capture, Photo assist, and the reference-photo step inside the AR screen); a late camera release could make ARCore's session fail with `AR_ERROR_CAMERA_NOT_AVAILABLE`, which Viro swallows. Does the navigation path before *Measure with AR* change the outcome?

Run each path twice, cold launch, with `adb logcat` capture and `adb shell dumpsys media.camera` taken (a) just before opening AR and (b) while the view is black:
1. Cold launch → *Measure with AR* directly.
2. → *Sample plan from photos (testing)* (Capture screen, expo-camera live) → back → *Measure with AR*.
3. → *Measure with photos* (if configured) → back → *Measure with AR*.
4. In AR: finish a room → *Reference photos* → *Next room* (AR remounts after expo-camera).

Also measure **time-to-release**: ARCore may hold the camera for several seconds after pause; expo-camera releases on unmount. Timestamp `CameraService` connect/disconnect lines in logcat around each transition (AR unmount → CameraView mount, CameraView unmount → AR mount).

Resolution records, per path: dead / tracking, the measured release latencies, and whether `dumpsys media.camera` showed another client holding the camera when AR mounted. If paths 2–4 fail while path 1 tracks, H3 is confirmed and ticket 04's camera-release guard is the primary fix; if path 1 also fails, H3 is at most secondary.

## Comments
