# 08 — Research: feasibility of forking and rebuilding virocore's Android renderer

Type: research
Mode: AFK
Status: open (a first attempt on 2026-09-14 died on a session limit before writing anything; branch `research/virocore-rebuild-feasibility` exists but is empty - re-run)
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

## Comments
