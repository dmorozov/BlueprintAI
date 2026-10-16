# 18 — Task: write `docs/specs/measure-with-ar-reliability.md` (the destination)

Type: task
Mode: AFK draft, HITL review
Status: resolved (2026-10-15)
Blocked by: 12, 14, 15, 16
Part of: ../map.md

## Question

Assemble the decision-complete spec from the resolved tickets (use the `to-spec` skill if available): goal and acceptance bar; the chosen engine strategy and why (ticket 14); architecture — the `ArEngine` seam (15), the engine (Viro-fixed / forked / owned module per 09), reference photos (16), Depth-API hits; the pre-requisite experiments and their **recorded results** (01–05, 13); migration/implementation steps sized for `/implement` sessions; test plan on the S22U; effort and risks; out-of-scope list (iOS parity, WebXR, headless ARCore, paid APIs, model-as-engine); upstream status (06). Link the research branches.

Closing this ticket reaches the destination.

## Answer

**The spec is written and approved by the user (2026-10-15):** `docs/specs/measure-with-ar-reliability.md`, `Status: ready-for-agent`; the device-run steps need the user with the phone.

- It follows the project's to-spec template: problem, solution, 26 user stories, implementation decisions, testing decisions, out of scope, further notes. The ticket's own sections are added: recorded experiment results (tickets 00–19), six implementation steps sized for `/implement` (about 3.5–4.5 dev-days, three device sessions), effort and risks, upstream status (06), and the research branches.
- The seam (ticket 15) is the test seam: pure `placeCorner`, `viroEngineStatus` and hit mapping, with fixtures from real device logs, plus a 9-row device test plan.
- **Added in the draft and approved with it:**
  - a release-build check (plan row 9, step 6), because reading the app's own log is verified on debug builds only;
  - pass marks for the background and camera rows ("Tracking good" again without a restart; 0 evictions);
  - the effort figures and step boundaries.
- **Location:** the map's `docs/specs/` path, not the tracker convention's `.scratch/<feature>/spec.md`.

## Comments
