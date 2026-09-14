import { describe, expect, it } from 'vitest';

import {
  ArCaptureSession,
  mergeSameFramePlans,
  prefixPlanIds,
  toFloorPoint,
} from '@/lib/ar-capture';

/** Builds a session tracing a 3 x 4 m rectangle (floor plane, walking order). */
function makeRectSession(qualities?: ('normal' | 'limited')[]) {
  const session = new ArCaptureSession();
  const corners: [number, number, number][] = [
    [0, 1.5, 0],
    [3, 1.7, 0],
    [3, 1.4, 4],
    [0, 1.6, 4],
  ];
  for (const corner of corners) {
    session.addCorner(corner, qualities?.shift() ?? 'normal');
  }
  return session;
}

describe('toFloorPoint', () => {
  it('projects an AR world point onto the floor plane (drops height)', () => {
    expect(toFloorPoint([1.25, 1.6, -3.5])).toEqual([1.25, -3.5]);
  });
});

describe('ArCaptureSession corner bookkeeping', () => {
  it('starts empty and records corners in walking order', () => {
    const session = new ArCaptureSession();
    expect(session.cornerCount).toBe(0);
    expect(session.floorPoints).toEqual([]);

    session.addCorner([0, 1.5, 0], 'normal');
    session.addCorner([3, 1.7, 0], 'normal');
    expect(session.cornerCount).toBe(2);
    // Height is dropped; walking order is preserved.
    expect(session.floorPoints).toEqual([
      [0, 0],
      [3, 0],
    ]);
    expect(session.cornerWorldPositions[1]).toEqual([3, 1.7, 0]);
  });

  it('undoCorner removes the last corner and clear resets everything', () => {
    const session = makeRectSession();
    session.addOpening([1.5, 0, 0], 'door', 0.85, 'normal');

    session.undoCorner();
    expect(session.cornerCount).toBe(3);

    session.clear();
    expect(session.cornerCount).toBe(0);
    expect(session.locateOnWall([1.5, 0, 0])).toBeNull();
  });

  it('adding a corner invalidates stored openings (wall indices shift)', () => {
    const session = makeRectSession();
    // A door on wall 1 of the 4-corner rectangle…
    expect(session.addOpening([1.5, 0, 0], 'door', 0.85, 'normal')).toBe(true);
    // …then a fifth corner is added: the stored opening must be dropped.
    session.addCorner([1, 1.5, 4], 'normal');
    const plan = session.finishRoom('Lab');
    expect(plan.openings).toEqual([]);
    expect(plan.walls).toHaveLength(5);
  });

  it('reports how many openings a corner change discards', () => {
    const session = makeRectSession();
    expect(session.openingCount).toBe(0);
    // No openings yet — adding and undoing corners clears nothing.
    expect(session.addCorner([1, 1.5, 4], 'normal')).toBe(0);
    expect(session.undoCorner()).toBe(0);

    // Two openings recorded, then the corner order changes: both are discarded
    // AND reported, so the UI can tell the user instead of losing them silently.
    expect(session.addOpening([1.5, 0, 0], 'door', 0.85, 'normal')).toBe(true);
    expect(session.addOpening([3, 0, 2], 'window', 1.2, 'normal')).toBe(true);
    expect(session.openingCount).toBe(2);

    expect(session.undoCorner()).toBe(2);
    expect(session.openingCount).toBe(0);

    expect(session.addOpening([1.5, 0, 0], 'door', 0.85, 'normal')).toBe(true);
    expect(session.addCorner([1, 1.5, 4], 'normal')).toBe(1);
    expect(session.openingCount).toBe(0);
  });
});

