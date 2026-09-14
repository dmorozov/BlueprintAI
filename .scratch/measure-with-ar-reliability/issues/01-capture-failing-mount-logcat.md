# 01 — Capture a failing Measure-with-AR mount's logcat on the S22 Ultra

Type: task
Mode: HITL (the user moves the phone; the agent drives adb)
Status: open
Blocked by: —
Part of: ../map.md

## Question

What does ARCore / Viro actually log when *Measure with AR* comes up as a **dead session** on this phone — and which root-cause hypothesis does the signature support?

Protocol (repeat 3×, cold launch each time):
1. Build & install the current app (`npx expo run:android`), confirm ARCore versionName via `adb shell dumpsys package com.google.ar.core | grep versionName`.
2. `adb logcat -c`; open *Measure with AR*; user moves the phone slowly over a textured floor for ~20 s.
3. `adb logcat -d > logs/ar-dead-<n>.txt` (the `logs/` dir is gitignored). While the view is black: `adb shell dumpsys media.camera > logs/camera-<n>.txt`.
4. Grep: `ARCoreError|Failed to register sensor|CAM_IMU_DESYNC|clock offset|kNotTracking|VisualInertialState|CameraService|AR_ERROR|ArSession|AR session resumed|MissingGlContext|Viro|VRO|EGL|SurfaceTexture`.
5. Add a temporary `console.log` in `handleTrackingUpdated` (`ar-capture-screen.tsx`). virocore forces exactly **one** `onTrackingUpdated(UNAVAILABLE, NONE)` at scene creation and then only reports *changes*; seeing that one callback proves the JS bridge is alive and the session is paused / never tracking (H1/H2), while seeing none points at the bridge or GL surface (H4). Note also that virocore logs "AR session resumed" unconditionally — its presence proves nothing.

Resolution records: the exact error strings found (or their absence), whether the session was ever *resumed* successfully, whether another client held the camera, and which hypothesis the evidence supports — H1 (`Failed to register sensor to queue` — the #1762 resume failure, documented on Play Services for AR 1.54.x; whether 1.56 still has it is unknown), H2 (camera-to-IMU clock offset > 5 ms / VIO never stabilises — #1784/#1785, documented on 1.56 with the camera feed *visible* in hello_ar), H3 (camera busy after expo-camera), H4 (GL/EGL/camera texture never starts). Attach the log paths.

Also record from the user: when did Measure with AR last work on this phone, and was that before or after the ARCore update of 2026-08-29 / the 2026-08-05 security patch? (`adb shell dumpsys package com.google.ar.core | grep -i "install\|update"`.)

## Comments
