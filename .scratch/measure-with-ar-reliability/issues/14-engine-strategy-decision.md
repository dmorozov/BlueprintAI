# 14 — Decision: AR engine strategy (keep Viro / fork virocore / owned Expo Module)

Type: grilling
Mode: HITL
Status: open
Blocked by: 07, 08, 12, 13
Part of: ../map.md

## Question

Choose the AR engine the spec commits to:

- **Keep Viro** with the Track A fixes and the `ArEngine` seam.
- **Fork/rebuild virocore** (ticket 08) to surface `ArStatus`, render the camera while not tracking, bump ARCore, add depth hits.
- **Owned Kotlin Expo Module** over ARCore 1.56 (ticket 09, spike 13), with Viro removed later (fog).

Decide against: acceptance-bar results (tickets 12, 13); the **Depth-API plain-wall requirement**; error-surface quality; ownership/maintenance cost and bus factor; toolchain impact (ticket 11); the iOS-stub obligation; effort (days) and risk. State what happens to the Viro dependency and to the reference-photo step (ticket 16) under the chosen engine, and whether Track A fixes ship to users in the meantime (fog: release sequencing).

## Comments
