# Blueprint from Photos — Implementation

BlueprintAI turns a physical room into a measured 2D floor plan. All measurement happens
on-device: the primary flow uses ARCore tap-to-trace capture to record real wall
positions directly, and an optional self-hosted photo path lets a room be measured from a
handful of photos processed by the operator's own server. **No third-party cloud AI API
is called anywhere in the app or its optional backend service.**

Stack: Expo SDK 57, React Native 0.86.3, TypeScript (strict), expo-router with typed
routes, pnpm. See `README.md` for general project setup and conventions.

---

## 1. Floor plan data model

`src/lib/blueprint-schema.ts` defines the single shape every capture method, the
renderer, and every exporter share — a top-down plan in meters:

- `BlueprintWall { id, from: Point, to: Point, lengthM?, confidence }`
- `BlueprintRoom { id, label, polygon: Point[], confidence }`
- `BlueprintOpening { id, type: 'door' | 'window', wallId, positionT?, widthM?, confidence }`
- `FloorPlan { unit: 'meters', walls[], rooms[], openings[], notes? }`

`floorPlanJsonSchema` is a JSON Schema for the same shape (used to validate any structured
data entering the app). `validateFloorPlan(raw)` normalizes and sanity-checks a candidate
plan — dropping malformed individual walls/rooms/openings (degenerate zero-length walls,
polygons with fewer than 3 points, openings referencing an unknown wall) while throwing
`FloorPlanValidationError` only when a top-level array is missing entirely. Every plan
producer in the app (AR capture, photo assist, the mock provider, manual alignment)
returns its result through this validator.

Shared geometry helpers, used by the renderer and every exporter: `planBounds`,
`polygonCentroid`, `pointOnWall`, `polygonAreaM2`, `planAreaM2`, `formatAreaM2` (the
user-facing "≈ 13.0 m²" string).

---

## 2. Capture: AR tap-to-trace measurement (primary flow)

The main way to produce a plan: the user opens an AR session, walks the room, and taps
each wall corner in order. Each tap is a real ARCore hit-test position, so wall lengths
come from `Math.hypot` on measured coordinates — not a model's estimate.

**Screen:** `src/screens/ar-capture-screen.tsx`, routed via `src/app/ar-capture.tsx`.
**Capture logic:** `src/lib/ar-capture.ts` (`ArCaptureSession`), pure TypeScript with no
runtime dependency beyond the schema validator, so the same logic runs under Vitest.

Flow:

1. On mount, `isARSupportedOnDevice()` and `requestRequiredPermissions(['camera'])`
   (from `@reactvision/react-viro`) gate the screen into `unsupported` / `denied` /
   `ready`.
2. A `ViroARScene` renders the live camera feed with point-cloud display; a transparent
   `Pressable` layer captures taps and routes them through
   `scene.performARHitTestWithPoint(x, y)`.
3. **Corner mode** (default): each tap hit-tests against tracked geometry and records a
   world position via `ArCaptureSession.addCorner(world, quality)`. `quality` is derived
   from ViroReact's tracking state (`normal` → confidence 1.0, `limited` → 0.7) and is
   carried through to the wall/room confidence in the finished plan — it now means
   *measurement quality*, not a model's guess. A red `ViroSphere` marks each recorded
   corner in the scene.
4. **Opening mode**: a tap locates the nearest wall segment
   (`ArCaptureSession.locateOnWall`) and opens a small panel to pick door/window and a
   width (defaults 0.85 m / 1.2 m, editable); confirming calls `addOpening`.
5. Adding or removing a corner shifts wall indices, which invalidates any already-recorded
   openings on the wall side of that change — the session clears them and the UI surfaces
   a toast rather than silently dropping data (`addCorner`/`undoCorner` return the count
   cleared).
6. **Finish room** (enabled once ≥3 corners are recorded) calls
   `ArCaptureSession.finishRoom(label)`, which builds the `FloorPlan`: consecutive corners
   become walls with `lengthM` measured from the tap positions and `confidence` = the
   lower of the two endpoint qualities; the full corner sequence becomes the room polygon.
   The plan is saved to the session store with `planSource: 'ar-tap'` and the current AR
   session id.
7. **Multiple rooms in one AR session** share the same ARCore tracking frame, so their
   plans can be merged later by plain geometry union — `mergeSameFramePlans` in
   `ar-capture.ts` — with no alignment step and no AI involved (see §4).
8. **Optional reference photos**: after finishing a room, the user can capture a few
   photos with `expo-camera` purely for their own records. This unmounts the AR scene
   (only one active camera consumer at a time) and reuses the same capture/compress
   pipeline as the rest of the app (`src/lib/image-pipeline.ts`). These photos are stored
   against the room but never feed plan generation. Because taking them tears down the AR
   session, the *next* room started afterward gets a fresh tracking frame and its own
   session id (so it joins the combined blueprint through manual alignment, §4).
