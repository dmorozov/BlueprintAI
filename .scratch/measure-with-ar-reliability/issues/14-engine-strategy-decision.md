# 14 — Decision: AR engine strategy (keep Viro / fork virocore / owned Expo Module)

Type: grilling
Mode: HITL
Status: resolved (2026-10-15)
Blocked by: 07, 08, 12, 19, 13 (only if 19 sends 13 to run)
Part of: ../map.md

## Question

Choose the AR engine the spec commits to:

- **Keep Viro** with the Track A fixes and the `ArEngine` seam.
- **Fork/rebuild virocore** (ticket 08) to surface `ArStatus`, render the camera while not tracking, bump ARCore, add depth hits.
- **Owned Kotlin Expo Module** over ARCore 1.56 (ticket 09, spike 13), with Viro removed later (fog).

Decide against: acceptance-bar results (tickets 12, 13); the **Depth-API plain-wall requirement**; error-surface quality; ownership/maintenance cost and bus factor; toolchain impact (ticket 11); the iOS-stub obligation; effort (days) and risk. State what happens to the Viro dependency and to the reference-photo step (ticket 16) under the chosen engine, and whether Track A fixes ship to users in the meantime (fog: release sequencing).

## Answer

**Keep Viro (2026-10-15).** Resolved without its own session, by the rule ticket 12 agreed with the user, once ticket 19 passed.

| Criterion | Keep Viro | Fork virocore | Owned module |
|---|---|---|---|
| Acceptance bar (12, 04) | Passes on the S22U | Same engine | Unbuilt (13 not needed) |
| Depth-API plain-wall requirement (19) | 10/10 wall taps with `depthEnabled`; the hit type is mislabelled (upstream fix, ticket 06) | Fixes the label (one line) | Would own it |
| Error surface | Ticket 04's log reader: exact reason or best guess, meets the bar (12) | Exact ARCore status (patch a, 1.5–2 days) | Every exception |
| Effort | Done, plus app work: hit rule and tracking-loss rule (19) | ≈ 3–4.5 days + 0.5–1 day per release (08) | 6–9 days + spikes (09) |
| Toolchain (11) | No change | No change | No change |
| iOS stub obligation | Viro's iOS side as today | Same | Needs an iOS stub view |
| Bus factor / ownership | ReactVision; the `ArEngine` seam (15) keeps a swap cheap | Ours to maintain | Ours to maintain |

- **Viro dependency:** stays. Upgrade to 3.0.3 (the remount-crash fix, virocore PR #398) is a spec implementation step, re-checked by the acceptance runs, together with re-checking the four log strings ticket 04 parses.
- **Fork:** not now. It remains the fallback if the spec ever needs ARCore's exact statuses and upstream declines patch (a), or the depth-label fix is needed in code (today the app does not depend on the label: depth hits arrive as `FeaturePoint` and rank with them).
- **Reference photos:** stay on expo-camera behind ticket 04's camera wait; ticket 16 is out of scope.
- **Release sequencing:** moot. Viro with the Track A fixes is the engine, so there is no later engine to wait for.
- **App work the spec must carry (engine-agnostic, from ticket 19):** place floor-corner taps at the floor plane's height; a rule for tracking loss mid-trace (ARCore rebuilds its map and old planes stay at stale heights); depth on by default.

## Comments
- **2026-10-15, ticket 12:** error reasons (ticket 04's log reader meets the bar; patch (a) is offered upstream through ticket 06) and not controlling Viro (the `ArEngine` seam is the hedge) are ruled out as reasons to replace Viro. **If ticket 19 passes, this ticket resolves as "keep Viro" without its own session**, with the Viro 3.0.3 upgrade in the spec's implementation steps and the Track A fixes as the shipped engine, so release sequencing is moot. If 19's wall taps fail, this ticket weighs a Viro rebuild (ticket 08) against an owned module (tickets 09/13) for depth.
