# Floor Plan Generation Without an External AI API — Plan

**Scope:** This is a standalone plan. It does not modify `docs/research/blueprint-from-photos.md` or any implementation file — it proposes replacing the Gemini-based analysis step those describe/implement with a solution that makes no call to any external (third-party, network-dependent) API, paid or free.

Research date: 2026-09-12. Current repo state checked directly: `src/lib/ai-provider.ts` already implements a `FloorPlanProvider` interface with two backends — `gemini` (calls Google's Interactions API, `POST https://generativelanguage.googleapis.com/v1beta/interactions`, model `gemini-3.8-flash`, gated on `EXPO_PUBLIC_GEMINI_API_KEY`) and `mock` (deterministic local sample data for UI testing, no network). `src/lib/blueprint-schema.ts` defines the `FloorPlan`/`BlueprintWall`/`BlueprintRoom`/`BlueprintOpening` types, a JSON Schema sent to Gemini, and a validator (`validateFloorPlan`) plus geometry helpers (`planBounds`, `polygonCentroid`, `pointOnWall`) that the SVG renderer and exporters consume. Capture happens in `src/screens/capture-screen.tsx` via `expo-camera`; photos and generated plans live in an in-memory `src/lib/session-store.ts`.

Every factual claim below is cited. **UNVERIFIED** marks anything not confirmed against a primary source — treat those as leads, not facts, and validate them in a spike before depending on them.

---

## 1. Executive summary

**The Gemini call is not just an API-key problem — the underlying approach (photo + LLM guesses scale) is the wrong tool for the one thing that matters most here: real-world dimensions.** `docs/research/blueprint-from-photos.md` already documented this weakness for cloud LLMs ("the model struggles with tasks requiring precise spatial localization," OpenAI's own vision docs). Switching to a different vendor, or even to an on-device model, does not fix it: every 2D vision-language model — cloud or local — is reasoning over a flat photograph with no metric depth signal, so any "estimated wall length in meters" it emits is a guess dressed up as a number. Removing the external API is the right moment to also remove the guessing.

**Recommended replacement: stop asking a model to *infer* geometry from photos, and instead *measure* it directly, on-device, using the phone's own AR tracking.**

- **Phase 1 (replaces the Gemini path entirely — becomes the only floor-plan source):** an AR-guided manual capture flow. The user opens an AR session (ARCore via ViroReact) and walks the room; ARCore's 6-DoF pose tracking lets the app record the phone's real-world position at each tap. The user taps each wall corner in sequence and each door/window position; the app converts those tapped world poses directly into the existing `FloorPlan` schema — `walls[].from/to` in meters, `lengthM` computed from the actual tap positions (not estimated), `rooms[].polygon` from the tapped corners, `openings[]` from taps on a wall plus a type/width prompt. **Zero network calls, zero AI model, zero cost, deterministic.** This is the same technique consumer room-measuring apps (magicplan, RoomScan) are built on, though I did not find a rigorous published accuracy study for it to cite (see §6).
- **Phase 2 (optional accuracy/convenience layer, still no paid API):** for rooms where a full AR walkthrough is impractical, add an optional self-hosted "auto-suggest" service — your own GPU server running an open, MIT-licensed metric-reconstruction model (MoGe-2/3) on a handful of uploaded photos — that proposes candidate walls for the user to accept or drag into place. Still zero third-party billing; the cost is that you provision and run the compute yourself.
- **Explicitly rejected as the core solution: on-device Gemini Nano, Gemma 3n/4, or any other local vision-language model.** They are "non-external" in the narrow sense of not calling out over the network, but (a) as of this research they are Alpha/developer-preview software with narrow device support and no maintained React Native binding — adopting one means writing and maintaining your own native Android module for an uncertain, device-fragmented payoff — and (b) even a perfectly-working one still cannot solve the dimension problem, because it has no depth channel. Keep this class of model, at most, as an optional "suggest a room label" nicety behind a feature flag; never as the source of a measurement.

**What this removes:** the `gemini` provider id, `GEMINI_API_URL`/`GEMINI_MODEL`/`callGemini`/`requireApiKey`/`SYSTEM_INSTRUCTION`/`COMBINED_SYSTEM_INSTRUCTION` in `src/lib/ai-provider.ts`, the `EXPO_PUBLIC_GEMINI_API_KEY` env var, and the entire "send photos to a cloud model and hope it infers scale" approach from `docs/research/blueprint-from-photos.md` §1/§3.3a.

**What this costs you that the current plan didn't:** ViroReact is a native module, so the project leaves Expo Go for a development build (`expo prebuild` / EAS dev client) — exactly the boundary the original doc drew around its own "Phase 4 AR" idea. This plan's recommendation is to pull that work forward, because it turns out to be the only reliable way to get real dimensions without an external API.

---

## 2. Why not just find a better model? (research findings)

### 2.1 On-device LLM/VLM inference — solves topology at best, never dimensions

**Google ML Kit GenAI APIs (Gemini Nano).** The current API catalog is Summarization, Proofreading, Rewriting, Image Description, Speech Recognition, and Prompt — all Beta/Alpha ([ML Kit GenAI overview](https://developers.google.com/ml-kit/genai)). Only **Image Description** and **Prompt** take image input; only **Prompt** supports structured output, and its own docs label "Generate structured output" **Alpha**: it "accepts either a text input or a combined image and text input, and emits text output or structured output" ([ML Kit GenAI Prompt, Android](https://developers.google.com/ml-kit/genai/prompt/android)). Device support is real but narrow: the get-started guide's only hard constraint is Android API level 26+ and a non-unlocked bootloader (depends on the system AICore app) ([get-started guide](https://developers.google.com/ml-kit/genai/prompt/android/get-started)); Google's own October 2025 announcement says the Prompt API "currently performs best on the Pixel 10 device series," running Gemini nano-v3 ([Android Developers Blog, Oct 2025](https://android-developers.googleblog.com/2025/10/ml-kit-genai-prompt-api-alpha-release.html)). I could not find one authoritative page listing a complete device matrix — **UNVERIFIED as exhaustive**; assume real coverage is recent flagship Pixel/Galaxy devices only. **No official React Native/Expo binding exists**; the documented real path is a hand-written Kotlin native module bridged to JS ([third-party integration writeup](https://mobile.wednesday.is/writing/react-native-on-device-llm-core-ml-gemini-nano-integration)). The two community RN packages found are both explicitly not production-ready (`albertoroda/react-native-ai-core`, MIT, 2★, README says "Not recommended for production use yet"; `nagaraj-real/react-native-local-genai`, MIT, 0★, text-only, no image input).

**Gemma 3n / Gemma 4.** Gemma 3n is confirmed multimodal (image + text, MobileNet-V5 vision encoder), two sizes E2B/E4B, under Google's custom Gemma license (open-weight but not an OSI license) ([Gemma 3n overview](https://ai.google.dev/gemma/docs/gemma-3n)). The current (Sept 2026) runtime path is Google's **LiteRT-LM** (`google-ai-edge/LiteRT-LM`, Apache-2.0, ~2,306 commits, v0.16.0), which explicitly lists multimodal support and a Kotlin Android API; the older MediaPipe LLM Inference API is now maintenance-only, with Google recommending migration to LiteRT-LM ([LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM)). **No confirmed schema-constrained/JSON decoding** in LiteRT-LM itself (unlike ML Kit's Prompt API) — you would parse raw text output. Gemma 4 (April 2026 "AICore Developer Preview") is explicitly multimodal but enrollment-gated and NPU/CPU-fallback, "not production-representative" per Google's own announcement, with structured output and tool calling listed as future work ([Android Developers Blog, Apr 2026](https://android-developers.googleblog.com/2026/04/AI-Core-Developer-Preview.html)). No official RN wrapper; the same experimental `react-native-ai-core` package wraps LiteRT-LM with the same non-production caveat.

**Other small open VLMs — genuinely good at 2D grounding, not at metric geometry:**

| Model | License | Size | Spatial capability (documented) | Ceiling for this use case |
|---|---|---|---|---|
| Moondream ([moondream.ai/models](https://moondream.ai/models)) | Permissive (free for personal/research/most commercial use) | 0.5B (375 MiB, phone-viable), 2B, 9B-MoE | Native **"Point"** skill — returns exact pixel coordinates | 2D pixel point only, no depth |
| Qwen3-VL ([QwenLM/Qwen3-VL](https://github.com/QwenLM/Qwen3-VL)) | Apache-2.0 | smallest = 2B | "Precise Object Grounding" (boxes + points); a "3D Grounding" cookbook claims 3D boxes | Whether those 3D boxes are metric-calibrated is **UNVERIFIED** — worth a hands-on spike, not assumed here |
| Molmo2 ([allenai/molmo2](https://github.com/allenai/molmo2)) | Apache-2.0 | 4B/8B/O-7B | Point-driven grounding is the model's core design premise | GPU/research-oriented, no mobile path documented |
| Florence-2 ([microsoft/Florence-2-large](https://huggingface.co/microsoft/Florence-2-large)) | MIT | 0.23B–0.77B | Dense region caption + phrase grounding (boxes) | No mobile/edge build documented |

**Bottom line for §2.1:** none of these solve the dimension problem. Every one reasons over an ordinary 2D photo with no metric depth channel — getting a wall length in meters out of any of them still requires a separate scale reference (a known object, stereo/motion depth, or a depth sensor). This is architecturally the same gap the existing doc already found in cloud LLMs; moving the model on-device doesn't close it.

### 2.2 Self-hosted 3D reconstruction models — real dimensions, but you run the compute and must watch licenses

| Repo | License | Stars | Metric scale? | Compute | Indoor/floor-plan use documented? |
|---|---|---|---|---|---|
| COLMAP (classic SfM) | — | — | Up-to-scale only; needs a reference | CPU-capable but slow; GPU recommended | General SfM/MVS, no floor-plan docs |
| [DUSt3R](https://github.com/naver/dust3r) | **CC BY-NC-SA 4.0 — non-commercial** | 7.3k | Relative/up-to-scale, not explicitly metric | CUDA required | Trained on indoor datasets (ARKitScenes/ScanNet++), no floor-plan use case |
| [MASt3R](https://github.com/naver/mast3r) | **CC BY-NC-SA 4.0 — non-commercial** | 3.1k | **Yes**, via a dedicated metric checkpoint ([`MASt3R_ViTLarge_..._metric`](https://huggingface.co/naver/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric)) | CUDA | Localization benchmarks, not floor-plan specific |
| [VGGT](https://github.com/facebookresearch/vggt) | Mixed — base non-commercial; **`VGGT-1B-Commercial` checkpoint is commercially licensed** | 14.2k, most active (CVPR 2025 Best Paper, "VGGT-Omega" update May 2026) | **UNVERIFIED** whether default output is metric — separate "LiDAR-VGGT" fusion papers exist specifically to add metric consistency, which is suggestive, not confirmed | Ampere GPU (CC 8.0+) for bf16 | No floor-plan use case documented |
| [MoGe (Microsoft)](https://github.com/microsoft/MoGe) | **MIT** | 2.9k | **Yes** — MoGe-2/3 explicitly output "metric depth maps"/"metric point maps" | GPU-focused (~60ms/image on A100/RTX3090 FP16); no CPU-only path documented | Open-domain, no floor-plan-specific docs |
| [Fast3R](https://github.com/facebookresearch/fast3r) | **FAIR NC Research License — non-commercial** | 1.6k | Not confirmed | CUDA | 1000+ image reconstruction framing, no floor-plan use case |
| [Spann3R](https://github.com/HengyiWang/spann3r) | Not confirmed | 1.1k | Not confirmed | 8-GPU training documented; inference VRAM not documented | Evaluated on indoor datasets (7-Scenes/Replica/ScanNet), general framing |

**Two purpose-built pipelines from the original doc, re-checked:**
- **cozmo-ai-case-study** ([Abhinob-Bora/cozmo-ai-case-study](https://github.com/Abhinob-Bora/cozmo-ai-case-study)) — still active (29 commits, last activity 2026-09-09), CPU-only, purpose-built for photo/video/LiDAR → dimensioned `plan.json`/`plan.svg`/`report.md` with cm-level confidence-interval *targets*. Its own README still says "photo and video produce plans but their accuracy is not yet measured." **New risk found this pass: no LICENSE file exists (`/LICENSE` 404s)** — legally all-rights-reserved until the maintainer clarifies. Fine for an internal spike; not safe as a production dependency yet.
- **Torthosplatting** ([hjh530/Torthosplatting](https://github.com/hjh530/Torthosplatting)) — COLMAP + 3D Gaussian Splatting + DepthAnythingV2 + diffusion restoration → a *raster* orthophoto, not a vector plan. Needs Linux + CUDA 11.8 + ~24 GB VRAM. Licensed "for academic research use" — not clearly commercially usable as a whole pipeline.

**Bottom line for §2.2:** real metric geometry is achievable this way, but it costs you a GPU server to run/pay for (not per-call vendor billing, but not free compute either), and most of the highest-profile 2024–2026 models (DUSt3R, base MASt3R, Fast3R) are non-commercial-only licenses — plan around that now, not after building on one. Only **MoGe (MIT)** and **VGGT's specific commercial checkpoint** are unambiguously safe if BlueprintAI is ever monetized.

### 2.3 On-device AR measurement — the actual answer for dimensions

- **ARCore Depth API**: documented optimal range "half a meter to about five meters," 0–65 m maximum ([Depth adds realism](https://developers.google.com/ar/develop/depth)). **Direct, primary-source-confirmed risk for this exact use case**: both the Depth API and Raw Depth API docs warn that low-texture surfaces get unreliable depth — "regions in the camera image that have more texture...will have higher raw depth confidence than regions that don't, **such as a blank wall**," and "surfaces with no texture usually yield a confidence of zero" ([Raw Depth, Java](https://developers.google.com/ar/develop/java/depth/raw-depth)). Plain painted walls are exactly the case Google's own docs flag as unreliable for *per-pixel depth* — mitigated in this plan by relying on tap-driven hit-testing and plane extent rather than dense depth scanning (see §3).
- **Confirmed API surface** ([Depth developer guide](https://developers.google.com/ar/develop/java/depth/developer-guide)): `Config.DepthMode.AUTOMATIC`, `Session.isDepthModeSupported()`, `Frame.acquireDepthImage16Bits()` (16-bit millimeters), `Frame.hitTest()` (can return `DepthPoint` trackables), `Frame.transformCoordinates2d()`.
- **`Plane.getExtentX()`/`getExtentZ()`**: confirmed to return a detected plane's bounding-rectangle length along its local X/Z axes **in meters**, combined with `getCenterPose()` ([ARCore `Plane` reference](https://developers.google.com/ar/reference/java/com/google/ar/core/Plane)). For a vertical plane (a wall), this is a direct, no-AI, no-network way to get a wall's real width/height from tracking data alone.
- **No official Google "Measure" app source was found.** The closest official sample, [ARCore Depth Lab](https://github.com/googlesamples/arcore-depth-lab) (Apache-2.0), is a Unity project with no measurement/ruler example and is explicitly no longer under active maintenance. Third-party "ARCore Measure" reimplementations exist on GitHub (e.g. `hl3hl3/ARCoreMeasure`) but are unverified here.
- **ViroReact** (`@reactvision/react-viro`, [ReactVision/viro](https://github.com/ReactVision/viro)): MIT license, actively maintained (v2.57.4, Jul 9 2026, 1.8k★), confirmed to work with Expo projects via an official [Expo TypeScript starter kit](https://github.com/ReactVision/expo-starter-kit-typescript). Its exact hit-testing/anchor API method names were **not confirmed at signature level in this pass** — **UNVERIFIED**, requires a closer read of its "Tracking and Anchors" docs before implementation. Confirmed: it is a native-code library, so adopting it means leaving Expo Go for a development build ([Expo dev builds intro](https://docs.expo.dev/develop/development-builds/introduction/)).
- **Expo SDK status, confirmed live as of 2026-09-12: SDK 57 (released June 30, 2026) is still current.** No Expo AR module has been added; the original doc's finding stands unchanged.

### 2.4 Comparative table

| Option | Stays in Expo Go? | Gives real dimensions? | Infra cost | License/maintenance |
|---|---|---|---|---|
| **ARCore Plane/hit-test via ViroReact (this plan's Phase 1)** | No — dev build | **Yes** — direct tracking data, not an ML guess | Phone-only, $0/call | ViroReact MIT, 1.8k★, active (Jul 2026) |
| ML Kit GenAI Prompt API (Gemini Nano), topology only | No — needs a custom native module, no maintained RN binding | No | Phone-only, $0/call | Google-maintained but Alpha; narrow device coverage |
| Gemma 3n/4 via LiteRT-LM, topology only | No — same native-module problem | No | Phone-only, $0/call | LiteRT-LM Apache-2.0 active; Gemma 4 still preview |
| Self-hosted MoGe-2/3 or MASt3R-metric (Phase 2) | Yes on the client; server is your own infra | Yes, but monocular-depth-derived and unvalidated for floor plans specifically | You provision/pay for a GPU | MoGe MIT active; MASt3R non-commercial |
| cozmo-ai-case-study (self-hosted, CPU-only) | Yes on the client; server is your own infra | Targets cm-level, but maintainers say accuracy "not yet measured" | Cheapest — CPU-only, ~2 GB disk | **No LICENSE file** — legal risk until resolved |
| Free-tier Gemini Flash (status quo, unchanged mechanism) | Yes | No — same spatial-reasoning weakness as always | $0 billed but still an external network dependency | N/A — this is what we're replacing |

---

## 3. Recommended replacement architecture (Phase 1)

**Goal:** produce the exact same `FloorPlan` shape (`walls`/`rooms`/`openings`, all in meters) that `src/lib/blueprint-schema.ts` already defines and that the renderer/exporters already consume — so nothing downstream of plan-generation needs to change. Only the *source* of the plan changes.

**Capture flow (new, replaces the "photos → `generateFloorPlan()`" step for real dimensions):**

1. User starts an AR session in a new capture screen (ViroReact scene). ARCore begins 6-DoF world tracking and vertical-plane detection.
2. User walks to each wall corner of the room and taps a "mark corner" control while aiming the phone at that corner (or performs a screen tap that triggers `Frame.hitTest()` against a detected plane/point cloud). Each tap records a world-space pose.
3. Consecutive corner taps, in walking order, become `walls[]`: `from`/`to` are the tapped world positions projected onto the horizontal (floor) plane and converted to the plan's 2D meter coordinate system; `lengthM` is computed directly from the tap positions (`Math.hypot(...)`), not estimated; the full sequence of corners closes into `rooms[0].polygon`.
4. For each door/window, the user taps its position on the relevant wall and picks door/window plus a width (a numeric input, pre-filled with the existing mock defaults — 0.85 m door, 1.2 m window — as a convenience, but editable); this becomes an `openings[]` entry with `wallId`, `positionT` computed from the tap's fractional position along that wall, and `widthM` from user input.
5. `confidence` is repurposed from "model confidence" to **tracking confidence**: 1.0 when the tap occurred in ARCore's `TRACKING` state with a valid plane/depth hit, lower when tracking was `LIMITED` at tap time — still meaningful, but now describing measurement quality instead of a model's guess.
6. Multiple rooms captured in one continuous AR session (without resetting tracking) are automatically in a shared coordinate frame — this replaces the current `generateCombinedPlan()` Gemini "assembler" call entirely for that case, since ARCore's own tracking already knows each room's relative position. When a session is lost (tracking failure, app restart, or rooms captured on separate visits), fall back to a simple manual 2D nudge-into-place editor (drag/rotate one room's plan relative to another) — no AI involved either way.

**Integration points with the existing codebase (described here as a plan; not applied by this document):**

- `src/lib/ai-provider.ts` — the `gemini` provider (`GEMINI_API_URL`, `GEMINI_MODEL`, `callGemini`, `requireApiKey`, `SYSTEM_INSTRUCTION`, `COMBINED_SYSTEM_INSTRUCTION`, and the `EXPO_PUBLIC_GEMINI_API_KEY` env var) would be removed. The `FloorPlanProvider` interface and `mockProvider` stay — the mock remains genuinely useful for UI development without a device in hand.
- New `src/lib/ar-capture.ts` (or similar): wraps the ViroReact scene lifecycle, exposes a small imperative API (`onCornerTap`, `onOpeningTap`, `finishRoom(): FloorPlan`) that performs the world-pose → meters conversion and calls `validateFloorPlan()` from `blueprint-schema.ts` as a self-check on its own output (the same validator that currently checks Gemini's output works unchanged here, since the output shape is identical).
- New capture screen/route (parallel to, or replacing, `capture-screen.tsx`'s current `expo-camera` flow) hosting the AR scene and tap UI. `expo-camera` itself does not need to disappear — a reference photo per room is still worth capturing for the user's own records/export — but photo capture would no longer feed an AI call.
- `src/lib/blueprint-schema.ts`, `src/lib/session-store.ts`, the SVG renderer (`blueprint-svg.tsx`), and the exporters (`dxf-export.ts`, `svg-export.ts`) need **no changes** — they already operate purely on the `FloorPlan` type, regardless of how it was produced.
- Build/tooling: add `@reactvision/react-viro`, run `expo prebuild` (or adopt an EAS development client), per [Expo's dev builds guide](https://docs.expo.dev/develop/development-builds/use-development-builds/) — the same doc the original research already cited for this exact tradeoff.

---

## 4. Phase 2 (optional): self-hosted photo-based assist

For a room the user can't or doesn't want to walk (e.g. cluttered, or they'd rather snap a few photos), keep a photo-based path — but point it at your own infrastructure instead of Gemini:

- A small service (outside the RN app) running **MoGe-2/3** (MIT) on your own GPU, accepting a handful of uploaded photos and returning a metric point cloud/depth. Fit vertical planes to the result to propose candidate walls; surface them in the same tap-to-confirm UI as Phase 1's manual flow, pre-filled but editable, with `confidence` explicitly lower than a real tap-measured wall (mark as "auto-detected — verify").
- Do not depend on cozmo-ai-case-study or Torthosplatting yet, per the license/GPU caveats in §2.2 — track cozmo's licensing question as an explicit blocker if it's ever adopted beyond a local spike.
- This is genuinely new infrastructure (a GPU box you run and pay for) that the original plan didn't budget for — it replaces "pay Google per call" with "pay for your own compute," which is the real tradeoff of "no external API" once you want any photo-only path at all.

---

## 5. What definitely does not survive, and what stays untouched

**Removed (proposed):** `gemini` provider id and everything specific to it in `src/lib/ai-provider.ts`; `EXPO_PUBLIC_GEMINI_API_KEY`; the Gemini-specific prompts; the framing in `docs/research/blueprint-from-photos.md` that treats "send photos to a cloud multimodal LLM" as the Phase 1 answer (that document is left as-is by this plan, but its recommendation is superseded by this one).

**Kept unchanged:** `FloorPlan`/`BlueprintWall`/`BlueprintRoom`/`BlueprintOpening` types, `floorPlanJsonSchema`, `validateFloorPlan`, `planBounds`, `polygonCentroid`, `pointOnWall` in `blueprint-schema.ts`; `mockProvider` in `ai-provider.ts`; `session-store.ts`; the SVG renderer and DXF/SVG exporters. All of these are AI-agnostic by construction — they were already designed around the `FloorPlan` shape, not around Gemini specifically.

**New:** `src/lib/ar-capture.ts` (or equivalent), a new AR capture screen/route, `@reactvision/react-viro` as a dependency, an `expo prebuild`/EAS dev-client build step, and — only if Phase 2 is pursued — a small externally-hosted-by-you inference service plus a thin HTTP client behind a feature flag.

---

## 6. Risks & open questions

1. **Blank-wall depth confidence.** ARCore's own docs warn that low-texture surfaces (a plain painted wall is the textbook example) get near-zero raw-depth confidence ([Raw Depth, Java](https://developers.google.com/ar/develop/java/depth/raw-depth)). Mitigated by design here: the Phase 1 flow relies on the user physically tapping at corners (hit-test against tracked geometry / detected planes) rather than scanning dense per-pixel depth across a wall's surface — but this should be validated on a real plain-walled room before trusting it broadly.
2. **ViroReact API signatures for hit-testing/anchors were not confirmed at the method-signature level** in this research pass — spike this early, before committing to the full flow design in §3.
3. **No primary-source accuracy benchmark exists for phone-AR tap-to-measure applied to whole-room floor plans.** The technique is industry-precedented (consumer apps like magicplan/RoomScan use it), but I did not find a rigorous published accuracy study to cite — **UNVERIFIED**, pilot on 2–3 real rooms with known dimensions before trusting the numbers, mirroring the same mitigation the original doc recommended for the LLM path.
4. **Dev-build overhead.** The team's build/test loop changes from "scan a QR code into Expo Go" to "run a development build" — a real, ongoing cost to the workflow, not just a one-time setup step ([Expo dev builds FAQ](https://docs.expo.dev/develop/development-builds/faq/)).
5. **Phase 2 license constraints.** If the self-hosted photo-assist path is ever pursued, DUSt3R/base MASt3R/Fast3R are non-commercial-only; only MoGe (MIT) or VGGT's specific commercial checkpoint are safe defaults if the app is ever monetized.
6. **Multi-room assembly still has an edge case**: a lost/reset AR tracking session between rooms falls back to manual 2D placement (no AI) rather than an automatic assembler — acceptable, but a real UX cost compared to the (AI-driven, error-prone) automatic assembly the current Gemini `generateCombinedPlan()` attempts.

---

## Sources

- ML Kit GenAI overview — https://developers.google.com/ml-kit/genai
- ML Kit GenAI Prompt, Android — https://developers.google.com/ml-kit/genai/prompt/android
- ML Kit GenAI Prompt get-started guide — https://developers.google.com/ml-kit/genai/prompt/android/get-started
- Android Developers Blog, ML Kit GenAI Prompt API alpha release (Oct 2025) — https://android-developers.googleblog.com/2025/10/ml-kit-genai-prompt-api-alpha-release.html
- Android Developers Blog, AICore Developer Preview / Gemma 4 (Apr 2026) — https://android-developers.googleblog.com/2026/04/AI-Core-Developer-Preview.html
- react-native-ai-core — https://github.com/albertoroda/react-native-ai-core
- react-native-local-genai — https://github.com/nagaraj-real/react-native-local-genai
- On-device LLM RN integration writeup — https://mobile.wednesday.is/writing/react-native-on-device-llm-core-ml-gemini-nano-integration
- Gemma 3n overview — https://ai.google.dev/gemma/docs/gemma-3n
- LiteRT-LM — https://github.com/google-ai-edge/LiteRT-LM
- MediaPipe LLM Inference, Android — https://developers.google.com/edge/mediapipe/solutions/genai/llm_inference/android
- Moondream models — https://moondream.ai/models
- Qwen3-VL — https://github.com/QwenLM/Qwen3-VL
- Molmo2 — https://github.com/allenai/molmo2
- Florence-2-large — https://huggingface.co/microsoft/Florence-2-large
- DUSt3R — https://github.com/naver/dust3r
- MASt3R — https://github.com/naver/mast3r
- MASt3R metric checkpoint (HF) — https://huggingface.co/naver/MASt3R_ViTLarge_BaseDecoder_512_catmlpdpt_metric
- VGGT — https://github.com/facebookresearch/vggt
- MoGe (Microsoft) — https://github.com/microsoft/MoGe
- Fast3R — https://github.com/facebookresearch/fast3r
- Spann3R — https://github.com/HengyiWang/spann3r
- cozmo-ai-case-study — https://github.com/Abhinob-Bora/cozmo-ai-case-study
- Torthosplatting — https://github.com/hjh530/Torthosplatting
- ARCore Depth adds realism — https://developers.google.com/ar/develop/depth
- ARCore Raw Depth, Java — https://developers.google.com/ar/develop/java/depth/raw-depth
- ARCore Depth developer guide, Java — https://developers.google.com/ar/develop/java/depth/developer-guide
- ARCore `Plane` reference — https://developers.google.com/ar/reference/java/com/google/ar/core/Plane
- ARCore Depth Lab (googlesamples) — https://github.com/googlesamples/arcore-depth-lab
- ViroReact — https://github.com/ReactVision/viro
- ViroReact Expo TypeScript starter kit — https://github.com/ReactVision/expo-starter-kit-typescript
- Expo development builds, introduction — https://docs.expo.dev/develop/development-builds/introduction/
- Expo development builds, use — https://docs.expo.dev/develop/development-builds/use-development-builds/
- Expo development builds, FAQ — https://docs.expo.dev/develop/development-builds/faq/
