import { describe, expect, it } from 'vitest';

import { placeCorner, type ArTap, type Vec3 } from '@/lib/ar-engine';

// Real taps on the S22 Ultra (ticket 19, 2026-10-15): a 3 ft (0.9144 m) tape on the
// floor, each end tapped through the app with depth on, 1.3–2.0 m from the camera.
// Plane hits are the floor plane; points are feature or depth points (Viro reports
// both as FeaturePoint).
const TAPE_M = 0.9144;
const plane = (position: Vec3) => ({
  kind: 'plane' as const,
  position,
  facesUp: true,
});
const point = (position: Vec3) => ({
  kind: 'point' as const,
  position,
  facesUp: false,
});

/** Try 1, tape start: the floor plane under the tap. */
const TRY1_START: ArTap = {
  camera: [-0.469, -0.486, 1.944],
  hits: [plane([-0.883, -1.639, 1.487]), point([-0.878, -1.644, 1.482])],
};
/** Try 1, tape end: the nearest point is 10 cm above the floor (the tape case). */
const TRY1_END: ArTap = {
  camera: [-0.46, -0.485, 1.947],
  hits: [
    point([-0.237, -1.541, 0.955]),
    point([-0.232, -1.542, 0.967]),
    point([-0.217, -1.636, 0.866]),
  ],
};
/** Try 2, tape start: the floor plane under the tap. */
const TRY2_START: ArTap = {
  camera: [-0.379, -0.406, 1.985],
  hits: [plane([-0.658, -1.622, 1.268]), point([-0.652, -1.624, 1.266])],
};
/** The floor height of try 2's start tap. */
const TRY2_FLOOR_Y = -1.622;
/** Try 2, tape end: floor-level points only. */
const TRY2_END: ArTap = {
  camera: [-0.371, -0.408, 1.99],
  hits: [
    point([0.011, -1.618, 0.631]),
    point([0.004, -1.607, 0.64]),
    point([0.036, -1.697, 0.542]),
  ],
};

/** Try 3, tape start: the nearest point is 26 cm above the floor (the tape case). */
const TRY3_START: ArTap = {
  camera: [-0.311, -0.364, 1.996],
  hits: [
    point([0.46, -1.358, 0.426]),
    point([0.653, -1.591, 0.058]),
    point([0.679, -1.624, 0.006]),
  ],
};
/** Try 3, tape end: floor-level points only. */
const TRY3_END: ArTap = {
  camera: [-0.306, -0.371, 2.0],
  hits: [point([0.003, -1.623, 0.603]), point([0.002, -1.612, 0.622])],
};

/**
 * Ticket 19, session 1, after ARCore rebuilt its map: two floor planes 27 cm apart
 * along one line of sight. The room had locked its floor at the lower one.
 */
const GHOST_FLOOR: ArTap = {
  camera: [-0.165, -0.353, 0.638],
  hits: [
    plane([-0.38, -1.382, 1.487]),
    plane([-0.436, -1.653, 1.71]),
    point([-0.443, -1.688, 1.738]),
  ],
};

function cornerOf(tap: ArTap, floorY: number | null): Vec3 {
  const placement = placeCorner(tap, floorY);
  if (!placement.ok) throw new Error(`no corner: ${placement.reason}`);
  return placement.corner;
}

/** Wall length in plan, as ArCaptureSession measures it (floor-plane distance). */
const planDistance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[2] - b[2]);

describe('placeCorner', () => {
  it('measures every tape try within 3%, keeping the room’s floor height across Clear', () => {
    let floorY: number | null = null;
    for (const [start, end] of [
      [TRY1_START, TRY1_END],
      [TRY2_START, TRY2_END],
      [TRY3_START, TRY3_END],
    ] as const) {
      const first = placeCorner(start, floorY);
      if (!first.ok) throw new Error(first.reason);
      floorY = first.floorY;
      const second = cornerOf(end, floorY);
      expect(
        Math.abs(planDistance(first.corner, second) / TAPE_M - 1),
      ).toBeLessThan(0.03);
    }
    // Locked by try 1's first tap, the only floor-plane hit before try 2.
    expect(floorY).toBe(-1.639);
  });

  it('puts a tap that first hits something above the floor on the floor', () => {
    const start = cornerOf(TRY3_START, TRY2_FLOOR_Y);
    const end = cornerOf(TRY3_END, TRY2_FLOOR_Y);
    expect(start[1]).toBe(TRY2_FLOOR_Y);
    expect(Math.abs(planDistance(start, end) / TAPE_M - 1)).toBeLessThan(0.03);
  });

  it('uses the nearest hit and leaves the floor unlocked until a tap hits the floor', () => {
    expect(placeCorner(TRY3_START, null)).toEqual({
      ok: true,
      corner: [0.46, -1.358, 0.426],
      floorY: null,
    });
  });

  it('does not take an upward-facing plane above the camera as the floor', () => {
    const shelfTop: ArTap = {
      camera: [0, 0, 0],
      hits: [plane([0.5, 0.3, -1])],
    };
    expect(placeCorner(shelfTop, null)).toMatchObject({
      ok: true,
      floorY: null,
    });
  });

  it('prefers a plane to a nearer point before the floor is locked', () => {
    const wall = { kind: 'plane' as const, facesUp: false };
    const tap: ArTap = {
      camera: [0, 0, 0],
      hits: [point([0.4, -0.5, -0.9]), { ...wall, position: [0.5, -0.6, -1] }],
    };
    expect(placeCorner(tap, null)).toEqual({
      ok: true,
      corner: [0.5, -0.6, -1],
      floorY: null,
    });
  });

  it('places no corner for a tap that hit nothing', () => {
    const nothing: ArTap = { camera: [0, 0, 0], hits: [] };
    expect(placeCorner(nothing, null)).toEqual({ ok: false, reason: 'no-hit' });
    expect(placeCorner(nothing, -1.6)).toEqual({ ok: false, reason: 'no-hit' });
  });

  it('places no corner when the line of sight does not reach the floor', () => {
    const upward: ArTap = { camera: [0, 0, 0], hits: [point([1, 0.2, -1])] };
    const level: ArTap = { camera: [0, 0, 0], hits: [point([1, 0, -1])] };
    expect(placeCorner(upward, -1.5)).toEqual({ ok: false, reason: 'no-hit' });
    expect(placeCorner(level, -1.5)).toEqual({ ok: false, reason: 'no-hit' });
  });

  it('refuses a corner when the floor under it has moved more than 10 cm', () => {
    expect(placeCorner(GHOST_FLOOR, -1.653)).toEqual({
      ok: false,
      reason: 'floor-shifted',
    });
  });

  it('locks the room’s floor height at its first floor-plane tap, which is the corner', () => {
    expect(placeCorner(TRY2_START, null)).toEqual({
      ok: true,
      corner: [-0.658, -1.622, 1.268],
      floorY: -1.622,
    });
  });
});
