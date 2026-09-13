"""API contract tests with a faked MoGe engine (no torch, no GPU).

The fake engine returns a synthetic point map of a single vertical wall at z = 2.0
spanning x in [-1, 1], so every successful request must yield exactly one wall of
~2 m. This pins the HTTP contract the RN client parses.
"""

import base64
import io

import numpy as np
from fastapi.testclient import TestClient
from PIL import Image

import app as service_app


class FakeEngine:
    model_name = "fake/moge-2-test"

    def __init__(self, fail_on_second_call: bool = False):
        self.calls = 0
        self.fail_on_second_call = fail_on_second_call

    def infer_photo(self, jpeg_bytes: bytes):
        self.calls += 1
        if self.fail_on_second_call and self.calls == 2:
            raise RuntimeError("simulated GPU failure")
        height = width = 16
        xs = np.linspace(-1.0, 1.0, width)[None, :] * np.ones((height, 1))
        ys = np.linspace(0.0, 1.5, height)[:, None] * np.ones((1, width))
        zs = np.full((height, width), 2.0)
        points = np.stack([xs, ys, zs], axis=-1).astype(np.float32)
        mask = np.ones((height, width), dtype=bool)
        return points, None, mask


def _client(engine: FakeEngine) -> TestClient:
    service_app.get_engine = lambda: engine  # monkeypatch the seam under test
    return TestClient(service_app.app)


def _jpeg_b64(seed: int = 0, size: int = 128) -> str:
    rng = np.random.default_rng(seed)
    array = rng.integers(0, 255, (size, size, 3), dtype=np.uint8)
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, format="JPEG")
    return base64.b64encode(buffer.getvalue()).decode()


def test_health_reports_model_without_loading():
    client = _client(FakeEngine())
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["model"] == "fake/moge-2-test"


def test_suggest_walls_contract():
    engine = FakeEngine()
    client = _client(engine)
    response = client.post(
        "/v1/suggest-walls",
        json={"photos": [{"base64": _jpeg_b64(1), "mimeType": "image/jpeg"}]},
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert engine.calls == 1
    assert isinstance(body["frameNote"], str) and "camera" in body["frameNote"]
    assert len(body["photos"]) == 1
    entry = body["photos"][0]
    assert entry["index"] == 0
    walls = entry["walls"]
    assert len(walls) == 1, walls
    wall = walls[0]
    assert set(wall) == {"from", "to", "lengthM", "confidence"}
    assert abs(wall["lengthM"] - 2.0) <= 0.3, wall
    ys = [wall["from"][1], wall["to"][1]]
    assert all(abs(y - 2.0) <= 0.1 for y in ys), wall
    assert 0.0 < wall["confidence"] <= 0.9


def test_multiple_photos_get_indexed_results():
    engine = FakeEngine()
    client = _client(engine)
    response = client.post(
        "/v1/suggest-walls",
        json={
            "photos": [
                {"base64": _jpeg_b64(2)},
                {"base64": _jpeg_b64(3), "mimeType": "image/jpeg"},
            ]
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert [entry["index"] for entry in body["photos"]] == [0, 1]
    assert engine.calls == 2


def test_invalid_base64_is_client_error():
    client = _client(FakeEngine())
    response = client.post(
        "/v1/suggest-walls",
        json={"photos": [{"base64": "not-valid-base64!!"}]},
    )
    assert response.status_code == 400


def test_too_many_photos_is_validation_error():
    client = _client(FakeEngine())
    photos = [{"base64": _jpeg_b64(i)} for i in range(7)]
    response = client.post("/v1/suggest-walls", json={"photos": photos})
    assert response.status_code == 422


def test_empty_photo_list_is_validation_error():
    client = _client(FakeEngine())
    response = client.post("/v1/suggest-walls", json={"photos": []})
    assert response.status_code == 422


def test_per_photo_inference_failure_is_reported_not_fatal():
    engine = FakeEngine(fail_on_second_call=True)
    client = _client(engine)
    response = client.post(
        "/v1/suggest-walls",
        json={
            "photos": [
                {"base64": _jpeg_b64(4)},
                {"base64": _jpeg_b64(5)},
            ]
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["photos"][0]["walls"]) == 1
    assert body["photos"][1]["walls"] == []
    assert "simulated GPU failure" in body["photos"][1]["error"]
