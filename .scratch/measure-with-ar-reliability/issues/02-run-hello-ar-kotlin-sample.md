# 02 — Run Google's unmodified hello_ar_kotlin sample on the S22 Ultra

Type: task
Mode: HITL (user moves the phone)
Status: open
Blocked by: —
Part of: ../map.md

## Question

Does **ARCore itself** work on this phone, independent of Viro? This single run separates "device/ARCore-level fault" from "Viro-level fault".

Steps:
1. Clone `google-ar/arcore-android-sdk` at tag `v1.56.0`; build `samples/hello_ar_kotlin`. **Build note:** the sample pins compileSdk 37 but the local SDK only has `android-36`/`android-36.1` — either set the sample's compileSdk/targetSdk to 36 (the 1.56.0 AAR has no minCompileSdk floor) or `sdkmanager "platforms;android-37"` plus an AGP 9.x wrapper. Install via `adb install`.
2. `adb logcat -c`; launch; user moves the phone over a textured floor for ~30 s, then points at a plain wall.
3. Record: does the camera image render at all? Does tracking reach TRACKING and *stay* there (planes appear, taps place anchors), or does it flap TRACKING↔PAUSED / re-initialise repeatedly? Toggle the sample's depth option and note whether depth renders. `adb logcat -d | grep -E "Failed to register sensor|ARCoreError|CAM_IMU|clock offset|kNotTracking|TrackingFailureReason"`.

Known Samsung/Android 16 failure modes to recognise: **1.54-era** — `Session.resume()` throws, log "Failed to register sensor to queue 0" (#1762); **1.56-era** — camera feed shows but "Camera to IMU clock offset exceeds threshold (5ms)", VIO repeatedly resets (`VisualInertialState is kNotTracking`), or tracking flaps with wrong metric scale (#1784/#1785). Both are open with no Google fix as of 2026-09-14.

Resolution records pass/fail and the log signature. **Fail ⇒** the fault is platform-level (H1/H2): ticket 05 (ARCore bisect) becomes the next step and any engine replacement is moot until ARCore tracks. **Pass ⇒** the fault is in Viro's integration; Track A / Track B proceed. **Partial (camera shows, tracking unstable) ⇒** H2; note that Viro would show *black* in this state while hello_ar shows the feed — the same device state looks like a dead session in Viro.

## Comments
