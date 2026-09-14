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
- **H0 (app-side: the AR engine was never instantiated) was confirmed and fixed by ticket 00 on 2026-09-14.** With a navigator mounted the S22U tracks, so H1–H4 no longer explain a dead session on this phone. Before anyone acts on them, tickets 01/02 need re-scoping or closing (there is no dead session left to capture), and 04/05/12/13/14 need re-scoping around the working Viro baseline.
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
- [Research: quick-fix recipes that stay inside the Viro stack](issues/07-research-viro-quick-fix-recipes.md): recipe 0 is the missing navigator (above); Viro exposes no ARCore failure to JS and the npm package ships AARs only, so error surfacing needs a virocore rebuild (or a logcat-tailing module); the #1762 sensor hold has a deterministic JS placement (`await holdSensors()` before mounting) and matters more than expected because sensorservice returns PERMISSION_DENIED — not a silent clamp — for debuggable packages, which is all this app ever is; the camera guard is real but AOSP evicts the older same-process client, downgrading H3; the ARCore 1.56 swap is a verified drop-in but a no-op for H1–H3.
- [Research: design for an owned Kotlin Expo Module over ARCore 1.56](issues/09-research-owned-arcore-expo-module-design.md): feasible and recommended — `ExpoView` + GLSurfaceView + `hello_ar_kotlin` renderer, view-owned session lifecycle, **every exception surfaced** as `onSessionError`, DepthPoint hit-tests, GPU-readback `captureFrame` (removes expo-camera from the AR flow entirely), explicit `app.plugin.js`, no toolchain change. 1.5–2 days of spikes + 6–9 dev-days, gated on ticket 02.
- [Research: evaluate `@stewmore/expo-ar`](issues/10-research-expo-ar-evaluation.md): yes as a half-day diagnostic trial, ~60% reusable as a vendoring seed (module shell, TS contract, config plugin, a real ARKit iOS side), but its SceneView-driven session core must be replaced (crashes on resume failure, drops `TrackingFailureReason`, destroys the session on detach). **It cannot be A/B'd with Viro in one APK** — both ship ARCore classes and native libs. Vendoring to the bar: 3–5 dev-days.
- [Research: can the Android toolchain be raised to compileSdk 37 / Kotlin 2.4.10?](issues/11-research-toolchain-raise.md): feasible on SDK 57 (AGP 8.12 kept, `expo-build-properties` + a root-KGP pin) but not worth it — compileSdk 37 arrives with Expo 58 / RN 0.87 anyway, Kotlin 2.4 does not; raise stays ruled out; the ARCore 1.56 `hello_ar` route needs no toolchain change; Viro's bundled `arcore_client` 1.43 clashes with any `com.google.ar:core` dependency, so an owned module cannot coexist with an unmodified Viro.

## Not yet specified

- **On-device model fallback** (Depth Anything V2 metric-indoor / MoGe-2 ViT-S on-phone) — only if Photo assist + a second device are exhausted; ±5–7 % depth error and no multi-view registration make it assist-grade at best.
- **Model-assisted corner/wall suggestion on top of AR tracking** — reduce tapping; parked per Round 1 (Q7 b).
- **Error UX once real ARCore failure reasons exist** — message per failure class, retry policy, ARCore install/update prompting (`ArCoreApk.requestInstall`), what "Restart AR" means per class.
- **Multi-room tracking-frame semantics under an owned engine** — pause/resume behaviour, when the frame-group id rotates, whether reference photos still reset the frame.
- **Removing the Viro dependency and its config plugin** if an owned engine wins — build simplification, APK size, Expo Go implications.
- **EAS Build / CI for a local native module** — only if EAS is adopted.
- **Release sequencing** — whether Track A fixes ship to users before Track B lands.

## Out of scope

- iOS AR parity (ARKit / RoomPlan) — Android-first; iOS is compile-only with a stub until a device is in hand (Round 1, Q4).
- WebXR inside `react-native-webview` — Chromium never shipped WebXR for Android WebView (alternatives research; verification pending).
- expo-camera preview + ARCore for poses — ARCore opens and owns the device camera (Shared Camera works only with the app's own Camera2 session, which expo-camera cannot hand over). A GL-free *owned* module that shows its own Camera2 preview is a different route and stays in scope (ticket 09, design B).
- External paid AI APIs (standing constraint).
- An on-device depth model as the *measuring engine* (Round 1, Q7 a) — fallback-only, and only as fog.
