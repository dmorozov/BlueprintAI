# BlueprintAI — User Experience Analysis

**Date:** 2026-09-13. **Scope:** full application review of the current UI (all 7 screens, shared components, session store) for user-experience improvements. Every finding is grounded in the current code; file references point at `src/`. This is an analysis only — no code changes.

**Reviewed:** `home-screen`, `ar-capture-screen`, `capture-screen` (legacy mock flow), `photo-assist-screen`, `blueprint-screen`, `room-list-screen`, `align-screen`, plus `blueprint-svg`, `photo-strip`, `toast-bubble`, `session-store`, `ar-capture`, `ai-provider`.

---

## What already works well (keep)

- **Honest labeling invariants hold everywhere:** AR-measured, photo-assisted, and mock plans are never conflated in the UI; assisted plans carry "auto-detected — verify" text and capped confidence.
- **Camera robustness is consistent** across all three camera screens: permission gate, `onMountError` retry with remount key-bump, preview unmount on blur per expo-camera docs.
- **Feature flagging** (`EXPO_PUBLIC_PHOTO_ASSIST_URL`) keeps the assist flow invisible unless configured; per-photo server errors are non-fatal.
- **Good microcopy in places:** tracking badge states, "No surface detected — aim at the corner and move around slowly", photo-assist camera hint ("Hold the phone level, 2–3 m from each wall").
- Destructive actions (delete room) confirm via `Alert`; most pressables have `accessibilityRole`.

---

## Findings summary

| ID  | Sev | Area         | One-liner                                                                                                                     |
| --- | --- | ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| F1  | P0  | Data safety  | Nothing persists; closing the app loses every room, photo, and plan — with no warning                                         |
| F2  | P0  | Photo assist | Review silently saves only the _selected_ photo's walls; multi-photo curation is discarded                                    |
| F3  | P0  | Blueprint    | "Re-measure with AR" / "Retake photos" buttons just navigate back; re-measuring a room in place is impossible                 |
| F4  | P1  | Rooms        | Capture screens create the room on mount → abandoned visits leave empty "Room N" cards                                        |
| F5  | P1  | Blueprint    | No area (m²) anywhere, despite polygons being available — the core number users measure for                                   |
| F6  | P1  | Blueprint    | No zoom/pan on the plan view; dimension labels scale in world units and become unreadable                                     |
| F7  | P1  | AR capture   | No shape feedback while tracing (no corner lines/numbers, no live lengths); undo silently wipes openings                      |
| F8  | P1  | Onboarding   | No first-run explanation of the three flows; no coach overlay for tap-to-trace                                                |
| F9  | P1  | Photo assist | No level indicator (level camera is a hard assumption); upload has no cancel/progress; failed-photo errors are count-only     |
| F10 | P1  | Room list    | No plan thumbnails or dates; "Add photos" is misleading on AR rooms; combine is all-or-nothing                                |
| F11 | P1  | Copy         | Jargon in user-facing labels: "self-hosted", "AR session", "mock plan", "other AR sessions"                                   |
| F12 | P1  | Align editor | Free drag only — no snapping, guides, or fine nudge; no way to un-align a saved placement                                     |
| F13 | P2  | Home         | Dev leftovers: "Test" button ("Test clicked!" toast) and "React Native · Expo · TypeScript" tagline                           |
| F14 | P2  | Error paths  | AR-unsupported screen suggests the _mock_ flow (fake plans) with no action button; no settings deep-link on permission denial |
| F15 | P2  | Routing      | `photo-assist` route missing from `_layout.tsx` Stack → default header title, inconsistent with curated titles                |
| F16 | P2  | Export       | SVG/JSON/DXF shared as raw text in the share sheet; no file download or naming                                                |
| F17 | P2  | Feedback     | No haptics anywhere; toasts are the only error channel (2.5 s); width validation via toast instead of inline                  |
| F18 | P2  | Photo assist | Per-wall confidence not shown in review (data exists); "Retake photos" clears curation without warning                        |
| F19 | P2  | A11y         | Toggle chips don't expose selected state; align canvas has no non-gesture input path                                          |
| F20 | P2  | Polish       | Reference-photo strip is inert (no lightbox); combined view doesn't visually distinguish anchor vs aligned rooms              |

---

## P0 — trust and data integrity

### F1. No persistence, no warning — total data loss on app close

`session-store.ts` is in-memory by design ("cleared on reload — acceptable for a prototype; persistent storage is Phase 3"). But the UI gives **no indication** that work is ephemeral. A user who measures three rooms over an afternoon loses everything when Android reclaims the background app or they force-close it — and the room list silently appears empty next launch.

This is the single biggest real-world trust risk in the app.

