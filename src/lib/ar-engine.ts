import type { ArTrackingQuality } from '@/lib/ar-capture';

/**
 * The seam between AR tap-to-trace and the AR engine. The capture screen talks to an
 * engine only through these types; the Viro engine component is the one
 * implementation, and a replacement engine would be another component with the same
 * props and handle.
 *
 * Engine health (the camera wait, failure reasons, the dead-session timeout and the
 * engine's own quirks) stays inside the engine component: the screen renders
 * {@link ArEngineStatus} and places corners from {@link ArTap}s.
 */

export type Vec3 = [number, number, number];

/** What the engine is doing, as the screen shows it. */
export type ArEngineStatus =
  /** Mounted, not tracked yet, and not yet a dead session. */
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
   * `plane`: inside a detected plane. `point`: anything else the engine found along
   * the line of sight (a feature or depth point; Viro reports both as feature points).
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
 * Props of an engine component. The screen restarts the engine (a fresh session and a
 * new tracking frame) by changing the component's React `key`.
 */
export interface ArEngineViewProps {
  /** Corner markers to draw, in the current tracking frame. */
  markers: readonly Vec3[];
  onStatusChange: (status: ArEngineStatus) => void;
  /** Once per engine session, before any tracking: the id of its new tracking frame. */
  onFrameStart: (frameId: string) => void;
}

/** A floor plane further than this from the room's floor height means the frame moved. */
const FLOOR_SHIFT_LIMIT_M = 0.1;
/** A line of sight that drops less than this toward its hit never reaches the floor. */
const MIN_DROP_M = 1e-3;

export type CornerPlacement =
  | {
      ok: true;
      corner: Vec3;
      /** The room's floor height after this tap: locked by its first floor-plane tap. */
      floorY: number | null;
    }
  | { ok: false; reason: 'no-hit' | 'floor-shifted' };

/**
 * Places a Corner for a tap, given the floor height of the room being traced (null
 * until one of its taps has hit the floor). The caller keeps that height per room:
 * Clear and Undo keep it; Next room, Restart AR and a new tracking frame reset it.
 *
 * - Until the room has a floor height, the first upward-facing plane below the camera
 *   locks it and is the Corner; without one, the Corner is the preferred hit.
 * - Once locked, the Corner is where the tap's line of sight meets the floor height,
 *   so a tap that first hits a tape case or a foot still lands on the floor.
 * - A floor plane more than FLOOR_SHIFT_LIMIT_M from the locked height means ARCore
 *   rebuilt its map and the tracking frame moved, so the tap is refused.
 */
export function placeCorner(
  tap: ArTap,
  floorY: number | null,
): CornerPlacement {
  // The hit that fixes the line of sight: a plane hit lies exactly on it, a point hit
  // only near it.
  const sightHit = tap.hits.find((hit) => hit.kind === 'plane') ?? tap.hits[0];
  if (sightHit === undefined) return { ok: false, reason: 'no-hit' };
  const floorHit = tap.hits.find(
    (hit) => hit.facesUp && hit.position[1] < tap.camera[1],
  );
  if (floorY === null) {
    return floorHit === undefined
      ? { ok: true, corner: sightHit.position, floorY: null }
      : { ok: true, corner: floorHit.position, floorY: floorHit.position[1] };
  }
  if (
    floorHit !== undefined &&
    Math.abs(floorHit.position[1] - floorY) > FLOOR_SHIFT_LIMIT_M
  ) {
    return { ok: false, reason: 'floor-shifted' };
  }
  const corner = atHeight(tap.camera, sightHit.position, floorY);
  return corner === null
    ? { ok: false, reason: 'no-hit' }
    : { ok: true, corner, floorY };
}

/**
 * Where the line of sight from `camera` through `through` meets height `y`, or null
 * when it does not point down.
 */
function atHeight(camera: Vec3, through: Vec3, y: number): Vec3 | null {
  const drop = through[1] - camera[1];
  if (drop > -MIN_DROP_M) return null;
  const t = (y - camera[1]) / drop;
  return [
    camera[0] + t * (through[0] - camera[0]),
    y,
    camera[2] + t * (through[2] - camera[2]),
  ];
}
