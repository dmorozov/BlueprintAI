# 12 — Decision: Track A outcome — does the fixed Viro engine meet the bar, and what does that mean for Track B?

Type: grilling
Mode: HITL
Status: open
Blocked by: 01, 02, 03, 04
Part of: ../map.md

## Question

With tickets 01–04 resolved, decide:

1. Does the Viro-based engine, with the quick fixes applied, **pass the acceptance bar** on the S22U (10/10 cold launches, ≤ 5 s to tracking, background/foreground, the camera-handoff paths, failures surfaced with a reason)?
2. If **yes**: is Track B (engine replacement) still wanted — for the Depth-API plain-wall requirement, error surfacing, ownership of the seam that keeps breaking — or deferred behind upstream? Decide whether ticket 13 (owned-module spike) proceeds now, later, or is ruled out of scope.
3. If **no**: which hypothesis stands (H1 platform regression / H2 VIO / H3 handoff / H4 GL) and what does it imply — can *any* engine track on this firmware (see ticket 02/05), or is the failure Viro-specific?

Record the decision with the evidence rows (pass counts per criterion) and the resulting fate of ticket 13.

## Comments