- **Minimum (cheap):** a persistent banner on home/rooms ("Work is kept only while the app is open — export blueprints to save them") plus an export nudge after each finished room.
- **Real fix:** Phase 3 persistence (plans + placements + labels in AsyncStorage/SQLite; photos as files). Even persisting plans-only (not photo bytes) would protect the valuable data.

### F2. Photo-assist review silently saves only the selected photo's walls

In `photo-assist-screen.tsx`, `handleSavePlan` builds the plan from `keptWalls`, which is derived **only from `selectedResult`** (the currently selected photo). The header says "Pick a photo, tap walls to remove false positives, then save" — which reads as "curate everything, then save all of it". In practice:

- A user who removes false positives on photos 1 and 2, then selects photo 3 and taps "Save plan (4 walls)", gets a plan containing **only photo 3's** kept walls. All other curation is silently discarded.
- The design intent (each photo = its own independent frame, unique `assist-<roomId>`) actually means _one photo → one room_, but the UI never says that.

**Recommendation:** make the model explicit in the UI. Either:

1. Per-photo save: each result card gets "Save as room (N walls)" — saving creates one room per saved photo, and the user can save several; or
2. A single explicit selection step: "Which photo should this room come from?" with one selected at a time, and copy that states only that photo's walls are used.

Option 1 matches the frame semantics better and turns a silent data-loss path into an intentional multi-room workflow (rooms then combine via the align editor, as designed).

### F3. Blueprint action buttons don't do what they say

`blueprint-screen.tsx`:

```ts
const handleRecapture = () => {
  if (isPhotoAssist) router.push(`/photo-assist?room=${roomId}`);
  else handleBack(); // ← router.back()
};
```

- For an AR-measured room the button reads **"Re-measure with AR"** but pressing it just navigates back to the room list.
- For a mock room, **"Retake photos"** also just goes back.
- Only the photo-assist branch actually works as labeled.

Worse, `ar-capture-screen.tsx` **never accepts `?room=`** — it always calls `createRoom()` on mount — so there is no path to re-measure an existing room in place at all; a new measurement always spawns a _second_ room, and the old plan/room must be deleted manually.

**Recommendation:** (a) make `ar-capture` join an existing room via `?room=` (it already has all the store plumbing), and route "Re-measure with AR" there; (b) decide replace-vs-new semantics for re-measurement (suggest: confirm "Replace Room 2's plan?" when a plan exists); (c) at minimum, fix labels to match behavior until then.

---

## P1 — primary-flow friction

### F4. Rooms are created eagerly on screen mount → empty-room litter

`ar-capture-screen.tsx` (`useState(() => createRoom())`), `capture-screen.tsx`, and `photo-assist-screen.tsx` all create the room **when the screen mounts**, before any input. A user who opens "Measure room with AR", glances at the camera, and backs out leaves a permanent "Room 3 — 0 photos · no plan yet" card in the list. The room list has no way to distinguish "abandoned draft" from real work.

**Recommendation:** create the room lazily on first meaningful input (first corner tap / first photo), or prune empty rooms (no photos, no plan) on unmount. Lazy creation is cleaner and also fixes F3's join semantics naturally.

### F5. No area anywhere — the number users actually want

For a measurement app, **m² is the headline output**, yet neither the blueprint summary ("4 walls · 1 room · 2 openings") nor the room list shows an area. The polygons are already in `FloorPlan`; shoelace per room + total is a few lines (`blueprint-schema.ts` helpers already exist for bounds/centroid).

**Recommendation:** show "≈ 13.0 m²" per room in the blueprint summary and on room-list cards; total area in combined mode. This is the highest value-per-effort item on this list and also gives users an instant sanity check on measurement quality (a 4 m × 3 m room reading 25 m² flags a bad trace immediately).

### F6. Blueprint view: no zoom/pan, labels scale with the plan

`BlueprintSvg` renders a static fit-to-area `viewBox`. Consequences:

- No way to inspect openings or tight corners — everything is scaled to fit one screen.
- Dimension label font size is **0.28 world-meters** (`blueprint-svg.tsx`): on a 4 m room the labels are huge; on a 20 m plan they're sub-pixel. Same for room labels (0.45 m).

**Recommendation:** add pinch-zoom + pan (react-native-gesture-handler is already a dependency, used by the align editor) and/or counter-scale text so label size stays constant in screen space. Even zoom buttons (+/−/fit) would be a big step up.

### F7. AR capture: no shape feedback while tracing

While walking the room, the user sees only isolated red spheres (0.1 m radius) at tapped corners. There is:

- **No line connecting consecutive corners** — the polygon being formed is invisible; a skipped or doubled corner is undetectable until after "Finish".
- **No numbering** — spheres are identical; the user can't tell which corner is #1 vs #5, so ordering mistakes (the main failure mode of tap-to-trace) surface only later as a weird plan.
- **No live wall length** — "Wall 3: 2.41 m" after each tap would give immediate quality feedback (a 9 m "wall" is obviously a missed corner).
- **No opening preview** — in opening mode the tapped position isn't marked before "Add"; the user commits blind to where on the wall it landed.

Related: `ArCaptureSession.addCorner`/`undoCorner` **silently discard all recorded openings** (wall indices shift). Undoing a corner after adding two doors loses both with no toast.

**Recommendation:** render `ViroLine`s between consecutive corners (and a dashed last→first), number the markers, show the last measured wall length in the bottom bar, preview the pending opening position as a marker, and toast "Corner removed — 2 openings were cleared; re-add them" when that happens.

### F8. No onboarding at all

First launch lands on five buttons with no explanation of what the app does, which flow to pick, or how accuracy works. The three flows have very different tradeoffs (AR = real measurements but must walk the room; photo assist = approximate, needs your server; mock = sample data for UI testing only), and nothing conveys that.

Inside AR capture, the only instruction is the bottom-bar hint "Tap each wall corner in order (N so far)" — a first-time user still doesn't know to start at a corner, walk clockwise, when to switch to Openings mode, or why Finish is disabled until 3 corners.

**Recommendation:** a dismissible first-run sheet on home (three flows, one line each, "photos never leave your device/network" privacy note) plus a 3-step coach overlay on the first AR capture (start at a corner → walk and tap in order → add openings, then Finish). Persist dismissal in AsyncStorage.

### F9. Photo assist: quality-critical assumption unaided; long wait unmanaged

- **Level camera is a hard assumption** of the whole approach (documented in the service README), but the camera step has no level indicator. A tilted phone silently degrades wall geometry with zero feedback. A bubble-level overlay (expo-sensors) or at least a horizon guide line would directly improve output quality.
- **Upload phase:** spinner + "this usually takes a few seconds". Six photos through MoGe on a mid-range GPU can take well over 30 s, and there is **no cancel button** (the client has an `AbortController` internally but no UI reaches it) and no progress ("Analyzing photo 2 of 6…").
- **Failed photos:** review shows "2 photos could not be processed" — which ones and why is in `entry.error` but never rendered.

**Recommendation:** level indicator on the camera step; per-photo progress + Cancel on upload; list failed photos with their error under each result card (or a tappable "2 failed" row).

### F10. Room list: not scannable, and one misleading action

- Cards show label + photo count + plan status only. **No plan thumbnail** (a 64 px `PlanElements` render would make the list instantly recognizable), **no date** (`createdAt` is stored and used for sorting but never displayed), no area (see F5).
- **"Add photos" on an AR-measured room is misleading:** it routes to the legacy mock capture flow, whose photos feed nothing — AR plans can't be regenerated from photos. The button should be contextual ("Reference photos" for AR rooms) or hidden.
- **Combine is all-or-nothing:** "Combine N room plans" merges _every_ plan-bearing room. With five rooms where you want three, there's no selection. (Minimum: a multi-select sheet before combining; the align editor already handles the placement side.)

### F11. Jargon leaking into user-facing copy