9. **Recovery.** A watchdog (`STALL_TIMEOUT_MS = 10s`) detects a session that produced no
   tracking update at all and surfaces a "Restart AR" action distinct from ordinary
   "tracking lost" (the two states need different guidance). Restarting remounts the
   native `ViroARScene` (fresh ARCore session) and, if corners were already traced, asks
   for confirmation first — corner positions are tied to the old session's coordinate
   frame and cannot be reused after a restart.

`src/lib/viro-interop.ts` documents and guards one integration hazard: on Android,
ViroReact's legacy (pre-Fabric) view managers are rendered through RN 0.86's new-architecture
interop layer, which forwards a component's style keys as top-level native props. Viro's
own `position` prop (a 3D `[x, y, z]` array) collides with the CSS `position` style key —
passing `style={{ position: 'absolute' }}` to a Viro component crashes the native view
update. `viroSafeStyle()` strips colliding keys from any style passed to a Viro component;
layout positioning is instead expressed on a plain RN wrapper `View` around the scene.

---

## 3. Capture: self-hosted photo assist (optional)

For a room the user can't or doesn't want to walk in AR, a photo-based alternative sends a
few photos to a service the operator runs on their **own** GPU — never a third-party API.
The feature is entirely hidden until configured.

**Screen:** `src/screens/photo-assist-screen.tsx`, routed via `src/app/photo-assist.tsx`.
**Client:** `src/lib/photo-assist-client.ts` — `suggestWalls()` POSTs the room's photos to
`${EXPO_PUBLIC_PHOTO_ASSIST_URL}/v1/suggest-walls`; `isPhotoAssistConfigured()` is the
feature flag the home screen and elsewhere check before showing any entry point.
**Plan building:** `src/lib/photo-assist-plan.ts` — `suggestionToPlan()` builds a
`FloorPlan` from the walls the user kept, capping every wall's confidence at
`ASSIST_CONFIDENCE_CAP = 0.5` (deliberately below any AR tap measurement) and labeling the
plan's notes "auto-detected — verify". `chainWallsToPolygon()` greedily chains accepted
wall segments into a closed room polygon when their endpoints match within 0.15 m;
otherwise the plan stays walls-only (still valid, still renderable).

Flow:

1. Capture up to 6 photos with `expo-camera` (same pipeline as the AR flow's reference
   photos: resize to a 2048 px long edge, JPEG compress 0.8, base64-encode).
2. "Analyze" uploads them; the service returns, per photo, a set of candidate walls in
   that photo's own local frame (origin at the camera, x right, y forward).
3. **Review**: each photo is its own independent frame (no cross-photo registration), so
   the screen lets the user select a photo, see its suggested walls rendered as a preview
   plan (`suggestionPreviewPlan`, via the shared `BlueprintSvg`), and tap individual walls
   to remove false positives.
4. **Per-photo save**: any number of photos can each be saved as their own room (the first
   save goes to the room the screen was opened for; later saves create new rooms). Each
   saved room gets `planSource: 'photo-assist'` and a unique frame id
   (`assist-<roomId>`), so — unlike AR rooms from one session — it never auto-merges with
   anything and always joins the combined blueprint through the manual align editor (§4).

---

## 4. Multi-room combination

`src/lib/session-store.ts` tracks, per room, its `plan`, `planSource`
(`'ar-tap' | 'photo-assist' | null`), `arSessionId` (the frame-group id — an AR tracking
session id for tap-measured rooms, a unique per-room id for photo-assist rooms), and an
optional `placement`.

Two ways rooms combine, both pure geometry with no AI or network call:

- **Same frame group** (rooms captured consecutively in one AR session):
  `mergeSameFramePlans` (`src/lib/ar-capture.ts`) unions their walls/rooms/openings
  directly — they are already expressed in the same tracking frame.
- **Different frame groups** (separate AR sessions, or any photo-assist room): the manual
  **align editor** (`src/screens/align-screen.tsx`, routed via `src/app/align.tsx`) lets
  the user drag (pan gesture, `react-native-gesture-handler`) and rotate one room's whole
  frame group into place against the rest of the already-combined blueprint. The
  placement is pure geometry — a centroid translation plus a rotation angle
  (`RoomPlacement { x, y, rotationRad }` in `src/lib/plan-transform.ts`) — applied with
  `applyPlacement` and merged with `mergePlacedPlans`, and saved per room via
  `setPlacement` in the session store.

The **combined blueprint view** (`src/screens/blueprint-screen.tsx`, `?view=combined`)
picks the largest same-frame group as the anchor (identity placement) and folds in every
other group that already has a saved placement; groups without one are listed under "Rooms
that need alignment" with a link into the align editor. `src/screens/room-list-screen.tsx`
exposes "Combine N room plans" once at least two rooms have a plan.

