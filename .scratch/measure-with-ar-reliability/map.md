# Map: Measure with AR — reliable on Android 16 (Samsung S22 Ultra)

Label: wayfinder:map
Charted: 2026-09-14 · Tracker: local markdown (this directory; see `.agents/skills/setup-matt-pocock-skills/issue-tracker-local.md`)
Tickets: `issues/NN-<slug>.md` — refer to them by title.

## Destination

A decision-complete spec at `docs/specs/measure-with-ar-reliability.md`: the AR engine strategy chosen (Viro fixed / patched / forked vs. an owned Kotlin ARCore Expo Module), the pre-requisite experiments executed on the S22 Ultra with results recorded, the acceptance bar and test plan written, migration steps and effort estimated — so implementation can start (e.g. via `/implement`) without further deciding.

## Notes

**Domain & skills**
- Glossary: `CONTEXT.md` (Measurement path, AR tap-to-trace, Photo assist, AR engine, Dead session). Use those words in tickets and the spec.
- Skills per ticket type: `research` (AFK), `grilling` + `domain-modeling` (HITL decisions), `prototype` (spike), `diagnosing-bugs` (device experiments). Expo facts must be checked against https://docs.expo.dev/versions/v57.0.0/ (AGENTS.md).
- Research inputs so far (copied for durability): `research/research-viro-dead-camera.md` (root-cause hypotheses H1–H6), `research/research-ar-alternatives.md` (engine/measurement option survey), `research/claims-verification-2026-09-14.md` (12 key claims adversarially checked by 20 agents + the completeness critic's gap list). A toolchain-raise research agent (ticket 11) and the research fan-out for tickets 07–10 were still running at charting time — reconcile their results into those tickets before acting on them.
- **H0 (app-side: the AR engine was never instantiated) was confirmed and fixed by ticket 00 on 2026-09-14.** With a navigator mounted the S22U tracks, so H1–H4 no longer explain a dead session on this phone. Ticket 01 then found no H1–H4 signature, either in the reproduced dead session or in healthy HEAD sessions. Ticket 02 then showed that ARCore itself tracks here (2026-09-22), so 05 (skipped) and 17 (not needed) are closed. Ticket 03 then found no camera-handoff failure (H3 not supported), so no H1–H4 failure remains on this phone. Ticket 04 (2026-09-23) then showed that Viro plus the camera guard and a logcat-based error surfacer passes the acceptance bar here, and ticket 08 costed a Viro fork (for exact ARCore statuses) at about 3–4.5 days. Ticket 12 (2026-10-15) then ruled out error reasons and ownership as reasons to replace Viro, leaving only the Depth-API wall-tap requirement. Ticket 19 showed Viro meets it with depth on, so **the engine is Viro** (14), 13 was not needed and 16 is out of scope. Ticket 15 then fixed the seam: a deep module around Viro with one status union, raw hits plus a pure corner resolver (floor height locked per trace), a new tracking frame per engine session, and the tracking-loss rules. Ticket 18 then wrote the spec, and the user approved it: **the destination is reached (2026-10-15)**, at `docs/specs/measure-with-ar-reliability.md`. Only the upstream drafts (06) remain open; they block nothing.
- **Corrections from the claims verification that shape the tickets:** (1) #1762's `Session.resume()` failure is documented only on Play Services for AR **1.54.x**; whether 1.56 (this phone) still has it is unknown — Google promised a hotfix on 2026-05-06 and went silent. (2) The **1.56-era** Samsung Android 16 reports (#1784/#1785) are a different failure: camera-to-IMU clock offset > 5 ms, VIO never stabilises or flaps TRACKING↔PAUSED with wrong scale — with the camera feed *visible* in hello_ar; Viro shows black in that state. (3) virocore discards `ArStatus` on create/resume/update, forces one `onTrackingUpdated(UNAVAILABLE, NONE)` at mount and then reports only changes; whether it draws the camera before tracking is Normal is contested between source readings. (4) An ARCore client swap must replace the whole `arcore_client` AAR (Java + native) and strip the renderer's 1.51 stub — link-compatible, runtime unverified. (5) ARCore is **not** GL-bound: `TextureUpdateMode.EXPOSE_HARDWARE_BUFFER` (≥ 1.37, API 27+) allows a pose-only session with no GL context — a GL-free owned module (Shared Camera preview + hardware buffers) is a design option, but expo-camera still cannot share ARCore's camera. (6) SceneView **2.3.3** (ARCore 1.52, no compileSdk floor) fits today's toolchain; 4.x needs compileSdk 37 / Kotlin 2.4.10 / AGP ≥ 9.1.1. (7) `@stewmore/expo-ar` is built for exactly Expo SDK 56 and rides SceneView 2.3.0 / ARCore 1.48.
- Research tickets capture findings on throwaway `research/<slug>` git branches (never pushed) and link them from the ticket.

**Device & access (decided 2026-09-14)**
- Test device: Samsung Galaxy S22 Ultra `SM-S908U`, Android 16 (API 36), security patch 2026-08-05, ARCore (Play Services for AR) 1.56.262080393, via `adb` (serial `R5CTA2PB2ZX`). Tracking needs the phone *moved*, so device runs are hands-on for the user.
- Allowed for diagnostics: installing/uninstalling explicitly named test APKs; debug builds with extra permissions; time-boxed ARCore downgrade (sideload 1.53) **restored to the store version the same session**.
- End users' ARCore version cannot be controlled: any fix must work against the current store ARCore (1.56+), never depend on a downgrade.
- Toolchain today: Expo SDK 57, RN 0.86.3 (new arch), AGP 8.12.0, Kotlin 2.1.20, compileSdk/targetSdk 36, buildTools 36.0.0, NDK 27.1.12297006, Gradle 9.3.1; `@expo/ui` already applies the Kotlin Compose compiler plugin. App runs as a development build only (never Expo Go).

**Standing decisions from charting (Rounds 1–2)**
- Goal: *AR tap-to-trace* must work reliably on this phone, whatever AR engine sits underneath; photo-based measuring is a fallback branch, not the goal.
- Android-first full implementation; iOS must keep compiling (any owned module ships an iOS stub view); ARKit parity waits for a real iOS device.
- All native routes allowed: JS/config-level fixes, patching Viro, forking/rebuilding virocore, an owned Kotlin Expo Module over ARCore.
- Sequencing: **Track A** first (quick fixes inside the Viro stack: #1762 sensor workaround, camera-release guard, error surfacing) and re-test; **Track B** (engine strategy) is decided on the evidence from the experiments, not before.
- Acceptance bar ("reliable"), on the S22U: 10/10 consecutive cold launches into Measure with AR reach "Tracking good" within ≤ 5 s of moving the phone over a textured floor; survives background→foreground; survives visiting Capture / Photo assist before AR; every failure surfaces a human-readable ARCore reason (never a silent black view).
- Engine seam: extract an `ArEngine` interface so `ar-capture-screen.tsx` is engine-agnostic and engines can be A/B'd on the phone.
- Depth API plane-less hits (`DepthPoint`) on plain walls: a **requirement** of the spec.
- Reference photos: guarantee expo-camera release before AR mounts now; capture from the engine's own frame if the engine ends up owned.
- Toolchain raise (compileSdk 37 / Kotlin 2.4.10, needed by SceneView 4.x): ruled out unless research shows Expo 58 / RN 0.87 are moving there themselves.
- Upstream: post device findings to ReactVision/viro#499 and google-ar/arcore-android-sdk#1762/#1784 — agent drafts, user posts.
- If ARCore itself cannot track on this firmware: keep Photo assist as the working path and re-test each ARCore update; get a second (non-Samsung) test device if possible; the on-device model fallback stays fog until both are exhausted. Concrete trigger for that fallback: hello_ar fails on the device **and** the sensor warm-up workaround does not fix it **and** a downgrade is (by definition) not shippable to users.
- No paid external AI APIs anywhere.

## Decisions so far

<!-- one line per closed ticket: [title](issues/NN-slug.md): gist -->

- [The app never mounts ViroARSceneNavigator: no AR engine is ever created](issues/00-mount-viro-scene-navigator.md): **H0 confirmed and fixed (2026-09-14).** Before the fix, the screen mounted but no engine started and no tracking update ever arrived. With `<ViroARSceneNavigator>` mounted (the scene fed through React context), the S22U tracks:
  - 10/10 cold launches reach "Tracking good" 1.29–1.48 s after engine attach
  - background→foreground: 0.99 s
  - Capture→back→AR: 1.77 s
  - Reference photos→Next room: 2.18 s

  Also fixed: taps reached the hit test in dp, while Viro's Android renderer works in physical px. Still open: error surfacing (Viro still swallows `ArStatus`), and tickets 01/02/04/05/12/13/14 need re-scoping around the working baseline.
- [Capture a failing Measure-with-AR mount's logcat on the S22 Ultra](issues/01-capture-failing-mount-logcat.md): **the only dead session on this phone is H0; H1–H4 are not supported (2026-09-14).**
  - Serving the pre-fix screen reproduced it 3/3: no engine, no ARCore session, zero tracking callbacks, no camera client, no error strings.
  - HEAD tracked 3/3 in 1.47–1.55 s and stayed Normal for 20 s.
  - `Failed to register sensor` never appears. The #1762/#1784-style strings (`Callback list for SENSOR_TYPE_… not found`, every 5 s; `kNotTracking`; `VIO_OUTPUT_NOT_TRACKING`; `CAM_IMU_DESYNC`) occur in healthy sessions, so they are noise: no diagnostic or error surfacer may key on them.
  - Ticket 02 loses its decisive role.
- [Run Google's unmodified hello_ar_kotlin sample on the S22 Ultra](issues/02-run-hello-ar-kotlin-sample.md): **pass: ARCore 1.56 tracks on this phone without Viro (run 1, 2026-09-14; closed 2026-09-22 without the planned repeat).**
  - Live camera feed; VIO initialised at +2.0 s; planes found and floor taps placed objects.
  - One tracking loss in 115 s, close up against a blank wall, recovered in 8 s. No flapping.
  - Depth is supported and rendered on the carpet and on a plain wall.
  - `Failed to register sensor` never appears. `CAM_IMU_DESYNC` appears only during initialisation.
  - Open, and moved to ticket 13: whether a plain-wall tap gives a `DepthPoint` hit (the sample doesn't log hit types).
  - New gap: metric scale is unchecked everywhere. A known-length check belongs in the acceptance runs.
  - Tickets 05 and 17 close by their own rules (both closed 2026-09-22); 06's ARCore posts don't apply.
- [Camera-handoff matrix: does expo-camera use before AR correlate with dead sessions?](issues/03-camera-handoff-matrix.md): **H3 not supported: 8/8 runs tracked, 2 per path (2026-09-22).**
  - Paths 2/3 (Capture or Photo assist → Back → AR): expo-camera released 1.41–1.50 s after Back, and ARCore connected about 0.54 s later, with no overlap.
  - Path 4 (Reference photos → Next room): ARCore connects 0.67–0.97 s after the tap, **before** expo-camera releases. CameraService evicts expo-camera's client (`evicting conflicting client`, CameraX `ERROR_CAMERA_DISCONNECTED`), with no app error and no tracking effect. The same happened in ticket 00's run, so 3/3.
  - "Tracking good" came 1.30–2.45 s after attach. No other package ever held the camera.
  - The acceptance-bar item "survives visiting Capture / Photo assist before AR" passes on this phone.
  - The camera-release guard is now a hardening choice for path 4 (keep eviction vs. wait for the release, about +0.5–0.7 s), not a fix. 04/12 should confirm or drop the standing "guarantee release" decision.
  - Ticket 04 is unblocked, and error surfacing is its only open acceptance item.
- [Apply the Track A quick fixes inside the Viro stack and re-test](issues/04-apply-track-a-quick-fixes.md): **Viro plus the camera guard and error surfacing passes the acceptance bar on the S22U (2026-09-23).**
  - Applied:
    - a local module, `modules/ar-session-guard`: a camera-availability wait, plus the app's own `logcat --pid` forwarded to JS;
    - `src/lib/ar-diagnostics.ts`: deterministic signatures only;
    - the screen: camera gate, a fixed stall rule, and labels.
  - Not applied: the #1762 sensor hold (0 `Failed to register sensor`; every sensor registration returned OK) and the ARCore swap.
  - Cold launches 10/10, 1.29–3.60 s attach → tracking. bg→fg 3/3, 1.04–1.24 s after resume. Camera paths 6/6.
  - Reference photos → Next room now waits for expo-camera's release (1.31–1.38 s) with 0 evictions, for about +0.7 s.
  - Failure reasons were shown on the device for:
    - camera permission denied;
    - camera access off in Quick Settings (blank frames → Viro's "insufficient light" → "camera image is dark or blank"; the same session recovers when access returns);
    - another app taking the camera, at start (ARCore evicts it) or mid-session (the app is named, and AR resumes by itself on refocus).
  - Disabling Play Services for AR does not break AR, so the install/decline messages are unit-tested only.
  - Exact create/resume/update statuses remain rebuild-only (ticket 08).
  - The standing "guarantee expo-camera release" decision is implemented.
- [ARCore version bisect on the S22 Ultra](issues/05-arcore-version-bisect.md): **skipped (2026-09-22).** Its trigger (02 fails, or a `Failed to register sensor` signature) never occurred, and the phone stays on ARCore 1.56.262080393.
- [Research: quick-fix recipes that stay inside the Viro stack](issues/07-research-viro-quick-fix-recipes.md): recipe 0 is the missing navigator (above); Viro exposes no ARCore failure to JS and the npm package ships AARs only, so error surfacing needs a virocore rebuild (or a logcat-tailing module); the #1762 sensor hold has a deterministic JS placement (`await holdSensors()` before mounting) and matters more than expected because sensorservice returns PERMISSION_DENIED — not a silent clamp — for debuggable packages, which is all this app ever is; the camera guard is real but AOSP evicts the older same-process client, downgrading H3; the ARCore 1.56 swap is a verified drop-in but a no-op for H1–H3.
- [Research: feasibility of forking and rebuilding virocore's Android renderer](issues/08-research-virocore-rebuild-feasibility.md): **feasible, about 3–4.5 dev-days, no showstoppers (2026-09-23).**
  - Both repos build unmodified on this Mac and reproduce the shipped 2.58.1 AARs (`classes.jar` byte-identical), from virocore `d86dee66` / viro `85f537d`. Viro 3.0.x fixes none of this.
  - (a) Passing ARCore's status to JS is the only native work: 1.5–2 days, and a prototype compiles.
  - (b) Not needed: Viro already draws the camera before tracking is Normal. This corrects claims-verification item (3); a device check is owed.
  - (c) ARCore 1.56 everywhere: 0.5 day.
  - (d) `DepthPoint` hits are already in 2.58.1 (`depthEnabled` + the hit type), so ticket 13's wall-hit question needs no fork.
  - Ship as vendored AARs plus a config plugin listed before Viro. MIT, with a few proprietary-header files already in the stock AAR.
  - Only a rebuild can report exact create / non-sensor resume / mid-session update statuses. Ticket 04's logcat tail covers startup, the sensor failure and a foreign camera client. Fork only if the spec needs the rest.
- [Research: design for an owned Kotlin Expo Module over ARCore 1.56](issues/09-research-owned-arcore-expo-module-design.md): feasible and recommended — `ExpoView` + GLSurfaceView + `hello_ar_kotlin` renderer, view-owned session lifecycle, **every exception surfaced** as `onSessionError`, DepthPoint hit-tests, GPU-readback `captureFrame` (removes expo-camera from the AR flow entirely), explicit `app.plugin.js`, no toolchain change. 1.5–2 days of spikes + 6–9 dev-days, gated on ticket 02.
- [Research: evaluate `@stewmore/expo-ar`](issues/10-research-expo-ar-evaluation.md): yes as a half-day diagnostic trial, ~60% reusable as a vendoring seed (module shell, TS contract, config plugin, a real ARKit iOS side), but its SceneView-driven session core must be replaced (crashes on resume failure, drops `TrackingFailureReason`, destroys the session on detach). **It cannot be A/B'd with Viro in one APK** — both ship ARCore classes and native libs. Vendoring to the bar: 3–5 dev-days.
- [Research: can the Android toolchain be raised to compileSdk 37 / Kotlin 2.4.10?](issues/11-research-toolchain-raise.md): feasible on SDK 57 (AGP 8.12 kept, `expo-build-properties` + a root-KGP pin) but not worth it — compileSdk 37 arrives with Expo 58 / RN 0.87 anyway, Kotlin 2.4 does not; raise stays ruled out; the ARCore 1.56 `hello_ar` route needs no toolchain change; Viro's bundled `arcore_client` 1.43 clashes with any `com.google.ar:core` dependency, so an owned module cannot coexist with an unmodified Viro.
- [Decision: Track A outcome — does the fixed Viro engine meet the bar, and what does that mean for Track B?](issues/12-track-a-outcome-decision.md): **Viro with the Track A fixes passes the bar; only the wall-tap requirement could still force an engine change (2026-10-15).**
  - Criteria 1–3 pass on ticket 04's runs. Criterion 4 passes: a readable best guess is enough where ARCore's exact status is unreachable, and ticket 08's patch (a) is offered upstream (ticket 06) rather than forked.
  - Not controlling Viro is not a reason on its own; the `ArEngine` seam (ticket 15) is the hedge.
  - The Depth-API wall-tap requirement and metric scale get checked on Viro 2.58.1 first (ticket 19). Pass → 13 closes, 14 = keep Viro, 16 out of scope. Wall taps fail → 13 runs on wall taps. Length fails → diagnose first.
  - Viro 3.0.2/3.0.3 change nothing relevant; the 3.0.3 upgrade (remount crash fix) goes into the spec. viro#568 (Samsung A56 flapping) does not change the S22U decision; 06 replies on it. *Corrected in 06: it is Viro-specific (plain ARCore apps work on the A56), with Viro's forced largest-CPU-image camera config as a candidate cause, so it is a risk for other phones.*
  - Glossary: Dead session now means "never started tracking", whatever Viro reported.
- [Prototype: owned ARCore Expo Module spike on the S22 Ultra](issues/13-owned-module-spike.md): **not needed (2026-10-15).** Ticket 19 passed on Viro, so no requirement is left that only an owned module could meet; tickets 09/10 stay on file as the replacement design.
- [Decision: AR engine strategy (keep Viro / fork virocore / owned Expo Module)](issues/14-engine-strategy-decision.md): **keep Viro (2026-10-15)**, resolved by ticket 12's rule once ticket 19 passed.
  - The Viro dependency stays: upgrade to 3.0.3 in the spec, re-checking the log strings ticket 04 parses.
  - A fork is the fallback only (exact statuses refused upstream, or the depth label needed in code).
  - Reference photos stay on expo-camera behind the camera wait. Release sequencing is moot.
- [Decision: the `ArEngine` seam — interface shape and the Viro adapter](issues/15-ar-engine-seam-design.md): **a deep module around Viro (2026-10-15)**; the prototype stub is in `prototypes/15-ar-engine-seam/`.
  - The screen renders one `ArEngineStatus` (starting / tracking / lost / dead). The camera wait, log tail, dead-session timer and Viro quirks move inside `ViroArEngineView`.
  - `hitTest` returns raw hits (plane or point) plus the camera position. A pure `placeCorner` puts a corner where the line of sight meets the trace's floor height, locked at its first floor-plane corner.
  - Every fresh engine session is a new tracking frame (`onFrameStart`). This fixes a bug: Restart AR kept `arSessionId`, so rooms from different frames were merged.
  - Tracking loss: a corner whose floor plane is more than 10 cm from the lock is refused, and a loss of 3 s or more mid-trace gets a keep-or-restart warning.
  - Markers drop to 3 cm. No `captureFrame()`.
  - Glossary: Tracking frame, Corner.
- [Task: write `docs/specs/measure-with-ar-reliability.md` (the destination)](issues/18-write-the-spec.md): **written and approved (2026-10-15).** Viro stays (3.0.3), with the `ArEngine` seam, floor-height corners, a tracking frame per engine session and the tracking-loss rules. Six `/implement`-sized steps (about 3.5–4.5 dev-days, three device sessions) and a 9-row device test plan, including a release-build check.
- [A second (non-Samsung) Android test device](issues/17-second-android-test-device.md): **not needed (2026-09-22).** Ticket 02 passed, so there is no firmware regression to route around. A second device is optional coverage, not a prerequisite.
- [Task: check Depth-API wall taps and metric length on Viro 2.58.1](issues/19-viro-wall-tap-and-length-check.md): **pass (2026-10-15, ARCore 1.57).**
  - Plain wall, same wall: depth on 10/10 on one plane (within 4.5 cm); depth off 0/12. Corners: 0 misses either way. Depth is on by default.
  - ARCore's scale is within 3% (3/3) when a floor corner is placed at the floor plane's height. As built, the app takes the hit point, which landed on objects 10–26 cm up (1/3 within 3%). The fix is the hit rule for ticket 15 and the spec.
  - Viro labels every ARCore depth hit `FeaturePoint` (`acquireTrackable` only wraps planes, through 3.0.3), which corrects ticket 08's (d); a one-line upstream fix goes to ticket 06.
  - After a long tracking loss ARCore rebuilds its map and old planes stay at stale heights (six floor heights in one session), so the app needs a tracking-loss rule.

## Not yet specified

- **On-device model fallback** (Depth Anything V2 metric-indoor / MoGe-2 ViT-S on-phone) — only if Photo assist + a second device are exhausted; ±5–7 % depth error and no multi-view registration make it assist-grade at best.
- **Model-assisted corner/wall suggestion on top of AR tracking** — reduce tapping; parked per Round 1 (Q7 b).
- **Error UX once real ARCore failure reasons exist** — message per failure class, retry policy, ARCore install/update prompting (`ArCoreApk.requestInstall`), what "Restart AR" means per class.
- **EAS Build / CI for a local native module** — only if EAS is adopted (`modules/ar-session-guard` is one now).

## Out of scope

- iOS AR parity (ARKit / RoomPlan) — Android-first; iOS is compile-only with a stub until a device is in hand (Round 1, Q4).
- WebXR inside `react-native-webview` — Chromium never shipped WebXR for Android WebView (alternatives research; verification pending).
- expo-camera preview + ARCore for poses — ARCore opens and owns the device camera (Shared Camera works only with the app's own Camera2 session, which expo-camera cannot hand over). A GL-free *owned* module that shows its own Camera2 preview is a different route and stays in scope (ticket 09, design B).
- External paid AI APIs (standing constraint).
- An on-device depth model as the *measuring engine* (Round 1, Q7 a) — fallback-only, and only as fog.
- [Decision: reference photos when the engine is owned](issues/16-reference-photos-under-owned-engine.md) — closed 2026-10-15: the engine stays Viro (ticket 14), so frame capture from an owned engine does not arise; reference photos stay on expo-camera behind ticket 04's camera wait.
- Removing the Viro dependency and its config plugin — only arose if an owned engine won; ticket 14 kept Viro.
