# Photo Assist Service (self-hosted, Phase 2)

The photo-based assist from `docs/research/floorplan-no-external-api-plan.md` §4: a
small service that runs **MoGe-2** (MIT, [microsoft/MoGe](https://github.com/microsoft/MoGe))
on **your own GPU**, accepts a handful of room photos, and returns candidate wall
segments in meters. No third-party API is ever called — the only network traffic is
between the BlueprintAI app and this service (plus a one-time model download from the
Hugging Face hub on first run).

This is genuinely new infrastructure: it replaces "pay Google per call" with "run your
own compute". The app feature is **off unless configured** (see _Client setup_ below).

## What it does, and what it assumes

Per uploaded photo:

1. MoGe-2 predicts a **metric point map** in OpenCV camera coordinates (x right, y down,
   z forward) — real meter scale, not an up-to-scale guess.
2. `wall_fitting.py` RANSAC-fits **vertical planes** (plane normal nearly horizontal),
   floor-projects each plane's inliers, and fits a straight line by total least squares.
3. Each plane becomes one candidate wall: `from`/`to` endpoints (meters), `lengthM`,
   and a support-based `confidence`.

Output frame per photo: **origin at the camera position, x right, y forward into the
scene** — a top-down view of what the photo shows. Known v1 assumptions:

- **Level camera.** The phone should be held roughly level (camera y-axis ≈ world down)
  when shooting; the app tells the user this. A tilted camera rotates apparent wall
  lines. The client caps every suggested wall at `confidence ≤ 0.5` and labels the plan
  "auto-detected — verify" as the safety net.
- **No cross-view registration.** Each photo is processed independently; two photos of
  the same room are two unrelated frames. The app lets you pick one photo's suggestion
  per room; rooms from different sources combine via the existing align editor.
  (Multi-view fusion would need SfM/pose estimation — deliberately out of scope for v1.)
- **Wall extent = visible span.** A partially occluded wall is proposed as long as its
  visible inlier span, not its true length. That's what "verify" means: confirm or
  re-shoot before trusting the number.

## API

`POST /v1/suggest-walls`

```jsonc
// request (max 6 photos)
{ "photos": [ { "base64": "<JPEG, no data: prefix>", "mimeType": "image/jpeg" } ] }

// response
{
  "photos": [
    { "index": 0,
      "walls": [
        { "from": [x1, y1], "to": [x2, y2], "lengthM": 3.98, "confidence": 0.72 }
      ] },
    { "index": 1, "walls": [], "error": "inference failed (...)" }  // per-photo failures
  ],
  "frameNote": "Per-photo frame: origin at the camera position, x right, y forward ..."
}
```

- `400` — invalid base64 / payload too small (client error).
- Per-photo inference failures come back as `"error"` entries; other photos still get results.
- `GET /health` → `{ "status": "ok", "model": "<checkpoint>" }` (does not load the model).

## Running it

### Docker (recommended)

```bash
cd services/photo-assist
docker build -t blueprintai-photo-assist .
docker run --gpus all -p 8734:8734 -v hf-cache:/models blueprintai-photo-assist
```

First inference downloads `Ruicheng/moge-2-vitl-normal` (~1.3 GB) into `/models`.

### Bare metal (Python 3.10–3.12, CUDA 12.x driver)

```bash
cd services/photo-assist
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pip install --no-deps git+https://github.com/microsoft/MoGe.git@b942f00bdc2a
uvicorn app:app --host 0.0.0.0 --port 8734
```

MoGe is installed with `--no-deps` on purpose: its pyproject pulls demo-only extras
(gradio, matplotlib, trimesh) and, at newer commits, FlexGEMM/Triton builds that are
not needed for the `moge.model.v2` path. Its real runtime dependencies are declared in
`requirements.txt`.

### Configuration (env)

| Variable              | Default                       | Meaning                                           |
| --------------------- | ----------------------------- | ------------------------------------------------- |
| `PHOTO_ASSIST_MODEL`  | `Ruicheng/moge-2-vitl-normal` | Hugging Face checkpoint (metric scale + normals). |
| `PHOTO_ASSIST_DEVICE` | auto (`cuda` if available)    | Force `cuda` or `cpu`.                            |

CPU inference works but is slow (tens of seconds per photo); a modern GPU does
~0.1–1 s per image at 2K.

## Client setup (BlueprintAI app)

The app feature is behind an env flag — with it unset, no UI entry point exists and no
request can be made:

```bash
# .env (or your Expo build config) — the LAN address of this service
EXPO_PUBLIC_PHOTO_ASSIST_URL=http://192.168.1.42:8734
```

Rebuild/restart the app after changing it (`EXPO_PUBLIC_*` values are inlined at build
time). The home screen then shows **Photo assist (self-hosted)**; the flow is:
photos → upload → tap-to-confirm review (per-wall delete) → save. Saved plans carry
`confidence ≤ 0.5`, a "auto-detected — verify" note, and their own frame id, so they
combine with AR-measured rooms through the align editor — never by auto-merge.

## Tests (CPU-only)

The fitting logic and API contract are tested without torch or a GPU:

```bash
python3 -m venv .venv-test && source .venv-test/bin/activate
pip install numpy pillow fastapi httpx pytest
python -m pytest tests/ -q
```

(`tests/test_wall_fitting.py` builds synthetic box-room point clouds and checks the
detected wall lines/lengths; `tests/test_app.py` fakes the engine and exercises the
HTTP contract.)

## License notes

- MoGe is **MIT** (verified against the repo's LICENSE) — safe for commercial use.
- Per the plan §2.2, DUSt3R / base MASt3R / Fast3R are non-commercial-only and are NOT
  used here; cozmo-ai-case-study has no LICENSE file and is not depended on.
- This service's own code (`app.py`, `moge_engine.py`, `wall_fitting.py`) is part of
  the BlueprintAI repository license.
