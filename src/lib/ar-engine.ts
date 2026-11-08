import type { ArTrackingQuality } from '@/lib/ar-capture';

/**
 * The seam between AR tap-to-trace and the AR engine. The capture screen talks to an
 * engine only through these types; the Viro engine component is the one
 * implementation, and a replacement engine would be another component with the same
 * props and handle.
 *
 * Engine health (the camera wait, failure reasons, the dead-session timeout and the
 * engine's own quirks) stays inside the engine component: the screen renders
 * {@link ArEngineStatus} and places corners from {@link ArTap}s. The rules the screen
 * applies to what the engine reports live here too: {@link placeCorner} and
 * {@link TrackingLossWatch}.
 */

export type Vec3 = [number, number, number];

/** What the engine is doing, as the screen shows it. */
export type ArEngineStatus =
  /**
   * Mounted, not tracked yet, and not yet a dead session; or back from the background
   * and not tracking again yet (the same session and frame). `waitingForCamera`: the
   * engine is waiting for another camera user (expo-camera, another app) to let go.
   */
  | { kind: 'starting'; waitingForCamera: boolean }
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

/** Whether AR measuring can start on this phone, checked before an engine mounts. */
export type ArReadiness = 'ready' | 'unsupported' | 'denied';

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

/**
 * The hit that fixes a corner tap's line of sight (see {@link placeCorner}): a detected
 * plane, which lies exactly on the line of sight, else the nearest hit, which only lies
 * near it.
 */
export function preferredHit(tap: ArTap): ArHit | undefined {
  return tap.hits.find((hit) => hit.kind === 'plane') ?? tap.hits[0];
}

/**
 * The hit an opening tap means: the wall under the tap. A detected wall plane lies
 * exactly on the line of sight, so it comes first; else the nearest point. A plane
 * facing up (the floor, a table top) never holds an opening: ARCore extends a detected
 * floor behind walls, so a tap on a wall can hit the floor beyond it (step 6). With
 * nothing else under the tap there is no wall to place an opening on.
 */
export function openingHit(tap: ArTap): ArHit | undefined {
  return (
    tap.hits.find((hit) => hit.kind === 'plane' && !hit.facesUp) ??
    tap.hits.find((hit) => hit.kind === 'point')
  );
}

/** No floor plane within this of the room's floor height means the frame moved. */
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
 * - Floor planes on the line of sight, none of them within FLOOR_SHIFT_LIMIT_M of the
 *   locked height, mean ARCore's map moved under the room (17–20 cm in step 5, where
 *   the points agreed with the new planes), so the tap is refused. A stale plane in
 *   front of a floor plane at the locked height does not count (ticket 19).
 */
export function placeCorner(
  tap: ArTap,
  floorY: number | null,
): CornerPlacement {
  // The hit that fixes the line of sight.
  const sightHit = preferredHit(tap);
  if (sightHit === undefined) return { ok: false, reason: 'no-hit' };
  const floorHits = tap.hits.filter(
    (hit) => hit.facesUp && hit.position[1] < tap.camera[1],
  );
  if (floorY === null) {
    const floorHit = floorHits[0];
    return floorHit === undefined
      ? { ok: true, corner: sightHit.position, floorY: null }
      : { ok: true, corner: floorHit.position, floorY: floorHit.position[1] };
  }
  if (
    floorHits.length > 0 &&
    floorHits.every(
      (hit) => Math.abs(hit.position[1] - floorY) > FLOOR_SHIFT_LIMIT_M,
    )
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

/** Tracking lost at least this long mid-trace may have moved the tracking frame. */
const LONG_LOSS_MS = 3000;

/**
 * Watches one engine session's status for a long interruption of tracking, after
 * which the screen asks whether to keep the room's corners. Once the session has
 * tracked, every status but tracking interrupts it: lost, starting again (back from
 * the background) and dead. The start-up does not.
 */
export class TrackingLossWatch {
  private tracked = false;
  private lostSinceMs: number | null = null;

  /** Takes the session's latest status; true when it ends a long loss. */
  update(status: ArEngineStatus, nowMs: number): boolean {
    if (status.kind !== 'tracking') {
      if (this.tracked) this.lostSinceMs ??= nowMs;
      return false;
    }
    this.tracked = true;
    const lostSinceMs = this.lostSinceMs;
    this.lostSinceMs = null;
    return lostSinceMs !== null && nowMs - lostSinceMs >= LONG_LOSS_MS;
  }
}
