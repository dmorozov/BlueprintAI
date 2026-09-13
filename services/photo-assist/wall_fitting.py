"""Candidate wall extraction from a metric point map (pure numpy, no torch).

Part of the BlueprintAI photo-assist service (no-external-API plan, Phase 2).
MoGe-2 produces a *metric* point map in OpenCV camera coordinates (x right, y down,
z forward) for each photo. This module turns that cloud into candidate wall segments:

1. Filter to plausible indoor depth and down-sample to a bounded point count.
2. RANSAC-fit vertical planes (plane normal nearly horizontal => surface is a wall).
3. For each plane, drop it if its inliers span less than MIN_VERTICAL_SPAN_M
   vertically (rejects floor/ceiling artifacts), then floor-project the inliers
   (drop the vertical component) and fit a straight line by total least squares;
   clip the segment to the inlier extent.

Coordinate convention of the output (per photo): origin at the camera position,
x right, y forward into the scene (the camera's z), meters — i.e. a top-down view of
what the photo shows, matching the FloorPlan schema's x-right / y-down convention.

Assumptions (documented in the service README and surfaced to the user):
- The phone is held roughly LEVEL when shooting (camera y-axis ~ world down). A
  tilted camera rotates the apparent wall lines; the "auto-detected — verify"
  confidence cap on the client side is the safety net for that.
- Each photo is processed independently: there is NO cross-view registration, so two
  photos of the same room yield two unrelated frames (the app aligns them manually).

Deterministic by construction (fixed RNG seed) so tests are stable.
"""

from __future__ import annotations

import numpy as np

# --- tuning -------------------------------------------------------------------

#: Ignore points closer/farther than this (indoor scale, meters).
DEPTH_MIN_M = 0.3
DEPTH_MAX_M = 15.0
#: A plane counts as "vertical" when its normal's y-component is below this.
#: 0.35 ~ normals tilted up to ~20 degrees off horizontal (walls + slight camera tilt).
VERTICAL_NORMAL_TOL = 0.35
#: Inlier distance to the candidate plane (meters).
PLANE_DIST_TOL_M = 0.05
#: Walls shorter/longer than this are dropped as noise or as non-walls.
MIN_WALL_LENGTH_M = 0.8
MAX_WALL_LENGTH_M = 20.0
#: Inliers must span at least this much vertically; horizontal surfaces (floor/
#: ceiling) can produce spurious near-vertical RANSAC planes from noise, but their
#: inlier sets are thin slabs with little vertical extent. Real walls span more.
MIN_VERTICAL_SPAN_M = 0.3
#: How many distinct planes to look for per photo (a corner view sees ~3).
MAX_PLANES = 6
#: RANSAC iterations per plane.
RANSAC_ITERS = 400
#: Minimum inlier support, as a fraction of the (down-sampled) cloud and absolute.
MIN_INLIERS_FRACTION = 0.01
MIN_INLIERS_ABS = 50
#: RANSAC candidate pool cap (keeps per-photo CPU cost bounded).
MAX_POINTS = 20_000
#: Two nearly-parallel, nearly-coincident wall lines are duplicates.
DEDUP_ANGLE_TOL_RAD = 0.17  # ~10 degrees
DEDUP_DIST_TOL_M = 0.3
#: Fixed seed => deterministic results for the same input (testable).
DEFAULT_SEED = 1337

Wall = dict  # {"from": [x, y], "to": [x, y], "lengthM": float, "confidence": float}


def _plane_normal(p0: np.ndarray, p1: np.ndarray, p2: np.ndarray) -> np.ndarray | None:
    """Unit normal of the plane through three points, or None when degenerate."""
    normal = np.cross(p1 - p0, p2 - p0)
    length = float(np.linalg.norm(normal))
    if length < 1e-9:
        return None
    return normal / length


def fit_vertical_planes(
    points: np.ndarray, seed: int = DEFAULT_SEED
) -> list[dict]:
    """RANSAC-fit up to MAX_PLANES vertical planes in a (N, 3) camera-frame cloud.

    Returns a list of dicts with keys ``normal`` (unit), ``point`` (on the plane) and
    ``inlier_mask`` (boolean over the *input* array). Planes are returned best-first.
    """
    points = np.asarray(points, dtype=np.float64)
    if len(points) < 3:
        return []

    rng = np.random.default_rng(seed)
    remaining = points.copy()
    # Indices of `remaining` rows into the ORIGINAL array — inlier masks must be
    # reported over the original array, which shrinks as planes are consumed.
    indices = np.arange(len(points))
    total = len(points)
    planes: list[dict] = []

    for _ in range(MAX_PLANES):
        if len(remaining) < max(MIN_INLIERS_ABS, 3):
            break
        min_inliers = max(MIN_INLIERS_ABS, int(MIN_INLIERS_FRACTION * total))
        best: dict | None = None

        for _ in range(RANSAC_ITERS):
            i, j, k = rng.choice(len(remaining), size=3, replace=False)
            normal = _plane_normal(remaining[i], remaining[j], remaining[k])
            if normal is None or abs(normal[1]) > VERTICAL_NORMAL_TOL:
                continue  # not a vertical surface
            distances = np.abs(np.dot(remaining - remaining[i], normal))
            inlier_mask = distances <= PLANE_DIST_TOL_M
            count = int(inlier_mask.sum())
            if count >= min_inliers and (best is None or count > best["count"]):
                full_mask = np.zeros(total, dtype=bool)
                full_mask[indices[inlier_mask]] = True
                best = {
                    "normal": normal,
                    "point": remaining[i].copy(),
                    "inlier_mask": full_mask,
                    "count": count,
                }

        if best is None:
            break
        planes.append(best)
        # Remove this plane's inliers so the next iteration can find another wall.
        local_mask = best["inlier_mask"][indices]  # map full-size mask back to `remaining`
        remaining = remaining[~local_mask]
        indices = indices[~local_mask]

    return planes


