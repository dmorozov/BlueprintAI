# 17 — Task: a second (non-Samsung) Android test device

Type: task
Mode: HITL (only the user can source hardware)
Status: resolved (2026-09-22, not needed)
Blocked by: 05
Part of: ../map.md

## Question

**Only if ARCore itself fails on this firmware** (ticket 02 fails and ticket 05 shows 1.53 tracks where 1.56 does not): source a non-Samsung ARCore-supported Android device (e.g., a Pixel) so the engine work can be validated independently of the Samsung/Android 16 regression, and so the acceptance bar has a second data point. Record device model/OS/ARCore version and re-run tickets 02 and 04 on it.

If ticket 02 passes on the S22U, close this ticket as not needed.

## Answer

**Not needed: ticket 02 passed on the S22U (2026-09-22).** ARCore 1.56 tracks on this firmware, both in `hello_ar_kotlin` and in the Viro app since ticket 00. So there is no Samsung/Android 16 regression to route around, and ticket 05's bisect was skipped.

No device was sourced. The standing decision to get a second device applied only if ARCore could not track on this firmware, which is not the case. A second device remains optional coverage for the acceptance bar, not a prerequisite of the spec.

## Comments
