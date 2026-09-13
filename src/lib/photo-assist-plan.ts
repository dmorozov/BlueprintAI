import {
  validateFloorPlan,
  type FloorPlan,
  type Point,
} from '@/lib/blueprint-schema';
import type { SuggestedWall } from '@/lib/photo-assist-client';

/**
 * Photo-assist suggestions -> FloorPlan (no-external-API plan, Phase 2).
 *
 * The self-hosted service proposes walls in each photo's local frame (origin at the
 * camera, x right, y forward, meters). After the user taps to confirm which walls to
 * keep, this module builds the room's FloorPlan from the accepted set:
 *
 * - Every wall's confidence is capped at ASSIST_CONFIDENCE_CAP — deliberately lower
 *   than AR tap measurements (1.0 normal / 0.7 limited) so photo-derived geometry is
 *   always read as "auto-detected — verify", never as a real measurement.
 * - If the accepted walls chain into a closed loop, the room polygon is synthesized
 *   from them; otherwise the plan is walls-only (still valid and renderable).
 *
 * Pure TypeScript with no runtime imports beyond the schema: runs in Hermes and under
 * Node for testing.
 */

/** Photo-assist walls must read as less certain than any AR tap measurement. */
export const ASSIST_CONFIDENCE_CAP = 0.5;

/** Wall endpoints within this distance (meters) are considered the same corner. */
const CHAIN_SNAP_TOL_M = 0.15;

const round2 = (value: number): number => Math.round(value * 100) / 100;

function slugify(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug !== '' ? slug : 'room';
}

function distance(a: Point, b: Point): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Greedily chains wall segments into a closed loop by matching endpoints (either
 * orientation) within CHAIN_SNAP_TOL_M. Returns the loop's corner points (without the
 * closing duplicate), or null when the walls do not form a closed chain.
 */
export function chainWallsToPolygon(walls: SuggestedWall[]): Point[] | null {
  if (walls.length < 3) return null;

  const remaining = walls.map((wall) => ({
    from: wall.from as Point,
    to: wall.to as Point,
  }));
  const first = remaining.shift()!;
  const loop: Point[] = [first.from, first.to];

  while (remaining.length > 0) {
    const target = loop[loop.length - 1]!;
    let bestIndex = -1;
    let bestDist = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const wall = remaining[i]!;
      const distToFrom = distance(target, wall.from);
      const distToTo = distance(target, wall.to);
      if (distToFrom <= CHAIN_SNAP_TOL_M && distToFrom < bestDist) {
        bestDist = distToFrom;
        bestIndex = i;
      }
      if (distToTo <= CHAIN_SNAP_TOL_M && distToTo < bestDist) {
        bestDist = distToTo;
        bestIndex = i;
      }
    }
    if (bestIndex === -1) return null; // open chain — no closed room

    const next = remaining.splice(bestIndex, 1)[0]!;
    loop.push(
      distance(target, next.from) <= CHAIN_SNAP_TOL_M ? next.to : next.from,
    );
  }

  if (distance(loop[loop.length - 1]!, loop[0]!) > CHAIN_SNAP_TOL_M) {
    return null; // the chain does not close back to the start
  }

  const points = loop
    .slice(0, -1)
    .map(([x, y]) => [round2(x), round2(y)] as Point);
  return points.length >= 3 ? points : null;
}

/** A walls-only preview plan (no room polygon) for the review UI. */
export function suggestionPreviewPlan(walls: SuggestedWall[]): FloorPlan {
  return validateFloorPlan({
    unit: 'meters',
    walls: walls.map((wall, i) => ({
      id: `wall-${i + 1}`,
      from: wall.from as Point,
      to: wall.to as Point,
      lengthM: round2(wall.lengthM),
      confidence: Math.min(ASSIST_CONFIDENCE_CAP, wall.confidence),
    })),
    rooms: [],
    openings: [],
  });
}

/**
 * Builds the room's FloorPlan from the walls the user accepted. Confidence is capped
 * at ASSIST_CONFIDENCE_CAP and the notes field marks the plan as auto-detected.
 */
export function suggestionToPlan(
  walls: SuggestedWall[],
  label: string,
): FloorPlan {
  const polygon = chainWallsToPolygon(walls);
  return validateFloorPlan({
    unit: 'meters',
    walls: walls.map((wall, i) => ({
      id: `wall-${i + 1}`,
      from: wall.from as Point,
      to: wall.to as Point,
      lengthM: round2(wall.lengthM),
      confidence: Math.min(ASSIST_CONFIDENCE_CAP, wall.confidence),
    })),
    rooms:
      polygon !== null
        ? [
            {
              id: `room-${slugify(label)}`,
              label: label.trim() !== '' ? label.trim() : 'Room',
              polygon,
              confidence: ASSIST_CONFIDENCE_CAP,
            },
          ]
        : [],
    openings: [],
    notes:
      'Auto-detected from photos by your self-hosted MoGe assist server — approximate dimensions; verify against the real room.',
  });
}
