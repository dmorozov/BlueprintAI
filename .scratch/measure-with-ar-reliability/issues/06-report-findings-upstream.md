# 06 — Report device findings upstream (Viro #499/#513, ARCore #1762/#1784)

Type: task
Mode: HITL (agent drafts, user posts under their GitHub account)
Status: claimed
Blocked by: 01, 02
Part of: ../map.md

## Question

Give the upstream maintainers what they asked for — "unable to reproduce, need logcat" — so a real fix can come from them.

Drafts to prepare (the user reviews and posts):
1. **ReactVision/viro#499** (and a short cross-reference on #513): device `SM-S908U`, Android 16, security patch, ARCore versionName, `@reactvision/react-viro` 2.58.1, RN 0.86.3 new-arch dev build; the exact symptom (scene mounts, `onTrackingUpdated` never fires, black background); the logcat excerpt from ticket 01; the `hello_ar_kotlin` result from ticket 02 (this is the decisive datum for them); the observation that virocore discards `ArSession_resume`'s status (if confirmed by ticket 08's reading).
2. **google-ar/arcore-android-sdk#1762** — only if ticket 01/02 reproduce the `Failed to register sensor to queue` signature: device, build, ARCore version, whether the documented workaround helped (ticket 04). If instead VIO never reaches TRACKING with no sensor error, post to **#1784/#1785**.

Resolution records the links to the posted comments and any maintainer response worth tracking (add a pointer here if a fix lands).

## Comments
- **2026-10-15, ticket 12 re-scope:**
  1. **viro#499** (cross-reference #513): the dead session on the S22U was app-side (the navigator was never mounted, ticket 00); with it mounted Viro passes the acceptance bar (ticket 04); hello_ar tracks (ticket 02). The useful finding for them: Viro drops ARCore's status on create/resume/update and only logs `onRendererFailed`, so apps cannot show why AR failed. **Offer ticket 08's patch (a)** (`onSessionError`, in the style of upstream's `onDepthReady`; diffs in `logs/ticket-08/patches/`).
  2. **viro#568** (Samsung A56, Android 16, tracking flapping): reply with the S22U results (no flapping on the same Viro/Expo/RN versions) and ask for a hello_ar run, pointing at ARCore #1784/#1785.
  - **Dropped:** the ARCore #1762/#1784 posts. `Failed to register sensor` never appeared and hello_ar tracks here (tickets 01, 02, 04).
- **2026-10-15, ticket 19 additions:**
  3. **Viro bug: depth hits are reported as `FeaturePoint`.** `HitResultNative::acquireTrackable` (`android/viroar/src/main/cpp/arcore/ARCore_Native.cpp`) returns `nullptr` for every trackable but a plane, so `VROARFrameARCore::hitTest`'s `DepthPoint` branch never runs and `hasDepthData` is always false on Android (v2.58.1 through `main`). Repro: `depthEnabled` on, tap a plain wall; ARCore returns a depth hit, JS sees `FeaturePoint`. Offer the one-line fix (wrap any trackable in `PlaneNative`, whose `getType` already maps `AR_TRACKABLE_DEPTH_POINT`). Fits as its own issue or a PR, cross-linked from #499.
  - For #568 (and ARCore #1784 if posting there after all): the S22U on Play Services for AR 1.57.262640093 logged `FEATURE_DSP_CAM_IMU_DESYNC` (camera-to-IMU clock offset −5.90 ms > 5 ms) once at start, with tracking otherwise normal and no flapping.
- **2026-10-15, drafts ready for the user to post** (`../upstream/`; issues re-checked the same day: #499/#513 silent since 2026-08-24, #568 unanswered, no existing DepthPoint issue):
  1. `1-viro-499-comment.md`: answers the maintainer's request for logcat. Our black view was app-side (no navigator); a quick log check for others; Viro drops `ArStatus` on create/resume/update and only logs `onRendererFailed`; offers patch (a) as a PR.
  2. `1b-viro-513-crosslink.md`: a short pointer from #513 to the #499 comment.
  3. `2-viro-depthpoint-issue.md`: a new issue. `acquireTrackable` returns `nullptr` for non-plane hits, so `DepthPoint` never reaches JS, and the non-plane `ArTrackable` leaks; a possible fix is included (not built).
  4. `3-viro-568-comment.md`: S22U data (no flapping), and the answer to the reporter's camera-config question. Viro always selects the largest CPU image config; a test is suggested.
  - **Correction found while drafting:** #568's reporter says plain ARCore apps work on the A56, so it is Viro-specific (ticket 12 corrected, spec risk updated).
