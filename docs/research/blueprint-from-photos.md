# Blueprint from Photos — Research Findings

Research date: 2026 (all Expo facts verified against the **SDK 57 versioned docs** at
`https://docs.expo.dev/versions/v57.0.0/`, per the AGENTS.md mandate).
Repo state at research time: single home screen, no camera/AI code, `expo ~57.0.22`,
React Native 0.86.3, pnpm, expo-router with typedRoutes.

---

## 1. Executive summary — recommended implementation path

**Main interpretation (photos of a physical space → 2D floor plan):** the prototype-viable
path is _capture in-app with `expo-camera`, compress with `expo-image-manipulator`, send
multiple photos per room to a cloud multimodal LLM with a strict JSON schema for
walls/rooms/openings, render the result with `react-native-svg`_. Everything below fits in
Expo Go on Android (no native modules outside Expo's bundled set), so it can be built and
tested in days.

There is **no off-the-shelf hosted API** that turns phone photos into a vector floor plan
(verified across GitHub, arXiv, and vendor docs — see §3.3b). Dedicated research pipelines
exist (COLMAP + 3D Gaussian Splatting; monocular-depth SfM) but need Linux + GPU servers or
self-hosted Python services — those are Phase 3+, not prototype material. On-device
inference is **not** prototype-viable: no off-the-shelf wall/floor-plan model exists for
TFLite/MediaPipe (§3.3c).

### Phase 1 — MVP (days)

Goal: capture N photos per room → get a JSON floor plan → render it as SVG on screen.

| Change       | Detail                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add packages | `expo-camera` (~57.0.5), `expo-file-system` (~57.0.7), `expo-image-manipulator` (~57.0.17), `react-native-svg` (15.15.4) — all via `pnpm expo install <pkg>`                                                                                                                                                                                                                                            |
| `app.json`   | Add the `expo-camera` config-plugin entry with `recordAudioAndroid: false` (photo-only app; default is `true`) and `barcodeScannerEnabled: false` (smaller APK). See §4 for the exact snippet.                                                                                                                                                                                                          |
| New screens  | `src/screens/capture-screen.tsx` (permission gate + `CameraView` + shutter + per-room photo strip), `src/screens/blueprint-screen.tsx` (SVG render of the plan, retry/export buttons)                                                                                                                                                                                                                   |
| New routes   | `src/app/capture.tsx`, `src/app/blueprint.tsx` — thin route files that render the screens (repo convention)                                                                                                                                                                                                                                                                                             |
| New lib      | `src/lib/capture.ts` (permission + capture loop + permanent copy via new `File` API), `src/lib/image-pipeline.ts` (resize/compress via `ImageManipulator.manipulate`), `src/lib/blueprint-schema.ts` (TS types + JSON Schema for walls/rooms/openings), `src/lib/ai-provider.ts` (one provider — recommend Gemini Flash or Claude Haiku tier for cost — called with structured-output/JSON-schema mode) |
| Config       | API key via `EXPO_PUBLIC_*` env var for the prototype (client-visible; move behind a small proxy before any real deployment — see §6 risks)                                                                                                                                                                                                                                                             |

### Phase 2 — improvements (1–2 weeks)

- Multi-room flow: room list, per-room capture sessions, doorway/adjacency hints fed to the
  LLM as text context so rooms can be merged into one plan.
- Dimension estimation: ask the model for estimated wall lengths in meters with explicit
  confidence; show them as "estimate" badges (LLM spatial precision is a documented weak
  point — §3.3a).
- DXF export via `@jscad/dxf-serializer` (active, v2.1.23) or hand-rolled minimal ASCII DXF
  (§3.6). Save/share the SVG + DXF files (`expo-file-system` `File.upload`/share sheet).
- Optional: save result image to gallery with `expo-media-library` (~57.0.5) — note the
  Android 13+ permission implications (§3.7).
- Provider abstraction: allow switching OpenAI / Anthropic / Gemini behind one interface.

### Phase 3 — deeper geometry (later, server-side)

Self-host a real reconstruction pipeline (COLMAP + monocular depth, e.g. the cozmo-style or
Torthosplatting-style architecture, §3.3b) behind a small HTTP service; the RN app becomes a
capture/upload client. Requires infrastructure and GPU — clearly out of prototype scope.

### Phase 4 — AR room scanning (optional, later)

ARCore-based room scan with depth via ViroReact (`@reactvision/react-viro`, active, MIT,
official Expo starter kit). No Expo AR module exists in SDK 57 at all (§3.5). This is a
separate product feature, not needed for the photo-based prototype.

### Secondary interpretation (photo of a paper drawing → digitized blueprint)

Covered compactly in §3.4. Prototype path: same camera flow + multimodal LLM transcription
into the same JSON schema (no native code). If vector fidelity matters more than speed,
RasterScan's hosted/Docker floor-plan-recognition service is the only verified hosted option.

---

## 2. Findings

### 3.1 Camera capture in Expo SDK 57 (`expo-camera`)

**Version & install.** The v57 docs page for the module states "Recommended version:
~57.0.5" (source: https://docs.expo.dev/versions/v57.0.0/sdk/camera/). npm's published
57.x line ends at exactly `57.0.5` (source: https://registry.npmjs.org/expo-camera), and the
SDK 57 branch's authoritative bundle map pins `"expo-camera": "~57.0.5"`
(source: https://github.com/expo/expo/blob/sdk-57/packages/expo/bundledNativeModules.json).
Install command per the v57 docs (pnpm variant for this repo):
`pnpm expo install expo-camera` (source: https://docs.expo.dev/versions/v57.0.0/sdk/camera/).

**app.json configuration.** SDK 57 uses a config plugin (Continuous Native Generation); the
documented entry is (source: https://docs.expo.dev/versions/v57.0.0/sdk/camera/):

```json
{
  "expo": {
    "plugins": [
      [
        "expo-camera",
        {
          "cameraPermission": "Allow $(PRODUCT_NAME) to access your camera",
          "microphonePermission": "Allow $(PRODUCT_NAME) to access your microphone",
          "recordAudioAndroid": true,
          "barcodeScannerEnabled": true
        }
      ]
    ]
  }
}
```

Documented property semantics (same source):

- `cameraPermission` — **iOS only**; sets the `NSCameraUsageDescription` string.
- `microphonePermission` — **iOS only**; sets `NSMicrophoneUsageDescription`.
- `recordAudioAndroid` (default `true`) — whether to enable `RECORD_AUDIO` on Android. For a
  photo-only app set this to `false` so no microphone permission is requested.
- `barcodeScannerEnabled` (default `true`) — disables barcode scanning to reduce app size;
  "on Android, this option only takes effect when expo-camera builds from source" (add it to
  `buildFromSource` in package.json) — prebuilt modules already include the barcode libs.

**Android CAMERA permission:** the docs state "expo-camera automatically adds
`android.permission.CAMERA` permission to your project's … AndroidManifest.xml" for non-CNG
projects, and under CNG the plugin handles it (source:
https://docs.expo.dev/versions/v57.0.0/sdk/camera/). The generic `android.permissions` app-config
key (array of permission strings added during prebuild) also exists in v57
(source: https://docs.expo.dev/versions/v57.0.0/config/app/), but for camera the plugin is the
documented mechanism. **Note:** the old top-level `cameraUsageDescription` app.json key does
**not** appear anywhere in the v57 app-config reference (verified by full-text search of
https://docs.expo.dev/versions/v57.0.0/config/app.md) — "Expo HAS CHANGED": use the plugin
property instead.

**Runtime permissions API.** `useCameraPermissions(options?)` returns
`[PermissionResponse | null, RequestPermissionMethod<PermissionResponse>, GetPermissionMethod<PermissionResponse>]`;
it wraps `requestCameraPermissionsAsync` + `getCameraPermissionsAsync`. The documented pattern
is to render nothing (or a placeholder) while the response is `null`, then a "grant
permission" UI when `!permission.granted` (source:
https://docs.expo.dev/versions/v57.0.0/sdk/camera/, "Hooks → useCameraPermissions").

**Capture API surface.** Component is `CameraView` with props incl. `facing`
(`'back' | 'front'`), `mode` (`'picture' | 'video'`), `onCameraReady`, `ratio`
(`'4:3' | '16:9' | '1:1'`), `enableTorch`, `flash`, `zoom` (source: same camera page, "API").
Capture method (same source, "Component methods"):

- `takePictureAsync(options?: CameraPictureOptions) → Promise<CameraCapturedPicture>` —
  "Takes a picture and saves it to app's cache directory. Photos are rotated to match
  device's orientation (if `options.skipProcessing` flag is not enabled) and scaled to match
  the preview." Returns `{ uri, width, height, base64?, exif? }`; on Android/iOS `uri` is a
  URI to the local image file, **on web it is a base64 string**. "On native platforms, the
  local image URI is temporary. Use FileSystem.copy to make a permanent copy of the image."
- New in this generation: `takePictureAsync({ ...options, pictureRef: true }) →
Promise<PictureRef>` — returns "basic image data, and a reference to native image instance
  which can be passed to other Expo packages supporting handling such an instance" (i.e. you
  can feed the capture straight into `expo-image-manipulator` without an intermediate file).

`CameraPictureOptions` fields (same source, "Types → CameraPictureOptions"):

- `quality?: number` — 0..1 compression quality, default `1`.
- `exif?: boolean` — include EXIF data in the result.
- `additionalExif?: Record<string, any>` — native only, only with `exif: true`.
- `base64?: boolean` — also return JPEG base64.
- `skipProcessing?: boolean` — see EXIF/orientation below.
- `onPictureSaved?` — callback variant that resolves the promise immediately.
- Web-only: `imageType`, `isImageMirror`, `scale`. Deprecated: `mirror` (use CameraView prop).

**Multi-photo capture flow for a room:** there is no built-in "burst/room" API; the documented
pattern is repeated `takePictureAsync()` calls on a live `CameraView` (the docs' own
"Camera app example" shows single-capture + display). Two doc-mandated constraints shape the
flow (source: same camera page):

- "Only one Camera preview can be active at any given time. If you have multiple screens in
  your app, you should unmount Camera components whenever a screen is unfocused."
- "Avoid calling this method while the preview is paused. On Android, this will throw an
  error." Also wait for `onCameraReady` before capturing.

Practical multi-shot flow: keep one `CameraView` mounted on the capture screen; each shutter
press → `takePictureAsync({ quality: 0.8 })` → copy to a per-room folder in app storage →
append thumbnail (via `expo-image`, already a repo dependency) to a strip UI → stop after N
shots or user confirmation.

**Expo Go vs development build.** The v57 camera page explicitly lists the module as
"Included in Expo Go" (also in the page frontmatter: `platforms: ['android*', 'ios*', 'web',
'expo-go']`) (source: https://docs.expo.dev/versions/v57.0.0/sdk/camera/). So camera capture
works in Expo Go on Android — **but** each Expo Go build contains exactly one SDK version, and
"Expo Go on the Apple App Store stops at SDK 54 … The Google Play version can also lag behind
a new SDK release"; for newer SDKs you install a matching build from `expo.dev/go` (selecting
SDK + platform) or via the `expo-go` CLI (source:
https://docs.expo.dev/troubleshooting/expo-go-version-mismatch/). Since the user's phone
install path is unknown, **first step on-device: confirm the installed Expo Go accepts an SDK
57 project** (error text: "Project is incompatible with this version of Expo Go"); if not,
install the SDK 57 build from expo.dev/go or switch to a development build (source: same page;
dev-build mechanics at https://docs.expo.dev/develop/development-builds/use-development-builds/
and https://docs.expo.dev/develop/development-builds/faq/).

**Web iteration.** Camera works on web in v57; "Image URIs are always returned as base64
strings because local file system paths are unavailable in the browser" (source: same camera
page, "Web support") — so the capture screen can be developed in the browser.

**Starter reference.** `npx create-expo-app --example with-camera` ships a configured
with-camera example (source: same camera page, "Installation").

### 3.2 Image handling after capture

**expo-file-system (~57.0.7) — the API was rewritten.** The v57 docs describe a new
class-based API; the old `FileSystem.*` namespace is still available but as a legacy entry
point (source: https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/):

```ts
import { File, Directory, Paths } from 'expo-file-system'; // new API
import * as FileSystem from 'expo-file-system/legacy'; // old namespace, still shipped
```

Verified v57 surface (same source, "Usage" + "API"):

- `new File(Paths.cache, 'name.jpg')` — instances don't need to pre-exist; the constructor
  only throws if the class doesn't match an existing path's kind.
- `file.create()`, `file.write(bytes)`, `file.textSync()`, `file.bytes()`, `file.base64()`,
  `file.size`, `file.exists`, `file.uri`, `file.info()`.
- `file.copy(destination, options)` / `file.move(...)` — this is the documented way to make a
  permanent copy of a camera capture ("Use FileSystem.copy to make a permanent copy" per the
  camera page; in v57 that's `File#copy`).
- `Paths.cache` — "a place to store files that can be deleted by the system when the device
  runs low on storage"; `Paths.document` — "safe from being deleted by the system". Use
  `Paths.document` for anything the user expects to keep (blueprint JSON/SVG/DXF exports).
- Uploads: `fetch` from `'expo/fetch'` accepts a `File` directly as body or in `FormData`;
  there is also `file.upload(url, options) → Promise<UploadResult>` which "resolves with the
  HTTP response metadata and body for any completed response, including non-2xx status codes"
  (source: same filesystem page, "Uploading files using expo/fetch" + "API → File → upload").

Version verification: docs "Recommended version: ~57.0.7"; npm's 57.x line ends at 57.0.7;
bundle map pins `~57.0.7` (sources: the filesystem page,
https://registry.npmjs.org/expo-file-system, bundledNativeModules.json).

**expo-image-manipulator (~57.0.17) — also rewritten.** v57 API is a chainable context
(source: https://docs.expo.dev/versions/v57.0.0/sdk/imagemanipulator/):

```ts
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

const context = ImageManipulator.manipulate(uriOrPictureRef); // string URI or SharedRef<'image'>
context.resize({ width: 2048, height: null }); // one dim → ratio preserved
context.rotate(90); // deg, +cw / −ccw
context.flip(FlipType.Vertical); // 'vertical' | 'horizontal'
context.crop({ originX, originY, width, height });
const imageRef = await context.renderAsync(); // ImageRef {width, height}
const result = await imageRef.saveAsync({
  // ImageResult {uri, width, height, base64?}
  format: SaveFormat.JPEG, // 'jpeg' | 'png' | 'webp'
  compress: 0.8, // 0..1, 1 = no compression
});
```

There is also a `useImageManipulator(source)` hook (same source). The old
`manipulateAsync(uri, actions, saveOptions)` is marked **Deprecated** in v57 docs. Crucially,
`manipulate()` accepts `string | SharedRef<'image'>` — so a camera `PictureRef` from
`takePictureAsync({ pictureRef: true })` can be passed directly, skipping an intermediate file
(same source; PictureRef documented on the camera page).

**Is it needed before uploading to an AI API? Yes — recommended.** All three major vendors
tokenize/limit by image pixels, so pre-resizing cuts cost and latency: OpenAI's vision docs
show explicit token math per pixel budget (source:
https://platform.openai.com/docs/guides/vision); Claude's docs say "To minimize latency …
prefer resizing images before uploading them" and cap the standard tier at a 1568 px long edge
(source: https://docs.anthropic.com/en/docs/build-with-claude/vision). A practical target:
long edge ≤ 2048 px, JPEG compress ≈ 0.7–0.8 (keeps wall/door detail while staying well under
every vendor's limit — OpenAI accepts up to a 512 MB request / 1,500 images; Claude max image
8000×8000 px and 10 MB base64; Gemini inline data caps total request at 20 MB).

**EXIF stripping:** there is no explicit "strip EXIF" option in the v57 manipulator docs.
Re-encoding via `saveAsync({ format: SaveFormat.JPEG })` produces a fresh JPEG (metadata
handling not documented — treat as an inference, **UNVERIFIED** that all EXIF tags are
dropped). It doesn't matter much for the AI call itself: OpenAI's docs state "The model
doesn't process original file names or metadata" (source:
https://platform.openai.com/docs/guides/vision, "Limitations"). What _does_ matter is whether
you request EXIF in the first place — `takePictureAsync({ exif: false })` avoids capturing GPS
coordinates into your upload payload (privacy; see §6).

**EXIF orientation behavior on Android.** The v57 camera docs are explicit (source:
https://docs.expo.dev/versions/v57.0.0/sdk/camera/, `CameraPictureOptions.skipProcessing`):
enabling `skipProcessing` "skips orientation adjustment and returns an image straight from the
device's camera … Image component does not respect EXIF stored orientation information, that
means obtained image would be displayed wrongly (rotated by 90°, 180° or 270°). Different
devices provide different orientations. For example some Sony Xperia or Samsung devices don't
provide correctly oriented images by default. **To always obtain correctly oriented image
disable skipProcessing option.**" The documented fix is therefore: leave `skipProcessing` off
(default) so the camera module bakes in the rotation before saving.

### 3.3 AI approaches: photos → floor plan (main interpretation)

#### 3.3a Cloud multimodal LLM APIs

**OpenAI (GPT-4o / GPT-5-class).**

- Image input: `image_url` content parts; multiple images per request are supported ("You can
  provide multiple images as input in a single request by including multiple images in the
  content array, but keep in mind that images count as tokens and will be billed
  accordingly"); limits: PNG/JPEG/WEBP/GIF, up to 512 MB payload, up to 1,500 images per
  request (source: https://platform.openai.com/docs/guides/vision).
- Tokenization (same source): legacy tile-based models — `gpt-4o`/`gpt-4.1`: base **85**
  tokens + **170** per 512 px tile; with `detail: "low"` only the base tokens are charged;
  high/auto scales to ≤2048×2048 then shortest side ≤768 px before tiling. Newer models
  (gpt-5.x / gpt-6-astra) use 32 px patches with a model multiplier (e.g. ×1.2 for the
  gpt-5.4–gpt-5.6 family) and per-detail patch budgets (e.g. 2,500-patch budget for `high`).
- Structured output: GA `response_format: { type: "json_schema", json_schema: { strict: true,
schema } }` — "only supported with the gpt-4o-mini, … and gpt-4o-2024-08-06 model snapshots
  and later" (source: https://platform.openai.com/docs/guides/structured-outputs).
- Pricing: the current pricing page lists the flagship lineup as gpt-5.6-sol / -terra / -luna
  and gpt-6-astra (per 1M tokens, short context): e.g. **gpt-5.6-luna $0.20 input / $1.20
  output**, gpt-5.6-terra $2.00/$12.00, gpt-5.6-sol $4.00/$20.00 (source:
  https://platform.openai.com/docs/pricing). **gpt-4o no longer appears on the pricing page**
  (only `gpt-4o-transcribe` remains) — treat gpt-4o as deprecated; whether it is still callable
  is **UNVERIFIED**.
- Cost estimate for one ~12 MP phone photo at `high` detail, derived from the documented rules:
  4000×3000 → fits 2048² → shrunk to the 2,500-patch budget (gpt-5.6 family) → ≈3,000 billable
  tokens → ≈ **$0.0006** input at luna rates; add ~1–2k output tokens for the JSON plan
  (≈$0.001–0.003). A 4-photo room ≈ $0.01–0.05 even at the sol tier. (Arithmetic from cited
  tokenization + pricing pages; treat as an estimate, not a vendor quote.)
- **Quality caveats — directly relevant to floor plans** (same vision page, "Limitations"):
  "Spatial reasoning: The model struggles with tasks requiring precise spatial localization"
  and "Image shape: The model struggles with panoramic and fisheye images." Expect _topology_
  (which walls exist, where doors/windows are, room shapes) to be reasonably extractable from
  good photos, but **do not expect reliable metric dimensions** from a single LLM pass.

**Anthropic Claude.**

- Image input: base64 or URL content blocks; JPEG/PNG/GIF/WebP (first frame only); up to 100
  images per request for 200k-context models (600 otherwise), max 8000×8000 px, 10 MB base64
  per image on the direct API (source:
  https://docs.anthropic.com/en/docs/build-with-claude/vision).
- Token cost: visual tokens = ⌈w/28⌉ × ⌈h/28⌉; standard tier downsamples to a 1568 px long
  edge / 1,568-token cap (Claude 4.7+ gets a high-res tier: 2576 px / 4,784 tokens). The docs
  include concrete pricing anchors: "at Claude Haiku 4.5's **$1 USD per million input tokens**
  (standard tier), the 1000×1000 image costs about **$1.30 USD per thousand images**. At
  Claude Opus 5's **$5 USD per million** (high-resolution tier), the same image costs about
  $6.48 USD per thousand" (same source).
- Structured output: GA `output_config.format` with `type: "json_schema"` — "Structured
  outputs guarantee schema-compliant responses through constrained decoding … No retries needed
  for schema violations"; the old beta header is no longer required (source:
  https://docs.anthropic.com/en/docs/build-with-claude/structured-outputs).

**Google Gemini.**

- Image input: inline base64 or URL; "Inline image data limits your total request size … to
  20 MB. For larger requests, upload image files using the File API" (source:
  https://ai.google.dev/gemini-api/docs/image-understanding). Multiple images per prompt are
  supported (same page shows multi-image examples).
- Structured output: `response_mime_type: "application/json"` + JSON Schema in REST; SDKs
  accept Pydantic/zod schemas directly ("JSON Schema. This ensures predictable, type-safe
  results") (source: https://ai.google.dev/gemini-api/docs/structured-output).
- Pricing (current lineup): **gemini-3.8-flash $0.75 input / $3.75 output per 1M tokens**
  (promotional through 2026-12-31; $1.50/$7.50 from 2027), with a free tier; older Gemini 2.x
  models no longer appear on the pricing page (source:
  https://ai.google.dev/gemini-api/docs/pricing).

**Prompt patterns for walls/rooms/furniture extraction.** No vendor publishes floor-plan-specific
prompting guidance — this is community practice (**UNVERIFIED** quality; pilot before
committing). The pattern that follows from the documented capabilities: one request per room
containing all of that room's photos + a system prompt defining a strict JSON schema
(`walls[]` as endpoint pairs, `rooms[]` as labeled polygons, `openings[]` typed door/window
with wall association, plus per-item `confidence`), with instructions to reconcile the angles
and mark anything not visible. Multi-photo behavior is only _mechanically_ documented (you may
send N images; they all count as tokens) — how well models fuse several views of one room into
a consistent layout is **UNVERIFIED** against any primary benchmark I could find; the honest
primary-source signal is that even dedicated pipelines report photo-tier accuracy as "not yet
measured" (§3.3b, cozmo).

**Latency expectations.** No primary source publishes per-request latency for vision calls —
**UNVERIFIED**. Documented levers are image size/token count (both vendors' docs above) and
batching; plan on seconds-to-tens-of-seconds per room and design the UI around an async
"processing" state.

#### 3.3b Dedicated open-source models/services for floor plans

Verified via GitHub API + repo READMEs:

1. **Torthosplatting** (hjh530, no license, pushed 2026) — "capture a room with your phone,
   get a floor plan in one click." Pipeline: phone photos/video → COLMAP sparse SfM →
   monocular depth (DepthAnythingV2) → 3D Gaussian Splatting trained + rendered **orthographically**
   → Difix diffusion restoration → SIFT-stitched orthophoto. Output is a _raster_ top-down
   floor-plan image, not vector JSON. Requirements: Linux, CUDA 11.8, NVIDIA GPU (~24 GB).
   Not usable from an RN prototype; valuable as the reference architecture for Phase 3.
   (source: https://github.com/hjh530/Torthosplatting)

2. **cozmo-ai-case-study** (Abhinob-Bora, no license, active 2026) — a `plan` CLI that turns
   phone captures into a _dimensioned_ floor plan: inputs are **photos (2–8 stills per room)**,
   handheld video, or iPhone LiDAR; outputs `plan.json` (against a committed JSON schema in
   `schema/`), `plan.svg`, and `report.md` with 90% confidence intervals on every measurement.
   Runs on Python 3.12 **without GPU** (per-photo metric monocular depth + EXIF intrinsics,
   SIFT registration, room placement by doorway matching). A public live demo exists at
   api.probedeck.com/cozmo. Status per the repo: "photo and video produce plans but their
   accuracy is not yet measured." This is the closest verified thing to "photos → dimensioned
   plan" today; usable from a prototype only by self-hosting it behind an HTTP wrapper
   (Phase 3). (source: https://github.com/Abhinob-Bora/cozmo-ai-case-study)

3. **RasterScan/Floor-Plan-Recognition** (no license, pushed 2025) — raster floor-plan image →
   vector ("convert Raster to Vector on floor plan images"). Ships as a Docker service with
   HTTP endpoints `/plan_recognition` and `/plan_recognition_on_base64`, plus a hosted RapidAPI
   portal; based on the ICCV paper "Raster-to-Vector: Revisiting Floorplan Transformation"
   (source: https://github.com/RasterScan/Floor-Plan-Recognition,
   https://jiajunwu.com/papers/im2cad_iccv.pdf). This is the only **verified hosted**
   floor-plan vectorization service — relevant to the secondary interpretation (§3.4), callable
   from RN over plain HTTP.

4. **TF2DeepFloorplan / PyTorch-DeepFloorplan** (zcemycl; 267★ GPL-3.0 / MIT) — "Deep FloorPlan
   Recognition using a Multi-task Network with Room-boundary-Guided Attention" (DeepFPN):
   raster plan image → vector graph of walls/rooms/openings. Research code, local GPU
   inference required; secondary interpretation only. (sources:
   https://github.com/zcemycl/TF2DeepFloorplan, https://github.com/zcemycl/PyTorch-DeepFloorplan)

5. **FPDS — FloorPlan-DeepSeek** (arXiv 2506.21562, 2025) — LLM-style "next room prediction"
   for floor-plan _generation_; evaluated on text-to-floorplan, competitive with diffusion
   models. Not photo-based; included because it shows the LLM-fits-floor-plans direction is an
   active research area. (source: https://arxiv.org/abs/2506.21562)

**Conclusion:** no hosted API does phone-photos → vector floor plan today. Prototype = cloud
multimodal LLM with a strict schema (§3.3a); real geometry later via self-hosted SfM/depth
pipeline (Phase 3).

#### 3.3c On-device options (TFLite/MediaPipe) — feasibility only

- `react-native-fast-tflite` (margelo, 1,234★, MIT, actively pushed 2026) provides TFLite
  inference with GPU acceleration in RN (source: https://github.com/margelo/react-native-fast-tflite).
- MediaPipe's current vision task catalog is face detection/landmarks, gesture recognition,
  image classification, (selfie/hair/object) segmentation, object detection, pose — there is
  **no wall-detection, room-layout, or floor-plan model** in it (source:
  https://ai.google.dev/edge/mediapipe/solutions).
- No off-the-shelf TFLite "walls from interior photo" model was found on GitHub (searches for
  wall detection / floor plan returned only climbing-wall hold detectors and research repos,
  source: GitHub API search, 2026).

**Verdict: not prototype-viable.** You would need to train a custom model plus native bridge
work — a months-long detour. Label as Phase 4+/research; the cloud path is strictly better for
a days-scale prototype.

### 3.4 Alternative interpretation: photo of a paper drawing → digitized blueprint (compact)

- **Capture:** identical `expo-camera` flow (§3.1). For a flat drawing, a single high-quality
  shot with the phone roughly parallel to the page is the whole capture UX.
- **Perspective correction options:**
  - _No native code (prototype pick):_ skip explicit rectification and let a multimodal LLM
    transcribe the drawing directly into the same JSON schema (walls/rooms/openings). Caveat:
    OpenAI's documented limitation "The model may misinterpret rotated or upside-down text and
    images" applies (source: https://platform.openai.com/docs/guides/vision) — instruct the user
    to keep the page upright and lit.
  - _On-device rectification:_ `react-native-fast-opencv` (lukaszkurantdev, 254★, active Aug 2026) is a JSI port of OpenCV's C++ API for RN; "Version V1 (July 2026) supports only the
    new architecture (tested only on React Native versions 0.85 and later)" — compatible with
    this repo's RN 0.86.3, but it ships a _selected_ function subset (findContours /
    perspectiveTransform availability must be checked in its function list before relying on
    them — **UNVERIFIED**). (source: https://github.com/lukaszkurantdev/react-native-fast-opencv)
  - Older bindings are stale: `react-native-opencv3` (adamgf, last push 2023-09),
    `brainhubeu/react-native-opencv-tutorial` (2023). The canonical "react-native-opencv2" repo
    returns 404 on GitHub — its maintenance status is **UNVERIFIED** (likely unmaintained).
- **Vectorization of the scanned drawing:** RasterScan's Docker/RapidAPI service (§3.3b #3) is
  the only verified hosted option; DeepFPN-style models run locally with GPU.
- **Recommendation:** Phase 1 covers this interpretation for free — same schema, different
  prompt ("this is a floor plan drawing; transcribe it"). Add RasterScan or fast-opencv in
  Phase 2 only if LLM transcription proves too lossy for the user's actual drawings.

### 3.5 Depth / 3D / AR on Android

- **LiDAR** is Apple hardware (iPhone Pro line); there is no LiDAR path on Android and no Expo
  module exposing it anywhere in SDK 57.
- **ARCore Depth API:** "uses a depth-from-motion algorithm … selectively uses machine
  learning"; depth available from 0–65 m, most accurate at 0.5–5 m; "valid depth data are only
  available after the user has started moving their device around"; supported-device list is
  maintained on the ARCore devices page (source: https://developers.google.com/ar/develop/depth).
- **Expo SDK 57 contains no AR module at all.** The authoritative bundle map for SDK 57
  (123 entries) has no `expo-ar`, no depth/LiDAR/scannable/barcode/OpenCV package — verified by
  full scan of https://github.com/expo/expo/blob/sdk-57/packages/expo/bundledNativeModules.json.
  (The old `expo-ar` was removed from Expo long before SDK 57.)
- **Community status:** the `react-native-ar/react-native-ar` repository no longer exists
  (HTTP 404; the org now only holds `react-native-arkit`, dormant since 2023-01) — verified via
  GitHub API, 2026. The actively maintained RN AR option is **ViroReact**
  (`@reactvision/react-viro`, ReactVision/viro, 1,824★, MIT, pushed 2026): "iOS (ARKit) ✅,
  Android (ARCore) ✅", "works with both React Native CLI and Expo projects" with an official
  Expo + TypeScript starter kit (source: https://github.com/ReactVision/viro).

**Verdict:** irrelevant for the photo-based prototype; a ViroReact AR room-scan feature is a
clean Phase 4 option if the product wants "walk around with the camera" capture quality.

### 3.6 Output representation

- **JSON schema (source of truth):** define
  `walls: [{id, from:[x,y], to:[x,y], lengthM?}]`, `rooms: [{id, label, polygon:[[x,y]…]}]`,
  `openings: [{id, type:'door'|'window', wallId, positionT?, widthM?}]` in normalized or meter
  coordinates, plus per-item confidence. A real-world example of exactly this shape (plan.json
  with a committed schema + SVG rendering) exists in the cozmo repo's `schema/` directory
  (source: https://github.com/Abhinob-Bora/cozmo-ai-case-study).
- **SVG rendering in RN:** `react-native-svg` — SDK 57 pins **15.15.4** in the bundle map
  (source: bundledNativeModules.json; install with `pnpm expo install react-native-svg`). Walls
  = `<Line>`/`<Path>`, rooms = filled `<Polygon>` using theme tokens for colors, openings =
  gap markers/labels.
- **DXF export (later):** npm options verified against the registry —
  `@jscad/dxf-serializer` v2.1.23 (JSCAD's DXF writer; last published 2026-02, active)
  (source: https://www.npmjs.com/package/@jscad/dxf-serializer); `dxf` v5.3.1 is a parser
  (2025-09, active) useful for round-trip testing
  (source: https://www.npmjs.com/package/dxf); `dxf-writer` v1.18.4 is stale (2022). For a
  prototype, hand-writing minimal ASCII DXF (`LWPOLYLINE`/`LINE` entities for wall segments) is
  ~50 lines and avoids a dependency — both are viable; the serializer is the safer default.

### 3.7 Android specifics

- **Runtime permission flow:** request on entering the capture screen via
  `useCameraPermissions()`; render an explainer + retry button while `!granted` (documented
  pattern, source: https://docs.expo.dev/versions/v57.0.0/sdk/camera/). CAMERA is a runtime
  permission on Android; the plugin adds it to the manifest (§3.1).
- **Scoped storage / MediaStore on Android 13+:** photos captured by `expo-camera` are written
  to the **app's private cache directory** — no storage permission involved at all (source:
  camera page, "saves it to app's cache directory"). Only _saving results to the shared
  gallery_ touches MediaStore, via `expo-media-library`: its v57 runtime API is
  `requestPermissionsAsync()` / `usePermissions({ writeOnly, granularPermissions })`
  (source: https://docs.expo.dev/versions/v57.0.0/sdk/media-library/), and the v57 legacy page
  documents the exact manifest permissions the plugin adds — `READ_MEDIA_IMAGES`,
  `READ_MEDIA_VIDEO`, `READ_MEDIA_AUDIO` (Android 13+ granular), plus
  `READ_MEDIA_VISUAL_USER_SELECTED` for the photo picker, legacy `READ/WRITE_EXTERNAL_STORAGE`,
  and optional `ACCESS_MEDIA_LOCATION` (source:
  https://docs.expo.dev/versions/v57.0.0/sdk/media-library-legacy/). The v57 page also warns:
  "On Android, full access to the media library … is allowed only for apps that require broad
  access to photos" per Google Play's Photo and Video Permissions policy (source: media-library
  page) — another reason to keep gallery-save optional in a prototype.
- **Testing on a real device:** verified against the _installed SDK 57 CLI_ (`expo start --help`):
  `npx expo start --android` = "Open on a connected Android device"; `-g, --go` launches in
  Expo Go; `-d, --dev-client` in a custom native app; `--host lan|tunnel|localhost` controls
  reachability. The documented physical-device flow is: run `npx expo start`, scan the QR code
  with the device's camera (or press A for emulator) (source:
  https://docs.expo.dev/develop/development-builds/use-development-builds/). Expo Go must match
  SDK 57 (§3.1); a development build must be **rebuilt whenever you add a native module** — all
  Phase 1 packages are in Expo Go's fixed set, so no rebuild is needed for the MVP (source:
  same page + https://docs.expo.dev/develop/development-builds/faq/).
- **Known camera pitfalls (documented):** one active preview at a time; unmount on screen blur;
  never call `takePictureAsync` while the preview is paused (throws on Android); wait for
  `onCameraReady`; don't use `skipProcessing` on Android (orientation, §3.2); web returns
  base64 not file URIs (source: https://docs.expo.dev/versions/v57.0.0/sdk/camera/). Beyond
  these doc statements, general RN camera jank guidance (re-render costs, etc.) is **UNVERIFIED**
  against a primary source — keep the capture screen's state updates minimal as a precaution.

---

## 3. Expo SDK 57 specifics (verified facts)

**Exact versions for SDK 57** (cross-verified: v57 docs "Recommended version" lines, npm
registry published 57.x line endings, and the sdk-57 branch bundle map — all three agree):

| Package                                 | Version                                    | Source                                                                           |
| --------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| `expo-camera`                           | `~57.0.5` (latest published 57.0.5)        | docs page + https://registry.npmjs.org/expo-camera + bundle map                  |
| `expo-file-system`                      | `~57.0.7` (latest 57.0.7)                  | docs page + npm + bundle map                                                     |
| `expo-image-manipulator`                | `~57.0.17` (latest 57.0.17)                | docs page + npm + bundle map                                                     |
| `react-native-svg`                      | `15.15.4` (pinned; 15.15.5 also published) | https://github.com/expo/expo/blob/sdk-57/packages/expo/bundledNativeModules.json |
| `expo-media-library` (optional)         | `~57.0.5`                                  | docs page + bundle map                                                           |
| `expo-dev-client` (if dev build needed) | `~57.0.19`                                 | bundle map                                                                       |

Bundle-map cross-check: the repo's existing pins (`expo-constants ~57.0.18`, `expo-router
~57.0.21`, `expo-image ~57.0.5`, …) match the sdk-57 branch map exactly, so the map is
consistent with the installed `expo ~57.0.22`.

**app.json additions (as documented for v57):**

```jsonc
"plugins": [
  "expo-router",
  ["expo-splash-screen", { /* existing */ }],
  [
    "expo-camera",
    {
      // iOS-only NSCameraUsageDescription; harmless on Android
      "cameraPermission": "Allow BlueprintAI to take photos of your space",
      // photo-only app: do NOT request the microphone
      "recordAudioAndroid": false,
      // no barcode scanning needed (reduces APK size if built from source)
      "barcodeScannerEnabled": false
    }
  ]
]
```

No `android.permissions` entry is required for CAMERA (the plugin adds it), and there is no
top-level `cameraUsageDescription` key in v57 (§3.1).

**Capture → save → compress → upload signatures (v57):**

```ts
// 1) capture (expo-camera ~57.0.5)
const ref = await cameraRef.current?.takePictureAsync({
  quality: 0.8, // CameraPictureOptions.quality: 0..1, default 1
  exif: false, // skip EXIF (privacy + payload)
  pictureRef: true, // v57: return a native image ref instead of only a file URI
});

// 2) compress/resize (expo-image-manipulator ~57.0.17) — accepts the PictureRef directly
const ctx = ImageManipulator.manipulate(ref); // string | SharedRef<'image'>
ctx.resize({ width: 2048, height: null }); // preserve ratio
const imgRef = await ctx.renderAsync(); // ImageRef {width, height}
const saved = await imgRef.saveAsync({
  format: SaveFormat.JPEG,
  compress: 0.8,
});
// saved: ImageResult { uri, width, height, base64? } — uri in cache dir

// (simpler alternative without pictureRef:)
// const pic = await cameraRef.current?.takePictureAsync(); // CameraCapturedPicture {uri,width,height}
// const file = new File(pic.uri);                          // expo-file-system ~57.0.7

// 3) keep it (expo-file-system) — camera URIs are temporary
const permanent = new File(Paths.document, `room-${roomId}/${Date.now()}.jpg`);
new File(saved.uri).copy(permanent); // File#copy(destination)

// 4) upload to the AI API — expo/fetch (part of the expo package, no extra install)
import { fetch } from 'expo/fetch';
const res = await fetch('https://…/v1/chat/completions', {
  method: 'POST',
  headers: { authorization: `Bearer ${process.env.EXPO_PUBLIC_AI_KEY}` },
  body: JSON.stringify({
    /* messages with image content parts (base64) + json_schema */
  }),
});
// or multipart: formData.append('file', new File(saved.uri)); fetch(url, { method:'POST', body: formData })
```

---

## 4. Mapping to BlueprintAI (file-level plan)

Conventions respected: thin route files in `src/app/`, UI in `src/screens/`, reusable pieces
in `src/components/`, kebab-case filenames, `@/*` alias imports, colors only from
`src/constants/theme.ts` (`Colors[theme]` tokens via the existing `useTheme` hook).

**Phase 1 files:**

```
app.json                                   + expo-camera plugin entry (§3)
package.json                               + expo-camera, expo-file-system,
                                             expo-image-manipulator, react-native-svg
src/app/capture.tsx                        thin route → <CaptureScreen />
src/app/blueprint.tsx                      thin route → <BlueprintScreen roomId=… />
src/screens/capture-screen.tsx             permission gate (useCameraPermissions) +
                                           CameraView (facing=back, mode=picture, onCameraReady)
                                           + shutter button + PhotoStrip; unmounts camera when
                                           unfocused (doc requirement); navigate to /blueprint
src/screens/blueprint-screen.tsx           loading state → SVG render of plan JSON →
                                           retry / save / (phase 2: export DXF) buttons
src/components/photo-strip.tsx             horizontal thumbnails via expo-image + remove button
src/components/blueprint-svg.tsx           react-native-svg renderer for the plan schema,
                                           themed with Colors[theme].primary / .text etc.
src/lib/capture.ts                         capture loop: takePictureAsync → copy to
                                           Paths.document/rooms/<id>/; returns saved File list
src/lib/image-pipeline.ts                  resize/compress via ImageManipulator.manipulate;
                                           base64-encode for upload payloads
src/lib/blueprint-schema.ts                TS types + JSON Schema (walls/rooms/openings) shared
                                           by prompt builder, validator, and renderer
src/lib/ai-provider.ts                     one provider call (Gemini Flash or Claude Haiku tier)
                                           with structured-output mode; validates response
                                           against the schema; EXPO_PUBLIC_* key for prototype
```

**Phase 2 additions:** `src/screens/room-list-screen.tsx` + `src/app/rooms.tsx`;
`src/lib/dxf-export.ts` (`@jscad/dxf-serializer`); optional gallery save via
`expo-media-library` behind a settings toggle; provider switch in `ai-provider.ts`.

**What does NOT change:** `_layout.tsx` (add the two new routes to the existing stack), theme,
hooks, or web output. Web iteration works: camera on web returns base64 URIs (§3.1) and the
SVG renderer is pure RN/SVG — develop capture UX in the browser, verify on the Android phone
before trusting it.

---

## 5. Risks & open questions

1. **Phone install path unknown (highest practical risk).** If the installed Expo Go predates
   SDK 57, the project won't load at all ("Project is incompatible with this version of Expo
   Go"). Fix is documented (expo.dev/go or `expo-go` CLI to get the SDK 57 build; or a dev
   build) but requires user action on the phone. Device model/OS also matter for camera
   orientation quirks — the v57 docs explicitly call out Sony Xperia and Samsung devices as
   not providing correctly oriented images when `skipProcessing` is used (we avoid that path).
2. **LLM floor-plan quality is unproven.** No vendor benchmark exists for "room photos → wall
   layout"; OpenAI's own docs flag weak spatial reasoning and fisheye/panorama failure modes;
   the closest dedicated pipeline (cozmo) reports photo-tier accuracy as "not yet measured."
   Mitigation: Phase 1 pilot on 2–3 real rooms with known layouts; treat all dimensions as
   estimates with confidence labels; keep the JSON schema permissive enough to capture
   "uncertain" states.
3. **Cost/privacy of cloud AI.** Photos (and any EXIF if `exif: true`) leave the device to a
   third-party API. Use `exif: false` and pre-compressed JPEGs (cost scales with pixels —
   §3.3a math). Per-room cost is cents at flash-tier pricing, but it's not zero; an on-device
   path would take months (§3.3c). Before real users, move the API key behind a small backend
   proxy (`EXPO_PUBLIC_*` keys are embedded in the client bundle) and add a privacy notice.
4. **UNVERIFIED items** (could not be confirmed against a primary source): exact string format
   of the captured `uri` on Android (`file://…` vs plain path — v57 docs say "URI to the local
   image file" without spelling out the scheme; legacy docs used `file://`); `PictureRef`'s
   exact fields beyond "basic image data + native reference"; whether gpt-4o is still callable
   (absent from the current pricing page); concrete API latency numbers; whether
   `react-native-fast-opencv`'s function subset includes contour/perspective-transform ops;
   maintenance status of "react-native-opencv2" (repo 404); whether manipulator JPEG re-encode
   drops all EXIF tags.
5. **Vendor lineup churn.** All three vendors' current model/pricing pages reflect a fast-moving
   lineup (gpt-5.6 family, Claude 4.7/Opus 5 tiers, Gemini 3.x); older models (gpt-4o, Gemini
   2.x) have already disappeared from pricing pages. Re-check the three pricing URLs before
   locking a provider; the architecture (schema + structured output) is identical across all
   three, so switching is cheap.
6. **Multi-room assembly.** All verified approaches produce per-room geometry; merging rooms
   into one coherent plan (shared walls, doorways) is where both LLM prompting and dedicated
   pipelines are weakest — expect manual correction UI in Phase 2 regardless of approach.
