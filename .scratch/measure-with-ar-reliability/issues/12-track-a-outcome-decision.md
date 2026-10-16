# 12 — Decision: Track A outcome — does the fixed Viro engine meet the bar, and what does that mean for Track B?

Type: grilling
Mode: HITL
Status: resolved (2026-10-15)
Blocked by: 01, 02, 03, 04
Part of: ../map.md

## Question

With tickets 01–04 resolved, decide:

1. Does the Viro-based engine, with the quick fixes applied, **pass the acceptance bar** on the S22U (10/10 cold launches, ≤ 5 s to tracking, background/foreground, the camera-handoff paths, failures surfaced with a reason)?
2. If **yes**: is Track B (engine replacement) still wanted — for the Depth-API plain-wall requirement, error surfacing, ownership of the seam that keeps breaking — or deferred behind upstream? Decide whether ticket 13 (owned-module spike) proceeds now, later, or is ruled out of scope.
3. If **no**: which hypothesis stands (H1 platform regression / H2 VIO / H3 handoff / H4 GL) and what does it imply — can *any* engine track on this firmware (see ticket 02/05), or is the failure Viro-specific?

Record the decision with the evidence rows (pass counts per criterion) and the resulting fate of ticket 13.

## Answer

**Viro with the Track A fixes passes the acceptance bar on the S22U, and an engine replacement is not wanted for error reasons or for ownership. Only the Depth-API wall-tap requirement could still force one, so the engine decision now waits for a wall-tap and length check on Viro (ticket 19). Decided with the user, 2026-10-15.**

### 1. The bar (evidence from ticket 04, 2026-09-23)

| Criterion | Result | Decision |
|---|---|---|
| 10/10 cold launches, ≤ 5 s to "Tracking good" | 10/10. Engine attach → tracking 1.29–3.60 s. One run took 7.82 s from the tap because the JS screen mounted slowly; ARCore tracked 2.33 s after resume | **Pass** |
| Background → foreground | 3/3, tracking 1.04–1.24 s after resume | **Pass** |
| Camera screens before AR | 6/6 (plus 8/8 in ticket 03) | **Pass** |
| Every failure shows a human-readable reason | Exact reason: install/update/declined/unsupported, permission, the #1762 sensor failure, a camera held by another app, blank frames (privacy toggle). Best guess, from how far start-up got: a failed create, a non-sensor resume failure, a mid-session update failure. Catch-all: "AR didn't start" plus the best guess at 10 s | **Pass.** A readable best guess meets the bar; ARCore's exact status is not required |

- **Metric scale was never checked** (ticket 02's gap). It applies to any engine, so it is not a blocker here: a known-length check runs in ticket 19's phone session and goes into the spec's test plan.
- One phone and a debug build only. The install/update messages are unit-tested only. Both are recorded in ticket 04.

### 2. Track B

- **Error reasons are not a reason to replace or fork Viro.** Ticket 04's log reader stays. Ticket 08's patch (a), which passes ARCore's status to JS, is offered upstream through ticket 06 and adopted if ReactVision merges it. The failure classes that only get a best guess never occurred on this phone.
- **Not controlling Viro is not a reason on its own** to replace it. Viro stays behind the `ArEngine` seam (ticket 15), which keeps a later swap cheap; it is replaced only for a concrete failure.
- **The Depth-API wall-tap requirement is unverified on Viro.** Viro 2.58.1 has `depthEnabled` and the `DepthPoint` hit type (ticket 08 §3.4), but no tap has been tried on the phone, and the screen takes `results[0]` whatever its type. **Ticket 19** checks it on Viro 2.58.1 before the engine decision, with this pass bar:
  - **Plain wall:** with depth on, 1–3 m from a plain painted wall, at least 9 of 10 taps hit the wall. Repeated with depth off for comparison.
  - **Length:** two taps on the ends of a tape-measured 1–3 m length are within 3%, three tries.
  - **Room corners:** about 20 taps at 1–4 m with depth on and off; hit types are recorded with no pass mark, to set the defaults.
- **Viro 3.0.2/3.0.3 (checked 2026-10-15):** no change to error reporting, the four log strings, ARCore (still 1.43 Java / 1.51 native) or depth; peers still RN 0.86 / Expo 57. 3.0.2 fixes a SIGSEGV in `AAssetManager_open` on navigator remount (virocore PR #398), never seen here. **The check runs on 2.58.1** for comparability with tickets 00–04, and the 3.0.3 upgrade goes into the spec's implementation steps, re-checked by the acceptance runs.
- **viro#568** (2026-10-08, Samsung A56, Android 16, the same Viro/Expo/RN versions): tracking flips UNAVAILABLE ↔ NORMAL about 10 times a second with no planes. It matches the ARCore-side Samsung reports #1784/#1785, where hello_ar misbehaves too, so another engine would not fix it, and the S22U never flapped. No change to the decision; ticket 06 replies on #568 with the S22U results and asks for a hello_ar run.

### 3. Consequences for the map

- **Ticket 19** (new): the wall-tap and length check on Viro. It blocks 13 and 14.
- **If 19 passes:** ticket 13 closes as not needed; ticket 14 resolves as "keep Viro" (with the 3.0.3 upgrade and the upstream offer) without its own session; ticket 16 goes out of scope, and reference photos stay on expo-camera behind the camera wait.
- **If the wall taps fail:** ticket 13 runs, re-scoped to wall taps directly on ARCore (hello_ar showed depth on a plain wall in ticket 02), and ticket 14 weighs a Viro rebuild against an owned module.
- **If only the length check fails:** a diagnosis ticket comes first. The tap-to-position mapping could be the cause (as with ticket 00's dp/px bug), and that would affect any engine.
- **Either way:** ticket 15 stays (the seam is the hedge behind §2). Ticket 06 is re-scoped to viro#499 (S22U results, plus patch (a) offered) and a reply on #568; the ARCore #1762/#1784 posts are dropped, since ticket 02 showed they don't apply.
- **Glossary:** `CONTEXT.md`'s Dead session is now "mounted but never started tracking (limited or good), whatever other states it reported"; Viro's forced "unavailable" at mount made the old wording miss the black view. The screen's "stall" names became dead-session names (`deadSessionReason`, `DEAD_SESSION_TIMEOUT_MS`).

## Comments
- **2026-10-15, correction (ticket 06):** the viro#568 point in §2 is wrong. Its body says plain ARCore apps (Google's "View in your space", a Play Store ARCore tape measure) **work** on the A56, so the A56 failure is Viro-specific, not the #1784/#1785 case, and another engine could avoid it. A candidate cause found while drafting 06: Viro always overrides ARCore's default camera config with the largest CPU image (1920×1080 on the S22U; `SessionNative` constructor). The decision for the S22U is unchanged (it never flapped); the risk for other Samsung phones is larger than stated, and it is recorded in the spec's risks.
