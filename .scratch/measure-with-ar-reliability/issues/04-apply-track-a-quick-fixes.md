# 04 — Apply the Track A quick fixes inside the Viro stack and re-test

Type: task
Mode: AFK build, HITL test (user moves the phone)
Status: open
Blocked by: 01, 02, 03, 07
Part of: ../map.md

## Question

With the quick fixes that the experiments and ticket 07's recipes justify applied — and **nothing else changed** — does the current Viro-based AR engine pass the acceptance bar on the S22U?

Candidate fixes (apply the ones the evidence supports, on a branch):
- **#1762 sensor workaround**: `android.permission.HIGH_SAMPLING_RATE_SENSORS` in the manifest (config plugin) + no-op `SensorEventListener`s registered on `TYPE_GYROSCOPE_UNCALIBRATED` / `TYPE_ACCELEROMETER_UNCALIBRATED` *before* Viro creates its ARCore session (placement per ticket 07).
- **Camera-release guard**: ensure `expo-camera` is fully unmounted and the device camera free before `ViroARScene` mounts (verify with `dumpsys media.camera`; add a wait/verify step rather than a blind delay).
- **Error surfacing**: wire whatever Viro exposes (`onError`, tracking-reason props) so a failure shows a reason instead of a black view.
- **ARCore client swap** (only if ticket 07 recommends it): replace the *whole* `arcore_client` AAR with stock `com.google.ar:core:1.56.0` **and** strip the renderer AAR's bundled 1.51 `libarcore_sdk_c.so` — the 1.56 native shim calls into 1.56's `classes.jar` (`useProjectedApk`), so a lib-only swap cannot work. Delivered under CNG (`android/` is gitignored) by the mechanism ticket 07 picks. Verify in logcat that ARCore reports `SDK build name: 1.56`.

Test protocol: the acceptance bar — 10 consecutive cold launches, ≤ 5 s to "Tracking good" while moving over a textured floor; background→foreground; the ticket 03 paths. Record pass counts and logcat excerpts.

Resolution records: which fixes were applied (files/branch), pass/fail per criterion, and the remaining failure signature if any. Feeds ticket 12 (Track A outcome).

## Comments
