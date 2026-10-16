/**
 * PROTOTYPE (ticket 15) — the seam between AR tap-to-trace and the AR engine, as
 * decided on 2026-10-15. Not wired; the spec's implementation moves this to
 * `src/lib/ar-engine.ts`.
 *
 * The screen talks to an engine only through these types. `ViroArEngineView` is the
 * one implementation; a replacement engine would be another component with the same
 * props and handle. Engine health (camera wait, log reasons, dead-session timer,
 * Viro's quirks) lives inside the engine component; the screen renders
 * `ArEngineStatus` and places corners with `placeCorner`.
 */

import type { ArTrackingQuality } from '@/lib/ar-capture';

export type Vec3 = [number, number, number];

/** What the engine is doing, as the screen shows it. */
export type ArEngineStatus =
  /** Mounted, not tracked yet (and not yet a dead session). */
  | { kind: 'starting' }
  | {
      kind: 'tracking';
      quality: ArTrackingQuality;
      /** Why tracking is limited, as advice ("moving too fast, slow down"); null when normal. */
      advice: string | null;
    }
  /** Tracked before and lost it; `reason` names the cause and the way back. */
  | { kind: 'lost'; reason: string }
  /** A dead session: a failure the engine reported, or no tracking within the timeout. */
  | { kind: 'dead'; reason: string };

export interface ArHit {
  /**
   * `plane`: inside a detected plane. `point`: anything else ARCore found along the
   * line of sight (feature or depth point; Viro reports both as feature points).
   */
  kind: 'plane' | 'point';
  /** Meters, in the current tracking frame, Y up. */
  position: Vec3;
  /** A horizontal plane facing up (floor, table top); false for walls and points. */
  facesUp: boolean;
}

export interface ArTap {
  /** Hits along the tap's line of sight, nearest first. */
  hits: ArHit[];
  /** Camera position at the hit test; with any hit it gives the line of sight. */
  camera: Vec3;
}

/** Imperative calls on a mounted engine (a React ref). */
export interface ArEngineHandle {
  /** Hit-tests a point of the engine view, in React Native units relative to the view. */
  hitTest(x: number, y: number): Promise<ArTap>;
}

/**
 * Props of an engine component. The screen restarts the engine (a fresh session and
 * a new tracking frame) by changing the component's React `key`.
 */
export interface ArEngineViewProps {
  /** Corner markers to draw, in the current tracking frame. */
  markers: readonly Vec3[];
  onStatusChange: (status: ArEngineStatus) => void;
  /** Once per engine session, before any tracking: the id of its new tracking frame. */
  onFrameStart: (frameId: string) => void;
}

/** A floor plane further than this from the room's floor height means the frame moved. */
export const FLOOR_SHIFT_LIMIT_M = 0.1;
/** A loss at least this long, with corners traced, gets the "earlier corners may be off" warning. */
export const LONG_TRACKING_LOSS_MS = 3000;

export type CornerPlacement =
  | {
      ok: true;
      corner: Vec3;
      /** The room's floor height after this tap: locked by its first floor-plane corner. */
      floorY: number | null;
    }
  | { ok: false; reason: 'no-hit' | 'floor-shifted' };

function isFloorHit(hit: ArHit, camera: Vec3): boolean {
  return hit.facesUp && hit.position[1] < camera[1];
}

/** Where the line of sight from `camera` through `through` meets height `y`, if downward. */
function atHeight(camera: Vec3, through: Vec3, y: number): Vec3 | null {
  const dx = through[0] - camera[0];
  const dy = through[1] - camera[1];
  const dz = through[2] - camera[2];
  if (dy > -1e-3) return null;
  const t = (y - camera[1]) / dy;
  return [camera[0] + t * dx, y, camera[2] + t * dz];
}

/**
 * Places a corner for a tap (ticket 15 Q4–Q6):
 * - Until the room has a floor height, the first floor-plane hit locks it and is the
 *   corner; without one the corner is the preferred hit (plane, then point), as today.
 * - Once locked, the corner is where the line of sight meets the floor height, so a
 *   tap that first hits a tape case or a foot still lands on the floor (ticket 19:
 *   −39% → −2.8%).
 * - A floor plane more than FLOOR_SHIFT_LIMIT_M from the locked height means the
 *   tracking frame moved (ARCore rebuilt its map), so the tap is refused.
 */
export function placeCorner(
  tap: ArTap,
  floorY: number | null,
): CornerPlacement {
  const first = tap.hits[0];
  if (first === undefined) return { ok: false, reason: 'no-hit' };
  const floorHit = tap.hits.find((hit) => isFloorHit(hit, tap.camera));
  // A plane hit lies exactly on the line of sight; a point hit only near it.
  const preferred = tap.hits.find((hit) => hit.kind === 'plane') ?? first;

  if (floorY === null) {
    if (floorHit !== undefined) {
      return {
        ok: true,
        corner: floorHit.position,
        floorY: floorHit.position[1],
      };
    }
    return { ok: true, corner: preferred.position, floorY: null };
  }

  if (
    floorHit !== undefined &&
    Math.abs(floorHit.position[1] - floorY) > FLOOR_SHIFT_LIMIT_M
  ) {
    return { ok: false, reason: 'floor-shifted' };
  }
  const corner = atHeight(tap.camera, preferred.position, floorY);
  return corner === null
    ? { ok: false, reason: 'no-hit' }
    : { ok: true, corner, floorY };
}