describe('ArCaptureSession.locateOnWall', () => {
  it('returns null with fewer than two corners', () => {
    const session = new ArCaptureSession();
    expect(session.locateOnWall([0, 0, 0])).toBeNull();
    session.addCorner([0, 1.5, 0], 'normal');
    expect(session.locateOnWall([0, 0, 0])).toBeNull();
  });

  it('finds the wall under a mid-wall tap with its fractional position', () => {
    const session = makeRectSession();
    // Midpoint of wall 1 (from [0,0] to [3,0]).
    expect(session.locateOnWall([1.5, 0, 0])).toEqual({
      wallIndex: 0,
      positionT: 0.5,
    });
    // Midpoint of wall 2 (from [3,0] to [3,4]).
    expect(session.locateOnWall([3, 0, 2])).toEqual({
      wallIndex: 1,
      positionT: 0.5,
    });
  });

  it('picks the nearest wall for an off-wall tap and keeps t within [0,1]', () => {
    const session = makeRectSession();
    // Just outside corner B=[3,0]: closest segment is wall 2 at t=0.25.
    expect(session.locateOnWall([4, 0, 1])).toEqual({
      wallIndex: 1,
      positionT: 0.25,
    });

    // Probe many points around the room: the result must always be a valid
    // wall index with a clamped fractional position.
    for (let x = -2; x <= 5; x += 0.5) {
      for (let z = -2; z <= 6; z += 0.5) {
        const located = session.locateOnWall([x, 0, z]);
        expect(located, `tap at (${x}, ${z})`).not.toBeNull();
        expect(located!.wallIndex).toBeGreaterThanOrEqual(0);
        expect(located!.wallIndex).toBeLessThan(4);
        expect(located!.positionT).toBeGreaterThanOrEqual(0);
        expect(located!.positionT).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('ArCaptureSession.finishRoom', () => {
  it('throws when fewer than three corners are recorded', () => {
    const session = new ArCaptureSession();
    session.addCorner([0, 1.5, 0], 'normal');
    session.addCorner([3, 1.7, 0], 'normal');
    expect(() => session.finishRoom('Too small')).toThrow(/At least 3/);
  });

  it('builds a validated plan with measured wall lengths and a closed polygon', () => {
    const plan = makeRectSession().finishRoom('Living Room');

    expect(plan.unit).toBe('meters');
    // Wall lengths are measured from the tap positions, not estimated.
    expect(plan.walls.map((wall) => wall.lengthM)).toEqual([3, 4, 3, 4]);
    // The polygon closes: last wall ends where the first one starts.
    expect(plan.walls[3]!.to).toEqual(plan.walls[0]!.from);
    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0]!.label).toBe('Living Room');
    expect(plan.rooms[0]!.id).toBe('room-living-room');
    expect(plan.rooms[0]!.polygon).toEqual([
      [0, 0],
      [3, 0],
      [3, 4],
      [0, 4],
    ]);
    // All-normal tracking → full confidence everywhere.
    for (const wall of plan.walls) expect(wall.confidence).toBe(1);
    expect(plan.rooms[0]!.confidence).toBe(1);
    expect(plan.notes).toMatch(/ARCore tap-to-trace/);
  });

  it('maps tracking quality onto per-wall and room confidence', () => {
    const plan = makeRectSession([
      'normal',
      'limited',
      'normal',
      'normal',
    ]).finishRoom('Hall');

    // Wall i takes the minimum of its two endpoint corners' quality.
    expect(plan.walls.map((wall) => wall.confidence)).toEqual([0.7, 0.7, 1, 1]);
    expect(plan.rooms[0]!.confidence).toBe(0.7);
  });

  it('emits openings with wall references and rounded values', () => {
    const session = makeRectSession();
    expect(session.addOpening([1.5, 0, 0], 'door', 0.85, 'normal')).toBe(true);
    expect(session.addOpening([3, 0, 2.66], 'window', 1.2, 'limited')).toBe(
      true,
    );

    const plan = session.finishRoom('Bedroom');
    expect(plan.openings).toEqual([
      {
        id: 'opening-door-1',
        type: 'door',
        wallId: 'wall-1',
        positionT: 0.5,
        widthM: 0.85,
        confidence: 1,
      },
      {
        // Ids use the overall opening index (i + 1), not a per-type counter.
        id: 'opening-window-2',
        type: 'window',
        wallId: 'wall-2',
        positionT: round2(2.66 / 4),
        widthM: 1.2,
        confidence: 0.7,
      },
    ]);
  });

  it('slugs room labels and falls back to Room for blank labels', () => {
    expect(makeRectSession().finishRoom('Kitchen & Pantry').rooms[0]!.id).toBe(
      'room-kitchen-pantry',
    );
    const blank = makeRectSession().finishRoom('   ');
    expect(blank.rooms[0]!.id).toBe('room-room');
    expect(blank.rooms[0]!.label).toBe('Room');
  });

  it('addOpening fails when no wall can be located yet', () => {
    const session = new ArCaptureSession();
    session.addCorner([0, 1.5, 0], 'normal');
    expect(session.addOpening([0, 0, 0], 'door', 0.85, 'normal')).toBe(false);
  });
});

describe('prefixPlanIds', () => {
  it('re-prefixes element ids and opening wall references', () => {
    const session = makeRectSession();
    session.addOpening([1.5, 0, 0], 'door', 0.85, 'normal');
    const prefixed = prefixPlanIds(session.finishRoom('Study'), 'r7');

    expect(prefixed.walls.map((wall) => wall.id)).toEqual([
      'r7-wall-1',
      'r7-wall-2',
      'r7-wall-3',
      'r7-wall-4',
    ]);
    expect(prefixed.rooms[0]!.id).toBe('r7-room-study');
    expect(prefixed.openings[0]).toMatchObject({
      id: 'r7-opening-door-1',
      wallId: 'r7-wall-1',
    });
  });
});

describe('mergeSameFramePlans', () => {
  it('unions same-frame plans with collision-free ids and valid references', () => {
    const first = makeRectSession().finishRoom('Kitchen');
    // Second room offset in the shared AR frame (adjacent, not overlapping).
    const second = new ArCaptureSession();
    const diningCorners: [number, number, number][] = [
      [3, 1.5, 0],
      [7, 1.6, 0],
      [7, 1.4, 4],
      [3, 1.6, 4],
    ];
    for (const corner of diningCorners) {
      second.addCorner(corner, 'normal');
    }
    const planB = second.finishRoom('Dining');

    const merged = mergeSameFramePlans([first, planB]);

    expect(merged.walls).toHaveLength(8);
    expect(merged.rooms).toHaveLength(2);
    // No duplicate ids across the union.
    const wallIds = merged.walls.map((wall) => wall.id);
    expect(new Set(wallIds).size).toBe(wallIds.length);
    // Every opening still references an existing (prefixed) wall.
    for (const opening of merged.openings) {
      expect(wallIds, `opening ${opening.id} wall ref`).toContain(
        opening.wallId,
      );
    }
    expect(merged.notes).toMatch(/Merged from 2 rooms/);
  });

  it('keeps a single plan intact (one-element merge)', () => {
    const only = makeRectSession().finishRoom('Solo');
    const merged = mergeSameFramePlans([only]);
    expect(merged.walls).toHaveLength(4);
    expect(merged.rooms[0]!.label).toBe('Solo');
  });
});

// Local copy of the rounding used by ar-capture (kept private there on purpose).
const round2 = (value: number) => Math.round(value * 100) / 100;
