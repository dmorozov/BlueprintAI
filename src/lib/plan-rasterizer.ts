import type { FloorPlan, Point } from '@/lib/blueprint-schema';

/**
 * Rasterizes a floor plan into an RGBA pixel buffer for on-device image export
 * (gallery save). Pure TypeScript with no runtime imports — the same code runs in
 * Hermes and under Node. Text labels are intentionally omitted (the SVG export keeps
 * them); geometry only: room fills, walls, door/window markers.
 */

export interface RasterOptions {
  /** Pixels per meter. Default 120 — a 10 m room is ~1200 px wide. */
  pixelsPerMeter?: number;
}

export interface RasterResult {
  width: number;
  height: number;
  rgba: Uint8Array;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const PADDING_M = 0.5;
const WALL_WIDTH_M = 0.09;

const COLORS = {
  background: [255, 255, 255],
  roomFill: [214, 232, 250],
  wall: [43, 48, 56],
  door: [32, 138, 239],
  window: [127, 179, 232],
} as const;

function computeBounds(plan: FloorPlan): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const absorb = (point: Point) => {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  };
  for (const wall of plan.walls) {
    absorb(wall.from);
    absorb(wall.to);
  }
  for (const room of plan.rooms) {
    for (const point of room.polygon) absorb(point);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxY)) return null;
  return { minX, minY, maxX, maxY };
}

/** Even-odd ray-cast point-in-polygon test. */
function pointInPolygon(point: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    // Loop bounds guarantee both vertices are in range.
    const xi = polygon[i]![0];
    const yi = polygon[i]![1];
    const xj = polygon[j]![0];
    const yj = polygon[j]![1];
    const intersects =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Squared distance from a point to a line segment. */
function distSqToSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const abx = bx - ax;
  const aby = by - ay;
  const t =
    abx !== 0 || aby !== 0
      ? Math.max(
          0,
          Math.min(
            1,
            ((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby),
          ),
        )
      : 0;
  const dx = px - (ax + t * abx);
  const dy = py - (ay + t * aby);
  return dx * dx + dy * dy;
}

export function rasterizePlan(
  plan: FloorPlan,
  options?: RasterOptions,
): RasterResult {
  const scale = options?.pixelsPerMeter ?? 120;
  const bounds = computeBounds(plan);
  if (bounds === null) {
    // No geometry — a small placeholder canvas so export never crashes.
    return { width: 1, height: 1, rgba: new Uint8Array(4) };
  }

  const width = Math.max(
    1,
    Math.round((bounds.maxX - bounds.minX + PADDING_M * 2) * scale),
  );
  const height = Math.max(
    1,
    Math.round((bounds.maxY - bounds.minY + PADDING_M * 2) * scale),
  );
  const rgba = new Uint8Array(width * height * 4);

  // Precompute wall segments and opening marker frames in world (meter) space.
  const walls = plan.walls.map((wall) => ({
    ax: wall.from[0],
    ay: wall.from[1],
    bx: wall.to[0],
    by: wall.to[1],
  }));

  const openings = plan.openings.flatMap((opening) => {
    const wall = plan.walls.find((w) => w.id === opening.wallId);
    if (wall === undefined) return [];
    const t = opening.positionT ?? 0.5;
    const cx = wall.from[0] + (wall.to[0] - wall.from[0]) * t;
    const cy = wall.from[1] + (wall.to[1] - wall.from[1]) * t;
    const dx = wall.to[0] - wall.from[0];
    const dy = wall.to[1] - wall.from[1];
    const length = Math.hypot(dx, dy) || 1;
    // Unit along-wall and normal vectors for the marker's local frame.
    return [
      {
        cx,
        cy,
        ux: dx / length,
        uy: dy / length,
        nx: -dy / length,
        ny: dx / length,
        halfW: (opening.widthM ?? (opening.type === 'door' ? 0.9 : 1.2)) / 2,
        halfH: WALL_WIDTH_M * 1.4,
        color: opening.type === 'door' ? COLORS.door : COLORS.window,
      },
    ];
  });

  const rooms = plan.rooms.map((room) => room.polygon);
  const wallHalfSq = (WALL_WIDTH_M / 2) ** 2;

  for (let py = 0; py < height; py++) {
    const wy = bounds.minY - PADDING_M + (py + 0.5) / scale;
    for (let px = 0; px < width; px++) {
      const wx = bounds.minX - PADDING_M + (px + 0.5) / scale;

      let color: readonly [number, number, number] | null = null;

      // Openings draw on top of walls.
      for (const opening of openings) {
        const u =
          (wx - opening.cx) * opening.ux + (wy - opening.cy) * opening.uy;
        const v =
          (wx - opening.cx) * opening.nx + (wy - opening.cy) * opening.ny;
        if (Math.abs(u) <= opening.halfW && Math.abs(v) <= opening.halfH) {
          color = opening.color;
          break;
        }
      }

      // Walls.
      if (color === null) {
        for (const wall of walls) {
          if (
            distSqToSegment(wx, wy, wall.ax, wall.ay, wall.bx, wall.by) <=
            wallHalfSq
          ) {
            color = COLORS.wall;
            break;
          }
        }
      }

      // Room fills (first containing polygon wins).
      if (color === null) {
        for (const polygon of rooms) {
          if (pointInPolygon([wx, wy], polygon)) {
            color = COLORS.roomFill;
            break;
          }
        }
      }

      const [r, g, b] = color ?? COLORS.background;
      const index = (py * width + px) * 4;
      rgba[index] = r;
      rgba[index + 1] = g;
      rgba[index + 2] = b;
      rgba[index + 3] = 255;
    }
  }

  return { width, height, rgba };
}
