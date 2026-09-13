import { validateFloorPlan, type FloorPlan } from '@/lib/blueprint-schema';

/**
 * AR tap-to-trace capture logic (no-external-API plan, Phase 1).
 *
 * The user walks a room and taps each wall corner in walking order while the AR
 * session tracks the phone's real-world pose. Each tap's hit-test position (meters,
 * ARCore world frame, Y-up) is projected onto the floor plane; consecutive corners
 * become walls with lengths computed from the actual tap positions — measured, not
 * estimated. `confidence` is repurposed as tracking quality at tap time (1.0 for
 * normal tracking, 0.7 when limited), describing measurement quality rather than a
 * model's guess.
 *
 * Plans keep raw AR-frame coordinates on purpose: rooms captured consecutively in one
 * session share the same tracking frame, so they can be merged into a combined plan by
 * plain geometry union (see mergeSameFramePlans) — no alignment or AI involved.
 *
 * Pure TypeScript with no runtime imports beyond the schema validator: the same code
 * runs in Hermes and under Node for testing.
 */

/** Tracking quality at the moment of a tap, mapped from ViroReact's tracking state. */
export type ArTrackingQuality = 'normal' | 'limited';

const CONFIDENCE: Record<ArTrackingQuality, number> = {
  normal: 1.0,
  limited: 0.7,
};

export interface ArCornerTap {
  /** AR world position where the hit test landed (meters, Y-up). */
  world: [number, number, number];
  quality: ArTrackingQuality;
}

interface StoredOpening {
  wallIndex: number;
  positionT: number;
  type: 'door' | 'window';
  widthM: number;
  quality: ArTrackingQuality;
}

/** Projects an AR world point onto the floor plane (drops the height component). */
export function toFloorPoint(
  world: [number, number, number],
): [number, number] {
  return [world[0], world[2]];
}

const round2 = (value: number) => Math.round(value * 100) / 100;

function slugify(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug !== '' ? slug : 'room';
}

/**
 * One room's in-progress AR capture. Corner taps are stored in walking order; the
 * polygon closes automatically (last corner connects back to the first).
 */
export class ArCaptureSession {
  private corners: ArCornerTap[] = [];
  private openingTaps: StoredOpening[] = [];

  get cornerCount(): number {
    return this.corners.length;
  }

  /** Floor-plane (x, z) positions of the recorded corners, in walking order. */
  get floorPoints(): [number, number][] {
    return this.corners.map((corner) => toFloorPoint(corner.world));
  }

  /** World-space (x, y, z) positions of the recorded corners, for AR markers. */
  get cornerWorldPositions(): [number, number, number][] {
    return this.corners.map((corner) => corner.world);
  }

  /**
   * Records a corner tap. Adding or removing corners invalidates stored openings
   * (wall indices shift), so openings must be added after the final corner.
   */
  addCorner(world: [number, number, number], quality: ArTrackingQuality): void {
    this.corners.push({ world, quality });
    this.openingTaps = [];
  }

  undoCorner(): void {
    this.corners.pop();
    this.openingTaps = [];
  }

  clear(): void {
    this.corners = [];
    this.openingTaps = [];
  }

  /**
   * Locates a tapped floor point on the nearest wall segment.
   * @returns the wall index (0-based, in walking order) and the fractional position
   *          along that wall, or null when fewer than two corners are recorded.
   */
  locateOnWall(world: [number, number, number]): {
    wallIndex: number;
    positionT: number;
  } | null {
    if (this.corners.length < 2) return null;
    const p = toFloorPoint(world);
    let best: { distSq: number; wallIndex: number; positionT: number } | null =
      null;

    for (let i = 0; i < this.corners.length; i++) {
      const a = toFloorPoint(this.corners[i]!.world);
      const b = toFloorPoint(
        this.corners[(i + 1) % this.corners.length]!.world,
      );
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const lengthSq = abx * abx + aby * aby;
      if (lengthSq === 0) continue;
      let t = ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / lengthSq;
      t = Math.max(0, Math.min(1, t));
      const cx = a[0] + t * abx;
      const cy = a[1] + t * aby;
      const distSq = (p[0] - cx) ** 2 + (p[1] - cy) ** 2;
      if (best === null || distSq < best.distSq) {
        best = { distSq, wallIndex: i, positionT: t };
      }
    }

    return best === null
      ? null
      : { wallIndex: best.wallIndex, positionT: best.positionT };
  }

