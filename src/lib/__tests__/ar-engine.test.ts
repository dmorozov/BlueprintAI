import { describe, expect, it } from 'vitest';

import {
  TrackingLossWatch,
  openingHit,
  placeCorner,
  preferredHit,
  type ArEngineStatus,
  type ArHit,
  type ArTap,
  type Vec3,
} from '@/lib/ar-engine';

import {
  GHOST_FLOOR,
  TAPE_M,
  TRY1_END,
  TRY1_START,
  TRY2_END,
  TRY2_FLOOR_Y,
  TRY2_START,
  TRY3_END,
  TRY3_START,
  planDistance,
  plane,
  point,
} from './ticket-19-taps';

function cornerOf(tap: ArTap, floorY: number | null): Vec3 {
  const placement = placeCorner(tap, floorY);
  if (!placement.ok) throw new Error(`no corner: ${placement.reason}`);
  return placement.corner;
}

describe('placeCorner', () => {
  it('measures every tape try within 3% with the first try’s floor height', () => {
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

describe('preferredHit', () => {
  it('takes a detected plane over a nearer point, else the nearest hit', () => {
    const wall = {
      kind: 'plane' as const,
      position: [0, 0, -2] as Vec3,
      facesUp: false,
    };
    const near = point([0, 0, -1]);
    expect(preferredHit({ camera: [0, 0, 0], hits: [near, wall] })).toBe(wall);
    expect(preferredHit({ camera: [0, 0, 0], hits: [near] })).toBe(near);
    expect(preferredHit({ camera: [0, 0, 0], hits: [] })).toBeUndefined();
  });
});

// Real opening taps on a plain wall, 1.2–1.4 m away (step 6, S22 Ultra, 2026-11-07,
// depth on); rotations as Viro reported them.
/** Tap 8: ARCore had detected the wall, so the first hit is its plane, (-85, 53, 6). */
const WALL_PLANE_TAP: ArTap = {
  camera: [-0.429, 0.382, 0.065],
  hits: [
    { kind: 'plane', position: [0.521, -0.213, 0.729], facesUp: false },
    point([0.536, -0.223, 0.742]),
    point([1.764, -0.991, 1.597]),
  ],
};
/**
 * Tap 10: no wall plane. Depth points on the wall 1.33 m away, then the floor plane,
 * (180, -47, -180), which ARCore extends behind the wall: 2.87 m away.
 */
const FLOOR_BEHIND_WALL_TAP: ArTap = {
  camera: [-0.473, 0.397, 0.063],
  hits: [
    point([0.38, -0.243, 0.854]),
    point([0.401, -0.259, 0.885]),
    plane([1.372, -0.989, 1.775]),
  ],
};

describe('openingHit', () => {
  it('takes the wall, not the floor plane behind it', () => {
    expect(openingHit(FLOOR_BEHIND_WALL_TAP)).toBe(
      FLOOR_BEHIND_WALL_TAP.hits[0],
    );
  });

  it('takes a detected wall plane, even behind a nearer point', () => {
    expect(openingHit(WALL_PLANE_TAP)).toBe(WALL_PLANE_TAP.hits[0]);
    const [wall, nearPoint] = WALL_PLANE_TAP.hits as [ArHit, ArHit];
    expect(
      openingHit({ camera: WALL_PLANE_TAP.camera, hits: [nearPoint, wall] }),
    ).toBe(wall);
  });

  it('finds no wall when the tap hits only the floor, or nothing', () => {
    const floorOnly = {
      camera: FLOOR_BEHIND_WALL_TAP.camera,
      hits: [FLOOR_BEHIND_WALL_TAP.hits[2]!],
    };
    expect(openingHit(floorOnly)).toBeUndefined();
    expect(openingHit({ camera: [0, 0, 0], hits: [] })).toBeUndefined();
  });
});

// Statuses as the S22 Ultra showed them (step 2 smoke test, 2026-10-17).
const STARTING: ArEngineStatus = { kind: 'starting', waitingForCamera: false };
const GOOD: ArEngineStatus = {
  kind: 'tracking',
  quality: 'normal',
  advice: null,
};
const LIMITED: ArEngineStatus = {
  kind: 'tracking',
  quality: 'limited',
  advice: 'moving too fast, slow down',
};
const LOST: ArEngineStatus = {
  kind: 'lost',
  reason: 'Tracking lost — move the phone slowly, or tap Restart AR below.',
};
const DARK: ArEngineStatus = {
  kind: 'lost',
  reason: 'Tracking lost — too dark, turn on a light, or tap Restart AR below.',
};

describe('TrackingLossWatch', () => {
  it('ends a long loss when tracking returns 3 s or more after it was lost', () => {
    const watch = new TrackingLossWatch();
    expect(watch.update(STARTING, 0)).toBe(false);
    expect(watch.update(GOOD, 2_900)).toBe(false);
    expect(watch.update(LOST, 10_000)).toBe(false);
    expect(watch.update(GOOD, 13_000)).toBe(true);
  });

  it('does not count the start-up as a loss', () => {
    // A cold start on the S22 Ultra reached "Tracking good" 3.24 s after the tap.
    const watch = new TrackingLossWatch();
    expect(watch.update(STARTING, 0)).toBe(false);
    expect(watch.update(GOOD, 3_240)).toBe(false);
  });

  it('does not count a short loss', () => {
    // Before the resume fix, the phone showed "Tracking lost" for 0.8–0.9 s.
    const watch = new TrackingLossWatch();
    watch.update(GOOD, 0);
    expect(watch.update(LOST, 1_000)).toBe(false);
    expect(watch.update(GOOD, 1_900)).toBe(false);
  });

  it('counts a trip to the background, which is starting until tracking returns', () => {
    // Home for 5 s: starting 0.2 s after Home, "Tracking good" 1.55 s after the return.
    const watch = new TrackingLossWatch();
    watch.update(GOOD, 0);
    expect(watch.update(STARTING, 200)).toBe(false);
    expect(watch.update(GOOD, 6_550)).toBe(true);
  });

  it('times a loss from its start while its reason changes', () => {
    const watch = new TrackingLossWatch();
    watch.update(GOOD, 0);
    watch.update(LOST, 1_000);
    expect(watch.update(DARK, 3_000)).toBe(false);
    expect(watch.update(GOOD, 4_100)).toBe(true);
  });

  it('takes limited tracking as tracking', () => {
    const watch = new TrackingLossWatch();
    watch.update(GOOD, 0);
    expect(watch.update(LIMITED, 1_000)).toBe(false);
    expect(watch.update(GOOD, 5_000)).toBe(false);
    watch.update(LOST, 6_000);
    expect(watch.update(LIMITED, 9_500)).toBe(true);
  });
});