---

## 5. Capture: sample plan from photos (testing utility)

`src/screens/capture-screen.tsx` (routed via `src/app/capture.tsx`) is a plain
`expo-camera` capture flow kept for UI development without a device in hand. Photos go
through the same `src/lib/image-pipeline.ts` pipeline as the other flows, but the
"Generate blueprint" step always produces a **local, deterministic sample plan** — never
an analysis of the photos.

`src/lib/ai-provider.ts` defines the `FloorPlanProvider` interface (`generateFloorPlan`,
`generateCombinedPlan`) and `activeProvider()`, which always resolves to the `mock`
provider: `buildMockPlan` synthesizes a plausible ~4.2 m × 3.1 m room with a door and a
window and small per-run jitter, validated through `validateFloorPlan`;
`buildMockCombinedPlan` lays out several rooms' plans side by side. Simulated latency
(1.2–2.6 s) mimics a real network round trip. The blueprint screen always labels this
output "Mock mode — sample plan, not derived from your photos" so it is never mistaken for
a measurement. No network call is made anywhere in this module.

---

## 6. Blueprint rendering & export

**On-screen rendering:** `src/components/blueprint-svg.tsx` — `PlanElements` (shared by
the standalone view and the align editor) draws rooms as translucent filled polygons,
walls as thick lines, doors/windows as rotated markers on their wall, and dimension/room
labels, all via `react-native-svg`. Element opacity scales with each item's `confidence`
so uncertain geometry reads visibly fainter. `BlueprintSvg` fits a plan's bounds into the
available view with padding.

**Export**, offered from `src/screens/blueprint-screen.tsx`'s Export action, all on-device:

| Format | Module | Notes |
| --- | --- | --- |
| SVG | `src/lib/svg-export.ts` (`planToSvgString`) | Standalone SVG document, mirrors the on-screen renderer with fixed neutral colors. |
| JSON | — | `JSON.stringify` of the `FloorPlan` itself. |
| DXF | `src/lib/dxf-export.ts` (`planToDxfString`) | Hand-rolled ASCII DXF R12 (`LINE` for walls/openings, `LWPOLYLINE` for room outlines) — dependency-free, keeps the export in Expo Go without a native CAD library. |
| PNG → photo library | `src/lib/plan-rasterizer.ts` + `src/lib/png-encoder.ts` + `src/lib/gallery-save.ts` | `rasterizePlan` scan-converts the plan (room fills, walls, opening markers) to an RGBA buffer in pure TypeScript; `encodePng` is a minimal from-scratch PNG encoder (stored/uncompressed DEFLATE blocks, so no zlib dependency); `savePlanToGallery` writes the PNG via `expo-file-system` and saves it with `expo-media-library`'s `Asset.create` (the current SDK 57 API — the legacy `saveToLibraryAsync` is deprecated). Native-module-backed imports are loaded dynamically so a build lacking them (e.g. Expo Go) fails only this action, not the whole route. |

SVG/JSON/DXF are handed to the platform share sheet (`Share.share`); the PNG path is
saved directly to the photo library after a `writeOnly` permission request.

---

## 7. App structure & navigation

| Route | Screen | Purpose |
| --- | --- | --- |
| `src/app/index.tsx` | `home-screen.tsx` | Entry point: "Measure room with AR" (primary), "Measure with photos" (shown only when photo assist is configured), "Sample plan from photos (testing)", "Rooms". Shows a one-line summary of existing rooms/plans. |
| `src/app/rooms.tsx` | `room-list-screen.tsx` | Every room with photo count, plan status/source, and area; per-room add-photos/delete; "New room"; "Combine" once ≥2 rooms have plans. |
| `src/app/ar-capture.tsx` → | `ar-capture-screen.tsx` | AR tap-to-trace capture (§2). Lazily imported (`React.lazy`) with a validating fallback (`ArUnavailable`): `@reactvision/react-viro`'s native module is unavailable in Expo Go or a stale dev client, so a static import would crash the whole app at bundle-evaluation time (expo-router evaluates every route's module graph on startup). The loader catches both a rejected import and one that resolves to an empty module, and shows a plain explanatory screen instead. |
| `src/app/capture.tsx` | `capture-screen.tsx` | Testing/mock photo flow (§5). |
| `src/app/photo-assist.tsx` | `photo-assist-screen.tsx` | Self-hosted photo assist (§3). |
| `src/app/blueprint.tsx` | `blueprint-screen.tsx` | One room's plan (`?room=<id>`) or the combined blueprint (`?view=combined`); export actions. |
| `src/app/align.tsx` | `align-screen.tsx` | Manual drag/rotate alignment for cross-session or photo-assist rooms (§4). |

