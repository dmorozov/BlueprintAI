"""Fitting tests on synthetic box-room point clouds (CPU-only, deterministic).

The scene: a level camera at the origin looking down +z into a room 4 m wide
(x in [-2, 2]) with a far wall at z = 3.0 and side walls at x = +/-1.5 running from
z = 0.5 to z = 3.0. Wall surfaces span y in [0, 1.5] (arbitrary vertical extent —
only the floor projection matters). A horizontal floor plane is included and must NOT
produce a wall candidate.
"""

import numpy as np

from wall_fitting import suggest_walls


def _wall_points(
    rng: np.random.Generator,
    count: int,
    fixed_axis: int,
    fixed_value: float,
    axis_a_range: tuple[float, float],
    axis_b_range: tuple[float, float],
    noise: float = 0.02,
) -> np.ndarray:
    """Random points on a plane with one coordinate fixed (axis 0=x, 1=y, 2=z)."""
    pts = rng.uniform(0.0, 1.0, size=(count, 3))
    span_a = axis_a_range[1] - axis_a_range[0]
    span_b = axis_b_range[1] - axis_b_range[0]
    # Assign the two varying coordinates to the other two axes.
    others = [i for i in range(3) if i != fixed_axis]
    pts[:, others[0]] = axis_a_range[0] + span_a * pts[:, others[0]]
    pts[:, others[1]] = axis_b_range[0] + span_b * pts[:, others[1]]
    pts[:, fixed_axis] = fixed_value
    return pts + rng.normal(0.0, noise, size=pts.shape)


def _box_room_cloud(rng: np.random.Generator) -> np.ndarray:
    parts = [
        # Far wall: z fixed at 3.0, x spans the room width, y is height.
        _wall_points(rng, 8000, fixed_axis=2, fixed_value=3.0,
                     axis_a_range=(-2.0, 2.0), axis_b_range=(0.0, 1.5)),
        # Left wall: x fixed at -1.5, z from 0.5 to 3.0.
        _wall_points(rng, 6000, fixed_axis=0, fixed_value=-1.5,
                     axis_a_range=(0.5, 3.0), axis_b_range=(0.0, 1.5)),
        # Right wall: x fixed at +1.5.
        _wall_points(rng, 6000, fixed_axis=0, fixed_value=1.5,
                     axis_a_range=(0.5, 3.0), axis_b_range=(0.0, 1.5)),
        # Floor: horizontal plane (normal ~ y) — must be rejected as a wall.
        _wall_points(rng, 6000, fixed_axis=1, fixed_value=1.5,
                     axis_a_range=(-1.5, 1.5), axis_b_range=(0.5, 3.0)),
    ]
    return np.vstack(parts)


