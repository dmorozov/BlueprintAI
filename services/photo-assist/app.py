"""BlueprintAI photo-assist service (no-external-API plan, Phase 2).

A small FastAPI app that runs MoGe-2 (MIT) on YOUR OWN GPU. It accepts a handful of
room photos and returns candidate wall segments in meters — no third-party API is
ever called; the only network traffic is between the app and this service (plus the
one-time model download from the Hugging Face hub).

Endpoints:
    GET  /health             liveness + configured model name (no model load)
    POST /v1/suggest-walls   {photos: [{base64, mimeType}]} -> per-photo wall candidates

Response frame (per photo): origin at the camera position, x right, y forward into
the scene (meters), floor projection — a top-down view of what the photo shows.
Each photo is independent (no cross-view registration); the app aligns frames
manually. See README.md for assumptions and deployment.

Run:  uvicorn app:app --host 0.0.0.0 --port 8734
"""

from __future__ import annotations

import base64

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from moge_engine import get_engine
from wall_fitting import suggest_walls

MAX_PHOTOS = 6
MIN_PAYLOAD_BYTES = 1024  # smaller than this is not a usable photo

FRAME_NOTE = (
    "Per-photo frame: origin at the camera position, x right, y forward into the "
    "scene (meters), floor projection. Assumes a level camera; each photo is "
    "independent (no cross-view alignment). Walls are auto-detected - verify them."
)

app = FastAPI(
    title="BlueprintAI photo assist",
    version="1.0.0",
    description="Self-hosted MoGe-2 wall suggestion. No external APIs.",
)

# The app talks to this service over plain HTTP on the user's own network; keep CORS
# open for development and document it in the README (bind to your LAN/VPC, not the
# public internet, or put it behind a reverse proxy with auth).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class PhotoPayload(BaseModel):
    base64: str
    mimeType: str = "image/jpeg"


class SuggestRequest(BaseModel):
    photos: list[PhotoPayload] = Field(min_length=1, max_length=MAX_PHOTOS)


@app.get("/health")
def health() -> dict:
    # Intentionally does NOT load the model (that happens on first inference).
    return {"status": "ok", "model": get_engine().model_name}


@app.post("/v1/suggest-walls")
def suggest_walls_endpoint(request: SuggestRequest) -> dict:
    engine = get_engine()
    results: list[dict] = []

    for index, payload in enumerate(request.photos):
        try:
            raw = base64.b64decode(payload.base64, validate=True)
        except Exception:
            raise HTTPException(
                status_code=400, detail=f"Photo {index}: invalid base64."
            )
        if len(raw) < MIN_PAYLOAD_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"Photo {index}: payload too small to be an image.",
            )

        try:
            points, _normals, mask = engine.infer_photo(raw)
        except Exception as exc:  # inference failure is per-photo, not fatal
            results.append({"index": index, "walls": [], "error": str(exc)})
            continue

        walls = suggest_walls(points, mask=mask)
        results.append({"index": index, "walls": walls})

    return {"photos": results, "frameNote": FRAME_NOTE}