`src/app/_layout.tsx` wraps the `Stack` navigator in `GestureHandlerRootView` (required by
the align editor's pan gesture) and the theme provider, and holds the splash-screen
lifecycle.

`src/lib/session-store.ts` is the in-memory backing store for all of the above (rooms,
their photos, plans, plan source, frame/session id, and manual placement) — cleared on
reload, which is acceptable for the app's current scope.

Every capture/photo screen applies `useSafeAreaInsets()` to its bottom bars so controls
clear the Android edge-to-edge navigation bar.

---

## 8. Self-hosted photo-assist service (`services/photo-assist/`)

A small FastAPI service, independent of the RN app, that backs the flow in §3. Full detail
in `services/photo-assist/README.md`; summary:

- **Model:** MoGe-2 (MIT license, `microsoft/MoGe`), checkpoint
  `Ruicheng/moge-2-vitl-normal` by default (configurable via `PHOTO_ASSIST_MODEL`) —
  predicts a **metric** point map (real meter scale) per photo, loaded lazily on first
  inference (`moge_engine.py`).
- **Wall extraction** (`wall_fitting.py`, pure NumPy, no torch dependency): filters the
  point cloud to a plausible indoor depth range, RANSAC-fits near-vertical planes (a
  vertical plane normal ⇒ a wall), rejects thin/horizontal artifacts by required vertical
  span, floor-projects each plane's inliers, and fits a straight line by total least
  squares to produce one candidate wall segment per plane (`from`/`to`, `lengthM`, a
  support-based `confidence`). Deterministic (fixed RNG seed).
- **API:** `GET /health` (liveness + configured model name, no model load);
  `POST /v1/suggest-walls` — up to 6 base64 JPEG photos in, per-photo wall candidates out
  (per-photo inference failures are returned as an `error` field rather than failing the
  whole request).
- **Output frame** (per photo): origin at the camera position, x right, y forward into the
  scene, meters — a top-down view of what that one photo shows. Known v1 assumptions,
  surfaced to the app user: the camera should be held roughly level; each photo is an
  independent frame (no cross-view registration/SfM).
- **Deployment:** Dockerfile (`docker run --gpus all -p 8734:8734 ...`) or bare-metal
  (Python 3.10–3.12 + CUDA 12.x; MoGe installed with `--no-deps` since its own
  `pyproject.toml` pulls demo-only extras not needed for inference).
- **Tests:** `services/photo-assist/tests/` — `test_wall_fitting.py` (synthetic box-room
  point clouds, checked against expected wall lines/lengths) and `test_app.py` (the HTTP
  contract, with the engine faked) — both run CPU-only without torch or a GPU.
- **Client wiring:** off unless `EXPO_PUBLIC_PHOTO_ASSIST_URL` is set to the service's LAN
  address, at which point the app exposes the "Measure with photos" entry point (§3). No
  request is ever sent to any address other than this operator-configured one.

---

## 9. Native build & Expo configuration

`app.json` plugins, all present for the flows above:

- `expo-camera` — `cameraPermission` (iOS), `recordAudioAndroid: false` (photo-only app),
  `barcodeScannerEnabled: false`.
- `@reactvision/react-viro` (`provider: "none"`) — the AR capture flow's native module.
- `expo-media-library` — gallery-save permission strings.
- `expo-splash-screen`.

Android manifest permission: `android.permission.CAMERA` (added explicitly; ARCore/AR
permissions are requested at runtime via `requestRequiredPermissions`).
`newArchEnabled: true`.

Because `@reactvision/react-viro` and `expo-media-library`'s newer API ship native code,
the app requires a development build (`expo prebuild` then `npx expo run:android` /
`npx expo run:ios`, or an EAS dev client) — plain Expo Go cannot run AR capture or gallery
save. Both integration points degrade gracefully rather than crashing when their native
module is absent: the AR route falls back to an explanatory screen (§7), and
`gallery-save.ts` loads its native-backed imports dynamically and raises a
`GallerySaveError` with rebuild instructions instead of taking down the route.

Key package versions (`package.json`): `expo ~57.0.22`, `react-native 0.86.3`,
`expo-camera ~57.0.5`, `expo-file-system ~57.0.7`, `expo-image-manipulator ~57.0.17`,
`expo-media-library ~57.0.5`, `react-native-svg 15.15.4`, `@reactvision/react-viro
2.58.1`, `react-native-gesture-handler ~2.32.0`.

---

## 10. Automated tests

RN app: `pnpm test` (Vitest) — `src/lib/__tests__/` covers `ar-capture.ts`,
`blueprint-schema.ts`, `photo-assist-client.ts`, `photo-assist-plan.ts`,
`plan-transform.ts`, and `viro-interop.ts`. `pnpm typecheck` and `pnpm lint` cover the rest
of the codebase per the conventions in `README.md`.

Photo-assist service: its own CPU-only `pytest` suite (§8), run independently of the RN
app's test runner.