def _tls_line_2d(pts: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Total-least-squares line fit of (M, 2) points.

    Returns (a point on the line, a unit direction vector).
    """
    center = pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts - center, full_matrices=False)
    return center, vt[0]


def _wall_from_plane(
    plane: dict, points: np.ndarray, total_points: int
) -> Wall | None:
    """Floor-project a fitted plane's inliers into one wall segment (or None)."""
    inlier_pts = points[plane["inlier_mask"]]
    if len(inlier_pts) < 10:
        return None
    # Reject horizontal-surface artifacts: their inliers are a thin slab with little
    # vertical (y) extent, while a visible wall spans well over MIN_VERTICAL_SPAN_M.
    if float(np.ptp(inlier_pts[:, 1])) < MIN_VERTICAL_SPAN_M:
        return None

    # Floor projection: drop the vertical (y) component -> (x, z) top-down view.
    projected = inlier_pts[:, [0, 2]]
    center, direction = _tls_line_2d(projected)
    along = (projected - center) @ direction
    start = center + along.min() * direction
    end = center + along.max() * direction
    length_m = float(np.hypot(end[0] - start[0], end[1] - start[1]))
    if not (MIN_WALL_LENGTH_M <= length_m <= MAX_WALL_LENGTH_M):
        return None

    # Confidence: how much of the whole cloud this plane accounts for. A wall that
    # fills ~25%+ of the view gets the top score; the client caps it further.
    support = plane["count"] / max(total_points, 1)
    confidence = float(np.clip(support / 0.25, 0.1, 0.9))

    return {
        "from": [round(float(start[0]), 3), round(float(start[1]), 3)],
        "to": [round(float(end[0]), 3), round(float(end[1]), 3)],
        "lengthM": round(length_m, 3),
        "confidence": round(confidence, 3),
    }


def _is_duplicate(candidate: Wall, existing: list[Wall]) -> bool:
    """True when the candidate is nearly coincident with an already-kept wall."""
    cand_dir = np.array(
        [candidate["to"][0] - candidate["from"][0], candidate["to"][1] - candidate["from"][1]]
    )
    cand_len = float(np.linalg.norm(cand_dir))
    if cand_len < 1e-9:
        return True
    cand_dir /= cand_len
    cand_mid = np.array(
        [
            (candidate["from"][0] + candidate["to"][0]) / 2,
            (candidate["from"][1] + candidate["to"][1]) / 2,
        ]
    )

    for wall in existing:
        other_dir = np.array(
            [wall["to"][0] - wall["from"][0], wall["to"][1] - wall["from"][1]]
        )
        other_len = float(np.linalg.norm(other_dir))
        if other_len < 1e-9:
            continue
        other_dir /= other_len
        # Parallel when the angle between directions is small (either orientation).
        if abs(abs(float(cand_dir @ other_dir)) - 1.0) > np.cos(DEDUP_ANGLE_TOL_RAD):
            continue
        # Distance from the candidate's midpoint to the existing wall's line.
        origin = np.array([wall["from"][0], wall["from"][1]])
        t = float(np.clip((cand_mid - origin) @ other_dir, 0.0, other_len))
        closest = origin + t * other_dir
        if float(np.linalg.norm(cand_mid - closest)) < DEDUP_DIST_TOL_M:
            return True
    return False


def suggest_walls(
    points: np.ndarray,
    mask: np.ndarray | None = None,
    seed: int = DEFAULT_SEED,
) -> list[Wall]:
    """Extract candidate wall segments from a metric point map.

    Args:
        points: (H, W, 3) or (N, 3) metric point map in camera coordinates
            (x right, y down, z forward), meters.
        mask: optional (H, W) boolean/numeric validity mask (same first two dims).
        seed: RNG seed for RANSAC (deterministic output for the same input).

    Returns:
        A list of wall dicts ``{"from": [x, y], "to": [x, y], "lengthM", "confidence"}``
        in the per-photo frame (origin at camera, x right, y forward), best-first.
    """
    flat = np.asarray(points, dtype=np.float64).reshape(-1, 3)
    if mask is not None:
        flat = flat[np.asarray(mask).reshape(-1).astype(bool)]

    finite = np.isfinite(flat).all(axis=1)
    depth_ok = (flat[:, 2] >= DEPTH_MIN_M) & (flat[:, 2] <= DEPTH_MAX_M)
    pts = flat[finite & depth_ok]
    if len(pts) < MIN_INLIERS_ABS * 2:
        return []

    stride = max(1, len(pts) // MAX_POINTS)
    pts = pts[::stride]

    walls: list[Wall] = []
    for plane in fit_vertical_planes(pts, seed=seed):
        wall = _wall_from_plane(plane, pts, total_points=len(pts))
        if wall is None or _is_duplicate(wall, walls):
            continue
        walls.append(wall)
    return walls
