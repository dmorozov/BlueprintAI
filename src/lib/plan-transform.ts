import {
  planBounds,
  validateFloorPlan,
  type FloorPlan,
  type Point,
} from '@/lib/blueprint-schema';

/**
 * Manual placement of a floor plan in the combined (multi-room) coordinate frame.
 *
 * Rooms measured in separate AR sessions live in unrelated tracking frames, so they
 * cannot be merged by plain union (see mergeSameFramePlans in ar-capture.ts). Instead
 * the user nudges one room into place relative to the others — drag to translate,
 * rotate around its own centroid. The placement is pure geometry: a centroid position
 * plus a rotation angle. No AI and no network are involved at any point.
 *
 * Pure TypeScript with no runtime imports beyond the schema: runs in Hermes and under
 * Node for testing.
 */

/** A room's manual placement in the combined frame (meters, radians). */
export interface RoomPlacement {
  /** Where the plan's centroid sits in the combined frame. */
  x: number;
  y: number;
  /** Rotation around the centroid, in radians. */
  rotationRad: number;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Centroid of all geometry in a plan (wall endpoints + room polygon points), or null
 * when the plan has no geometry.
 */
export function planCentroid(plan: FloorPlan): [number, number] | null {
  let x = 0;
  let y = 0;
  let count = 0;

  const absorb = (point: Point) => {
    x += point[0];
    y += point[1];
    count += 1;
  };

  for (const wall of plan.walls) {
    absorb(wall.from);
    absorb(wall.to);
  }
  for (const room of plan.rooms) {
    for (const point of room.polygon) absorb(point);
  }

  if (count === 0) return null;
  return [x / count, y / count];
}

/** The no-op placement: the plan's own centroid, zero rotation. */
export function identityPlacement(plan: FloorPlan): RoomPlacement {
  const centroid = planCentroid(plan);
  return { x: centroid?.[0] ?? 0, y: centroid?.[1] ?? 0, rotationRad: 0 };
}

/**
 * Returns a new plan with the placement applied: every point is rotated around the
 * plan's original centroid by `rotationRad`, then the centroid is moved to (x, y).
 * Distances are preserved, so wall lengths, opening widths, and confidence values are
 * carried over unchanged.
 */
export function applyPlacement(
  plan: FloorPlan,
  placement: RoomPlacement,
): FloorPlan {
  const centroid = planCentroid(plan);
  if (centroid === null) return validateFloorPlan({ ...plan });

  const cos = Math.cos(placement.rotationRad);
  const sin = Math.sin(placement.rotationRad);

  const transform = ([px, py]: Point): [number, number] => {
    const dx = px - centroid[0];
    const dy = py - centroid[1];
    return [
      round2(dx * cos - dy * sin + placement.x),
      round2(dx * sin + dy * cos + placement.y),
    ];
  };

  return validateFloorPlan({
    unit: 'meters',
    walls: plan.walls.map((wall) => ({
      ...wall,
      from: transform(wall.from),
      to: transform(wall.to),
    })),
    rooms: plan.rooms.map((room) => ({
      ...room,
      polygon: room.polygon.map(transform),
    })),
    // Openings carry no coordinates (only wallId + positionT), so they are invariant.
    openings: plan.openings.map((opening) => ({ ...opening })),
  });
}

/**
 * Merges plans that each live in their own frame into one combined plan, positioning
 * every part by its placement. Parts are re-prefixed so element ids never collide,
 * and the result passes the same schema validation as any other plan.
 */
export function mergePlacedPlans(
  parts: { plan: FloorPlan; placement: RoomPlacement }[],
): FloorPlan {
  const walls: FloorPlan['walls'] = [];
  const rooms: FloorPlan['rooms'] = [];
  const openings: FloorPlan['openings'] = [];

  parts.forEach((part, index) => {
    const placed = applyPlacement(part.plan, part.placement);
    const prefix = `p${index}`;
    walls.push(
      ...placed.walls.map((wall) => ({ ...wall, id: `${prefix}-${wall.id}` })),
    );
    rooms.push(
      ...placed.rooms.map((room) => ({ ...room, id: `${prefix}-${room.id}` })),
    );
    openings.push(
      ...placed.openings.map((opening) => ({
        ...opening,
        id: `${prefix}-${opening.id}`,
        wallId: `${prefix}-${opening.wallId}`,
      })),
    );
  });

  return validateFloorPlan({
    unit: 'meters',
    walls,
    rooms,
    openings,
    notes: `Merged ${parts.length} room plan${
      parts.length === 1 ? '' : 's'
    } into one blueprint; cross-session rooms aligned manually.`,
  });
}

/** Union of two bounding boxes (either may be null), or null when both are empty. */
export function combineBounds(
  a: ReturnType<typeof planBounds>,
  b: ReturnType<typeof planBounds>,
): ReturnType<typeof planBounds> {
  if (a === null) return b;
  if (b === null) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