| Current                                           | Where              | Suggestion                                                                                                                                                                                                |
| ------------------------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Photo assist (self-hosted)"                      | home button        | "Measure with photos" (self-hosting is an operator detail)                                                                                                                                                |
| "Photos (mock plan)"                              | home button        | If kept for real users at all: "Sample plan from photos (testing)" — or hide behind a debug flag; it's dev tooling on the primary screen                                                                  |
| "Next room (new AR session)" / "(same session)"   | AR finished bar    | "Next room" + a one-line note where it matters: "Taking reference photos restarts tracking, so this room will need manual alignment when combined" — say it _at the decision point_, not in code comments |
| "Rooms from other AR sessions"                    | combined blueprint | "Rooms that need alignment" (the list also contains photo-assist rooms, which aren't AR sessions)                                                                                                         |
| "AR-measured plan / photo-assisted plan — verify" | room list          | Fine-ish; consider "Measured in AR" / "From photos — check it"                                                                                                                                            |

### F12. Align editor: precise alignment is hard, and un-aligning is impossible

The editor offers free drag + ±15°/±90° rotation buttons. Lining two walls up within a few centimeters by dragging at screen scale is genuinely difficult — there are no snap-to-vertex/edge guides, no distance readout while dragging, and no fine nudge (±5 cm). Since manual alignment is the _only_ way cross-session and assist rooms join the blueprint, this friction sits on the critical path of multi-room use.

Also: once a placement is saved there is **no way to clear it** — `setPlacement(roomId, null)` exists in the store but no UI calls it; "Re-align" re-opens the editor but the room stays in the combined view with its old placement until overwritten.

**Recommendation:** snap the movable room's vertices/edges to nearby base-plan geometry (with a visual tick when snapped), show live offset while dragging, add ±5 cm nudge buttons, and a "Remove from blueprint" action that clears the placement.

---

## P2 — polish and correctness details

### F13. Home screen dev leftovers

- A **"Test" button** whose only effect is a "Test clicked!" toast (`home-screen.tsx`) — remove.
- Tagline **"React Native · Expo · TypeScript"** — developer boilerplate; replace with a product line ("Turn your rooms into measured floor plans").
- No summary of existing work: if rooms exist, home could show "3 rooms · 2 with plans" and a continue affordance instead of a static hint.

### F14. Dead-end / misleading error paths

- AR-unsupported screen: "Try the photo-based mock flow instead" — but there's no button to it (only "Go back"), and directing real users to a flow that produces _sample_ plans is actively misleading. Suggest photo assist if configured, otherwise state the limitation plainly.
- Permission-denied screens (AR + both camera flows): "Allow it in system settings, then reopen" — add an "Open settings" deep link where the platform allows it.

### F15. `photo-assist` route missing from `_layout.tsx`

Every other screen declares a curated `Stack.Screen` title; `photo-assist` has no entry, so its header falls back to the default (un-curated) title. One-line fix.

### F16. Export shares raw text

`sharePlan` puts the entire SVG/JSON/DXF string into `Share.share({ message })`. A multi-room DXF in a share-sheet text field is awkward and some targets truncate it. Write to a file (`expo-file-system`, already used by gallery-save) with a sensible name (`blueprint-room-2-2026-09-13.dxf`) and share the URI; keep "Save image to gallery" as-is (it's good).

### F17. Feedback polish

- **No haptics anywhere** — corner taps, opening adds, saves, and errors would all benefit from `Vibration` pulses (corner tap confirmation is especially valuable since success is currently a small sphere with no sound/feel).
- Toasts are the only error channel and auto-dismiss in 2–2.5 s; validation errors ("Width must be between 0.1 m and 4 m") should be inline (red border + message under the field) rather than toasts.
- Opening width: add quick-pick chips (0.8 / 0.9 / 1.0 m doors, 1.2 / 1.5 m windows) — the door/window presets exist but free-typing is the only other option.
- Photo-assist shutter silently disables at 6 photos with no nearby explanation ("Up to 6" is in the hint text above, easy to miss).

### F18. Photo-assist review details

- Per-wall **confidence is available from the server** (and capped client-side) but never shown — a subtle strength indicator per wall row would help users triage which suggestions to distrust.
- "Retake photos" from review clears all curation (`deletedWalls`) without warning; confirm if any walls were kept/removed.

### F19. Accessibility gaps

- Mode/type toggle chips (Corners/Openings, Door/Window) don't set `accessibilityState={{ selected }}`.
- The align canvas has **no non-gesture input path** — screen-reader and switch users cannot place a room at all; numeric x/y/rotation inputs would close this.
- The AR scene has no screen-reader description of state (corner count, tracking quality); the tracking badge text is not announced.

### F20. Small polish

- Reference-photo strip on the blueprint screen is inert (`removable={false}`, no tap action) — a tap-to-zoom lightbox would make "for your records" actually usable.
- Combined view: anchor and aligned rooms render identically; a subtle tint or per-room outline would help users see what's what.
- `BlueprintSvg` empty state ("No geometry detected in the plan") is unreachable-ish but fine as-is.

---

## Suggested sequencing

**Wave 1 — honesty & cheap wins (a day or two, no architecture):**
F13 (remove Test button/tagline), F15 (layout entry), F11 (copy pass), F5 (area everywhere), F4 (lazy room creation), F2 (assist save semantics + copy), F3 labels (or full fix if `?room=` join is quick), F7's undo-wipe toast.

**Wave 2 — core-flow quality (the main push):**
F7 (AR shape feedback: lines, numbers, live lengths, opening preview), F8 (onboarding + AR coach overlay), F6 (zoom/pan + constant-size labels), F9 (level indicator, upload cancel/progress, error details), F10 (list thumbnails/dates/contextual actions), F12 (snapping + nudge + un-align).

**Wave 3 — durability & polish:**
F1 (persistence — Phase 3; ship the warning banner first), F16 (file-based export), F17 (haptics/inline validation), F19 (a11y), F14, F20.

The two P0s (F1 data loss, F2 silent curation discard) are the ones most likely to make a real user lose trust in the app before they ever judge its measurement quality; everything else is friction on top of a sound foundation.