def _point_segment_distance(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> float:
    """Distance from point p to segment ab (2D)."""
    ab = b - a
    length_sq = float(ab @ ab)
    if length_sq == 0:
        return float(np.linalg.norm(p - a))
    t = float(np.clip((p - a) @ ab / length_sq, 0.0, 1.0))
    return float(np.linalg.norm(p - (a + t * ab)))


def _match(walls: list[dict], expected_from: tuple, expected_to: tuple, tol: float):
    """Find a detected wall whose both endpoints lie near the expected segment."""
    a = np.array(expected_from, dtype=float)
    b = np.array(expected_to, dtype=float)
    for wall in walls:
        p1 = np.array(wall["from"], dtype=float)
        p2 = np.array(wall["to"], dtype=float)
        if (
            _point_segment_distance(p1, a, b) <= tol
            and _point_segment_distance(p2, a, b) <= tol
        ):
            return wall
    return None


def test_box_room_finds_all_three_walls():
    rng = np.random.default_rng(7)
    walls = suggest_walls(_box_room_cloud(rng))

    assert len(walls) >= 3, f"expected >= 3 walls, got {len(walls)}: {walls}"

    far = _match(walls, (-2.0, 3.0), (2.0, 3.0), tol=0.25)
    assert far is not None, f"far wall (z=3.0) not found: {walls}"
    assert abs(far["lengthM"] - 4.0) <= 0.8, far

    left = _match(walls, (-1.5, 0.5), (-1.5, 3.0), tol=0.25)
    assert left is not None, f"left wall (x=-1.5) not found: {walls}"
    assert abs(left["lengthM"] - 2.5) <= 0.6, left

    right = _match(walls, (1.5, 0.5), (1.5, 3.0), tol=0.25)
    assert right is not None, f"right wall (x=+1.5) not found: {walls}"
    assert abs(right["lengthM"] - 2.5) <= 0.6, right


def test_single_wall_position_and_length():
    rng = np.random.default_rng(11)
    cloud = _wall_points(rng, 9000, fixed_axis=2, fixed_value=2.4,
                         axis_a_range=(-1.0, 1.8), axis_b_range=(0.0, 2.0))
    walls = suggest_walls(cloud)

    assert len(walls) == 1, walls
    wall = walls[0]
    # Line should sit at y (plan) ~= 2.4 with x extent [-1.0, 1.8].
    assert abs(np.mean([wall["from"][1], wall["to"][1]]) - 2.4) <= 0.15, wall
    xs = sorted([wall["from"][0], wall["to"][0]])
    assert abs(xs[0] - (-1.0)) <= 0.3 and abs(xs[1] - 1.8) <= 0.3, wall
    assert abs(wall["lengthM"] - 2.8) <= 0.5, wall
    assert 0.0 < wall["confidence"] <= 0.9


def test_horizontal_plane_alone_yields_no_walls():
    rng = np.random.default_rng(21)
    floor = _wall_points(rng, 8000, fixed_axis=1, fixed_value=1.5,
                         axis_a_range=(-2.0, 2.0), axis_b_range=(0.5, 3.0))
    assert suggest_walls(floor) == []


def test_empty_and_tiny_clouds_yield_no_walls():
    assert suggest_walls(np.empty((0, 3))) == []
    rng = np.random.default_rng(31)
    tiny = _wall_points(rng, 40, fixed_axis=2, fixed_value=2.0,
                        axis_a_range=(-1.0, 1.0), axis_b_range=(0.0, 1.5))
    assert suggest_walls(tiny) == []


def test_out_of_range_depth_is_ignored():
    rng = np.random.default_rng(41)
    # A real wall at z=2.0 plus a "wall" far beyond the indoor range (z=40).
    near = _wall_points(rng, 8000, fixed_axis=2, fixed_value=2.0,
                        axis_a_range=(-1.5, 1.5), axis_b_range=(0.0, 1.5))
    far_away = _wall_points(rng, 4000, fixed_axis=2, fixed_value=40.0,
                            axis_a_range=(-5.0, 5.0), axis_b_range=(0.0, 3.0))
    walls = suggest_walls(np.vstack([near, far_away]))
    assert len(walls) == 1, walls
    ys = [wall["from"][1] for wall in walls] + [wall["to"][1] for wall in walls]
    assert all(abs(y - 2.0) <= 0.3 for y in ys), walls


def test_result_is_deterministic():
    rng = np.random.default_rng(51)
    cloud = _box_room_cloud(rng)
    assert suggest_walls(cloud) == suggest_walls(cloud)


def test_accepts_hwc_shape_with_mask():
    """The engine passes (H, W, 3) point maps plus a validity mask."""
    rng = np.random.default_rng(61)
    height, width = 48, 64
    xs = np.linspace(-1.5, 1.5, width)[None, :] * np.ones((height, 1))
    zs = np.full((height, width), 2.2) + rng.normal(0, 0.01, (height, width))
    ys = np.linspace(0.0, 1.5, height)[:, None] * np.ones((1, width))
    points = np.stack([xs, ys, zs], axis=-1)
    mask = np.ones((height, width), dtype=bool)
    mask[:4, :] = False  # top rows invalid (e.g. sky/ceiling artifacts)

    walls = suggest_walls(points, mask=mask)
    assert len(walls) == 1, walls
    assert abs(walls[0]["lengthM"] - 3.0) <= 0.5, walls