  /**
   * Adds a door/window at the tapped position on the nearest wall.
   * @returns false when no wall could be located (fewer than two corners).
   */
  addOpening(
    world: [number, number, number],
    type: 'door' | 'window',
    widthM: number,
    quality: ArTrackingQuality,
  ): boolean {
    const location = this.locateOnWall(world);
    if (location === null) return false;
    this.openingTaps.push({ ...location, type, widthM, quality });
    return true;
  }

  /**
   * Builds the room's FloorPlan from the recorded corners and openings.
   * Wall lengths are measured from the tap positions (Math.hypot), not estimated.
   * Throws when fewer than three corners are recorded.
   */
  finishRoom(label: string): FloorPlan {
    if (this.corners.length < 3) {
      throw new Error('At least 3 corner taps are needed to define a room.');
    }

    const points = this.floorPoints.map(
      (point) => [round2(point[0]), round2(point[1])] as [number, number],
    );

    const walls = points.map((from, i) => {
      const to = points[(i + 1) % points.length]!;
      const lengthM = Math.hypot(to[0] - from[0], to[1] - from[1]);
      const confidence = Math.min(
        CONFIDENCE[this.corners[i]!.quality],
        CONFIDENCE[this.corners[(i + 1) % points.length]!.quality],
      );
      return {
        id: `wall-${i + 1}`,
        from,
        to,
        lengthM: round2(lengthM),
        confidence,
      };
    });

    const openings = this.openingTaps.map((opening, i) => ({
      id: `opening-${opening.type}-${i + 1}`,
      type: opening.type,
      wallId: `wall-${opening.wallIndex + 1}`,
      positionT: round2(opening.positionT),
      widthM: round2(opening.widthM),
      confidence: CONFIDENCE[opening.quality],
    }));

    const roomConfidence = Math.min(
      ...this.corners.map((corner) => CONFIDENCE[corner.quality]),
    );

    return validateFloorPlan({
      unit: 'meters',
      walls,
      rooms: [
        {
          id: `room-${slugify(label)}`,
          label: label.trim() !== '' ? label.trim() : 'Room',
          polygon: points,
          confidence: roomConfidence,
        },
      ],
      openings,
      notes:
        'Measured with ARCore tap-to-trace. Coordinates are in the session AR frame (floor plane); wall lengths are measured from tap positions.',
    });
  }
}

/** Re-prefixes every element id of a plan so plans can be merged without collisions. */
export function prefixPlanIds(plan: FloorPlan, prefix: string): FloorPlan {
  return {
    unit: 'meters',
    walls: plan.walls.map((wall) => ({ ...wall, id: `${prefix}-${wall.id}` })),
    rooms: plan.rooms.map((room) => ({ ...room, id: `${prefix}-${room.id}` })),
    openings: plan.openings.map((opening) => ({
      ...opening,
      id: `${prefix}-${opening.id}`,
      wallId: `${prefix}-${opening.wallId}`,
    })),
  };
}

/**
 * Merges plans captured in ONE AR session (shared tracking frame) into a single plan.
 * Pure geometry union — the rooms are already aligned in the same coordinate system,
 * so no re-alignment or AI is involved.
 */
export function mergeSameFramePlans(plans: FloorPlan[]): FloorPlan {
  const walls: FloorPlan['walls'] = [];
  const rooms: FloorPlan['rooms'] = [];
  const openings: FloorPlan['openings'] = [];
  plans.forEach((plan, index) => {
    const prefixed = prefixPlanIds(plan, `r${index}`);
    walls.push(...prefixed.walls);
    rooms.push(...prefixed.rooms);
    openings.push(...prefixed.openings);
  });
  return validateFloorPlan({
    unit: 'meters',
    walls,
    rooms,
    openings,
    notes: `Merged from ${plans.length} rooms captured in one AR session (shared tracking frame).`,
  });
}
