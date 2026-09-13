"""MoGe-2 inference engine for the photo-assist service (lazy-loaded).

Wraps MoGe-2 (MIT, microsoft/MoGe) so the rest of the service — and its tests — never
import torch. The model loads on first inference; weights download from the Hugging
Face hub into HF_HOME (default ~/.cache/huggingface) on first run.

Why MoGe-2 (not -3): it is the version named by the plan, outputs metric point maps
*and* normal maps in one forward pass, and its dependency set predates MoGe-3's
FlexGEMM/Triton build requirements. The checkpoint is configurable via env so a
MoGe-3 model can be swapped in later without code changes (see README).

Only ``moge.model.v2`` is used; the package is installed with --no-deps and its real
runtime dependencies are declared explicitly in requirements.txt (see README).
"""

from __future__ import annotations

import io
import os
from typing import Any

import numpy as np

#: Default checkpoint: MoGe-2 ViT-L with metric scale AND normal maps.
DEFAULT_MODEL = "Ruicheng/moge-2-vitl-normal"


class MogeEngine:
    """Loads MoGe-2 once and infers a metric point map per photo."""

    def __init__(self, model_name: str | None = None, device: str | None = None):
        self.model_name = (
            model_name or os.environ.get("PHOTO_ASSIST_MODEL") or DEFAULT_MODEL
        )
        if device:
            self.device = device
        else:
            env_device = os.environ.get("PHOTO_ASSIST_DEVICE", "").strip()
            if env_device:
                self.device = env_device
            else:
                import torch  # local import: torch is a heavy, optional-at-import dep

                self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self._model: Any | None = None

    def _load(self) -> Any:
        if self._model is None:
            import torch  # noqa: F401  (ensures torch is imported before the model)
            from moge.model.v2 import MoGeModel

            self._model = MoGeModel.from_pretrained(self.model_name).to(self.device)
            self._model.eval()
        return self._model

    def infer_photo(self, jpeg_bytes: bytes) -> tuple[np.ndarray, np.ndarray | None, np.ndarray]:
        """Run MoGe-2 on one JPEG.

        Returns:
            points: (H, W, 3) metric point map in OpenCV camera coordinates
                (x right, y down, z forward), meters.
            normals: (H, W, 3) normal map in the same frame, or None when the
                checkpoint does not provide one.
            mask: (H, W) boolean validity mask.
        """
        import torch
        from PIL import Image

        model = self._load()
        image = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
        height, width = image.size[1], image.size[0]
        tensor = (
            torch.tensor(
                np.asarray(image, dtype=np.float32) / 255.0, device=self.device
            )
            .permute(2, 0, 1)
            .unsqueeze(0)
        )

        # FP16 is a GPU speedup; on CPU it is unsupported by many ops.
        with torch.no_grad():
            output = model.infer(tensor, use_fp16=self.device != "cpu")

        points = np.asarray(output["points"], dtype=np.float32).reshape(height, width, 3)
        mask = (
            np.asarray(output["mask"], dtype=bool).reshape(height, width)
            if "mask" in output
            else np.ones((height, width), dtype=bool)
        )
        normals = (
            np.asarray(output["normal"], dtype=np.float32).reshape(height, width, 3)
            if "normal" in output
            else None
        )
        return points, normals, mask


_engine: MogeEngine | None = None


def get_engine() -> MogeEngine:
    """Process-wide engine singleton (created lazily; no model load until inference)."""
    global _engine
    if _engine is None:
        _engine = MogeEngine()
    return _engine
