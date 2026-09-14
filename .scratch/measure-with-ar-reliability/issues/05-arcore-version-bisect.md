# 05 — ARCore version bisect on the S22 Ultra (sideload 1.53, then restore 1.56)

Type: task
Mode: HITL (user moves the phone; user may need to confirm Play Store restore)
Status: open
Blocked by: 02
Part of: ../map.md

## Question

**Only if ticket 02 fails (hello_ar does not track) or ticket 01 shows the `Failed to register sensor to queue` signature.** Does downgrading Google Play Services for AR to 1.53 restore tracking for both `hello_ar_kotlin` and the app — confirming H1 (ARCore ≥ 1.54 Samsung Android 16 regression, google-ar/arcore-android-sdk#1762)?

Steps:
1. Obtain the 1.53 APK from an official source only (the `google-ar/arcore-android-sdk` GitHub release assets if they carry the Play Services for AR APK; otherwise **skip this ticket** — no third-party APK mirrors).
2. Record the current versionName; remove the newer version (`adb shell pm uninstall -k --user 0 com.google.ar.core` or uninstall updates if it is a system component — work out what this device allows and record it); `adb install` 1.53.
3. Re-run ticket 02's and ticket 01's protocols.
4. **Restore 1.56 the same session** (Play Store update or reinstall) and confirm versionName.

Resolution records: whether 1.53 tracks where 1.56 did not (app and sample separately). A positive result confirms the platform regression and — since end users' ARCore version cannot be controlled — means the shipped fix must be the app-side workaround (ticket 04) or wait for Google's hotfix; it also unblocks ticket 17 (second device). If skipped or negative, close with the reason.

## Comments
