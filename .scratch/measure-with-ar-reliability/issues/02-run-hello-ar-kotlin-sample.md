# 02 — Run Google's unmodified hello_ar_kotlin sample on the S22 Ultra

Type: task
Mode: HITL (user moves the phone)
Status: resolved (2026-09-22)
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

## Answer

**Pass: ARCore itself tracks on this phone, independent of Viro.** The ticket is closed on run 1 (2026-09-14, see Comments). The planned repeat was dropped on 2026-09-22: no later decision depends on it, and the one question it could not answer moves to ticket 13.

### Against the ticket's checks

- **Camera image:** the live feed rendered from launch.
- **Tracking reached TRACKING and stayed there.**
  - VIO initialised at +2.0 s.
  - ARCore found 4 planes at +15.1–17.7 s and a fifth at +42.3 s. From +13.9 s the status read "Tap on a surface to place an object.", and floor taps placed objects.
- **No flapping.** In 114.7 s there was one tracking-loss episode, when the phone was close up against a blank wall:
  - `[VioFaultDetector] Fault: Lack of valid visual measurements for duration: 1.3s` at +91.6 s, then a map reset.
  - VIO re-initialised at +99.6 s, and there was no further loss.
  - The other six `VioFaultDetector` lines are info-level inlier warnings: one at VIO init, two at +44 s, and three in the 3 s before the fault.
  - This is ARCore's ordinary response to a textureless surface, not the repeated TRACKING↔PAUSED flapping of the *Partial* outcome.
- **Depth:** supported (the depth prompt appeared), and the depth map rendered on the carpet and on a plain wall.
- **Log signature:**

  | String | Count | Reading |
  |---|---|---|
  | `Failed to register sensor` | 0 | Not the 1.54-era #1762 failure |
  | `FEATURE_DSP_CAM_IMU_DESYNC` | 3, at +3.1, +5.1 and +7.1 s (5.0–7.1 ms) | Initialisation only, no tracking effect. This is the same benign pattern ticket 01 found in healthy Viro sessions |
  | `Callback list for SENSOR_TYPE_…` | 23, every 5 s | Benign (ticket 01) |
  | `ARCoreError` | 2, both at +99.9 s | The failed first wall tap: `depth_hit_test.cc` / `motion_stereo_manager.cc`, `No depth data found for the requested timestamp … AR_ERROR_NOT_YET_AVAILABLE`, 0.3 s after VIO re-initialised |
  | `spherical_rectifier … RET_CHECK failure` | 135 | Depth still rendered |
  | `FATAL EXCEPTION`, `ARCore threw an exception`, `Camera not available` | 0 | — |

  Only the sample held camera 0.

**Rule applied:** Pass ⇒ the fault is in Viro's integration. That fault is now known: H0, the app never mounted the navigator (ticket 00). Since the fix, Viro has tracked in 16/16 launches (ticket 00: 13, ticket 01: 3).

### Not established here

- **Whether a plain-wall tap gives a `DepthPoint` hit.**
  - The unmodified sample doesn't log hit types.
  - By +114 s a pawn stood on the wall corner with no vertical plane detected, but which tap placed it, and with which hit type, is unknown.
  - Ticket 13 already measures exactly this with logging ("does a `DepthPoint` hit land on a plain painted wall?"), so the question moves there rather than to a rerun.
- **Metric scale.** No known-length check was made, here or in the Viro runs. #1785's "tracking with wrong metric scale" failure would show up only as wrong wall lengths.
- **Wall tracking at a steady 1–2 m, and an uninterrupted pass through the depth dialogs.** This was the reason to repeat: run 1's wall phase mixed distances, and two stray touches closed dialogs. Neither changes the verdict.
- **Long sessions:** run 1 lasted 115 s.

### Consequences for the map

- **Ticket 05 (ARCore bisect):** its trigger did not occur (02 fails, or 01 shows `Failed to register sensor to queue`). Close it as skipped.
- **Ticket 17 (second device):** its own rule applies: "If ticket 02 passes on the S22U, close this ticket as not needed."
- **Ticket 06 (upstream reports):**
  - The ARCore posts don't apply. #1762 needs the sensor signature, and #1784/#1785 need VIO that never reaches TRACKING.
  - The Viro #499 draft becomes an app-side resolution note (hello_ar tracks, and so does Viro once a navigator is mounted), not a bug report. Re-scope it.
- **Ticket 04:** 02 no longer blocks it; 03 still does.
- **Metric scale:** a known-length check (a tape-measured wall) belongs in the acceptance runs of tickets 04/12 and 13.
- **The sample stays installed** as `com.google.ar.core.examples.kotlin.helloar` for any later ARCore-only check (setup in Comments). Uninstall it once it is no longer needed.

None of this was done here.

## Comments

### 2026-09-14 — paused after run 1; the user wants to repeat the test later

**Setup (reusable):**
- `hello_ar_kotlin` at tag `v1.56.0` was built with only build-config changes: compileSdk/targetSdk 36, build-tools 36.0.0, and `android.suppressUnsupportedCompileSdk=36`. The sample's source is untouched.
- It is installed on the phone as `com.google.ar.core.examples.kotlin.helloar`, and left installed.
- ARCore service is 1.56.262080393; the sample's client SDK is 1.56.261960000.
- **Before a rerun:** `pm clear` the sample and re-grant CAMERA + POST_NOTIFICATIONS, so the one-time depth prompt appears again.
- **Script:** `logs/ticket-02/scripts/helloar-trial.sh <label>`.

**Run 1 results (not final):**
- **Camera:** the live feed rendered.
- **Tracking:** VIO initialised at +2.0 s. The status read "Tap on a surface to place an object." from +13.9 s, and the floor plane grid was drawn. The first tap placed an object and opened "Your device supports depth". There were no exceptions, and only the sample held the camera.
- **Depth map:** it rendered on the carpet and on a plain wall (`run1-floor-depthmap.png`, `run1-wall-depthmap.png`).
- **Tracking loss:** tracking was lost once, close to a blank wall.
  - +91.6 s: `[VioFaultDetector] Fault: Lack of valid visual measurements for duration: 1.3s`, followed by a map reset.
  - The sample showed "Can't find anything. Aim device at a surface with more texture or color."
  - Tracking resumed at +99.6 s, and there was no further loss until the end at +114.7 s.
- **Wall tap:** the first wall tap, at +99.3 s right after recovery, failed with `No depth data found for the requested timestamp … AR_ERROR_NOT_YET_AVAILABLE`.
- **Wall object:** by +114 s a pawn stood on the wall corner above the floor plane, with no vertical plane detected. The unmodified sample doesn't log hit types, so whether it was a DepthPoint or feature-point hit, and which tap placed it, is not established.
- **Log strings:**
  - `Failed to register sensor`: 0
  - `FEATURE_DSP_CAM_IMU_DESYNC` ×3 during initialisation (+3.1, +5.1, +7.1 s; 5.0–7.1 ms), with no effect on tracking
  - `Callback list for SENSOR_TYPE_…` every 5 s
  - `spherical_rectifier … RET_CHECK failure` ×135, while depth still rendered

**Why repeat:**
- **Stray touches:** two touches not sent by adb (+39.7 s and +62.0 s, the tester's fingers) closed dialogs before the script reached "Enable" and "Done".
- **Distances unknown:** the wall phase mixed close-up and distant views.
- **Next run:** hands off the screen, and a steady 1–2 m from the wall.

**Evidence:** `logs/ticket-02/` (gitignored) holds `run1.*` and the `dry/` pre-flight run.
