# 08 — Research: feasibility of forking and rebuilding virocore's Android renderer

Type: research
Mode: AFK
Status: resolved (2026-09-23)
Blocked by: —
Part of: ../map.md

## Question

If Track B considers a **Viro fork**, what does it actually take to rebuild `ReactVision/virocore`'s Android renderer from source and ship it into this app?

Cover, with citations into the repo:
1. **Build system**: Gradle/CMake/NDK versions the repo expects (NDK 27.1? older?), third-party deps (Filament? GVR `gvr_common`? Bullet? OpenCV? Chromium's ARCore client?), prebuilt binaries checked in, any build docs or CI workflow. Does it build today on macOS with current tools? What is missing?
2. **The patches that matter**: (a) make `SessionNative::resume()` / create / update propagate `ArStatus` to the bridge and on to JS as an error event; (b) render the camera background while tracking is not `Normal` (HelloAR behaviour) so a session is never silently black; (c) bump the bundled ARCore client to 1.56 consistently (client AAR + renderer lib); (d) expose Depth-API `DepthPoint` hit results if the C API path allows. Locate the exact source files and estimate each patch.
3. **Shipping it**: how the rebuilt `viro_renderer` AAR is consumed by `@reactvision/react-viro` (local file dependency / npm patch / fork of the JS package), and the maintenance cost of tracking upstream releases.
4. **License & effort**: MIT confirmed for both repos? Total effort (days) and the showstoppers.

Findings go to `docs/research/virocore-rebuild-feasibility.md` on branch `research/virocore-rebuild-feasibility` (link it here). Primary sources only; mark UNVERIFIED where the repo does not say.

## Answer

**Feasible and cheaper than expected: about 3–4.5 dev-days to the acceptance bar, then 0.5–1 day per adopted upstream release. No showstoppers (2026-09-23).**

Report: `../research/virocore-rebuild-feasibility.md`. It is in the map's research folder, not on the `research/virocore-rebuild-feasibility` branch, which stays empty: the re-run was not allowed to commit. Patch diffs and build logs: `logs/ticket-08/` (gitignored).

**1. Build system: builds today, unmodified.**
- virocore's renderer builds in about 2 min, and viro's bridge in about 3.5 min, on this Mac: JDK 17, NDK 27.1, AGP 8.2 / Gradle 8.3 in their own projects. AGP fetches SDK 33 and build-tools 34 into an isolated root, so the user's SDK is untouched.
- The output matches the shipped 2.58.1 AARs. Both `classes.jar` files are byte-identical. The only native difference is ReactVision's closed-source cloud-anchor library, which the open-source build compiles as a stub.
- So the npm 2.58.1 AARs are virocore `v2.58.1` = `d86dee66` and viro `v2.58.1` = `85f537d`. Upstream builds its releases on a maintainer's Mac, with no CI.
- `@reactvision/react-viro` 3.0.0/3.0.1 (2026-09-20/21) still discard the statuses, so upgrading removes no patch.

**2. The patches:**
- **(a) ARCore status from create/resume/update to JS: 1.5–2 days.** The status is dropped at `ARCore_Native.cpp` L978/L1108/L1112 and `VROARSessionARCore.cpp` L214–227 (which logs "AR session resumed" regardless) and L929. A prototype (13 renderer files, 5 bridge/JS files, in the style of upstream's own `onDepthReady`) compiles on 2.58.1 and applies cleanly to 3.0.1. Runtime is unverified.
- **(b) Camera before tracking is Normal: not needed.** `renderFrame` updates the camera background before it checks tracking, and `renderWaitingForTracking` still calls `renderEye`. "Render black" is a stale comment (re-checked at `v2.58.1`). This corrects claims-verification item (3) and ticket 07 §1. The view is black only when resume/update fail, which is patch (a). A 5-minute device check is owed: it moves to ticket 04's remaining runs.
- **(c) ARCore 1.56 everywhere: 0.5 day.** The renderer part already builds. Still to do: repack `arcore_client`, bump the bridge, and a device check. `min_apk_version` rises to 1.56.
- **(d) DepthPoint hits: already in 2.58.1, 0 fork days.** Set `depthEnabled` on the navigator and accept the `DepthPoint` hit type in the app (about 0.25 day, ticket 13).

**3. Shipping:**
- Vendor the rebuilt renderer, bridge and client AARs in the repo, with an app config plugin that repoints the `projectDir` lines Viro's plugin writes to `settings.gradle`.
- The plugin must be listed **before** Viro in `app.json`: Expo runs a later-registered same-type mod's action first. Ticket 07 said "after".
- No JS fork is needed: `ViroARScene` spreads its props onto the native view.
- Pin `@reactvision/react-viro` to the AARs' version.

**4. License and effort:**
- MIT is confirmed for both repos.
- Unresolved: a few files inside carry "Proprietary and Confidential" headers, and the prebuilt `libreactvisioncca.so` is proprietary. The stock npm AAR already ships them, so a fork doesn't make this worse, and a fork can drop the `.so`.
- Total ≈ 3–4.5 days, versus 6–9 dev-days plus spikes for ticket 09's owned module.

**Against ticket 04's logcat tail:**
- **The tail reports** Viro's startup failures with their exact code (install, update, declined, unsupported, permission), the #1762 sensor failure, and another app holding the camera. For everything else it can only guess from how far start-up got.
- **Only a rebuild reports** the exact status of:
  - a failed create;
  - a non-sensor resume failure (camera not available, permission, illegal state);
  - any mid-session update failure;
  - the tracking states Viro collapses to "unavailable, no reason" (`CAMERA_UNAVAILABLE`, `BAD_STATE`, `STOPPED`).
- The report found that ticket 04's `onRendererFailed` regex missed the real format, which has a space after `error:`. Fixed in ticket 04's lane.

**Recommendation:**
- Ship ticket 04's tail, and do (d) in the app.
- Fork only if the spec needs exact ARCore reasons for the camera and mid-session classes. In that case, also offer patch (a) upstream: the maintainers asked for failure logs in viro#499.
- This choice belongs to ticket 12 / 14.

## Comments
