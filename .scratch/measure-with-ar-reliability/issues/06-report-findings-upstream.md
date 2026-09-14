# 06 — Report device findings upstream (Viro #499/#513, ARCore #1762/#1784)

Type: task
Mode: HITL (agent drafts, user posts under their GitHub account)
Status: open
Blocked by: 01, 02
Part of: ../map.md

## Question

Give the upstream maintainers what they asked for — "unable to reproduce, need logcat" — so a real fix can come from them.

Drafts to prepare (the user reviews and posts):
1. **ReactVision/viro#499** (and a short cross-reference on #513): device `SM-S908U`, Android 16, security patch, ARCore versionName, `@reactvision/react-viro` 2.58.1, RN 0.86.3 new-arch dev build; the exact symptom (scene mounts, `onTrackingUpdated` never fires, black background); the logcat excerpt from ticket 01; the `hello_ar_kotlin` result from ticket 02 (this is the decisive datum for them); the observation that virocore discards `ArSession_resume`'s status (if confirmed by ticket 08's reading).
2. **google-ar/arcore-android-sdk#1762** — only if ticket 01/02 reproduce the `Failed to register sensor to queue` signature: device, build, ARCore version, whether the documented workaround helped (ticket 04). If instead VIO never reaches TRACKING with no sensor error, post to **#1784/#1785**.

Resolution records the links to the posted comments and any maintainer response worth tracking (add a pointer here if a fix lands).

## Comments
