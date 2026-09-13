import { describe, expect, it } from 'vitest';

import type { FloorPlan } from '@/lib/blueprint-schema';
import {
  applyPlacement,
  combineBounds,
  identityPlacement,
  mergePlacedPlans,
  planCentroid,
} from '@/lib/plan-transform';

/** A 2 x 1 m room with one door on its bottom wall. */
function samplePlan(): FloorPlan {
  return {
    unit: 'meters',
    walls: [
      { id: 'wall-1', from: [0, 0], to: [2, 0], lengthM: 2, confidence: 1 },
      { id: 'wall-2', from: [2, 0], to: [2, 1], lengthM: 1, confidence: 1 },
      { id: 'wall-3', from: [2, 1], to: [0, 1], lengthM: 2, confidence: 1 },
      { id: 'wall-4', from: [0, 1], to: [0, 0], lengthM: 1, confidence: 1 },
    ],
    rooms: [
      {
        id: 'room-kitchen',
        label: 'Kitchen',
        polygon: [
          [0, 0],
          [2, 0],
          [2, 1],
          [0, 1],
        ],
        confidence: 1,
      },
    ],
    openings: [
      {
        id: 'opening-door-1',
        type: 'door',
        wallId: 'wall-1',
        positionT: 0.5,
        widthM: 0.85,
        confidence: 1,
      },
    ],
  };
}

describe('planCentroid', () => {
  it('averages all wall endpoints and polygon points', () => {
    // Both the walls and the polygon sample the same four corners.
    expect(planCentroid(samplePlan())).toEqual([1, 0.5]);
  });

  it('returns null for an empty plan', () => {
    expect(
      planCentroid({ unit: 'meters', walls: [], rooms: [], openings: [] }),
    ).toBeNull();
  });
});

describe('identityPlacement / applyPlacement', () => {
  it('is a no-op for the identity placement', () => {
    const plan = samplePlan();
    const result = applyPlacement(plan, identityPlacement(plan));
    expect(result.walls.map((wall) => wall.from)).toEqual(
      plan.walls.map((wall) => wall.from),
    );
    expect(result.walls.map((wall) => wall.to)).toEqual(
      plan.walls.map((wall) => wall.to),
    );
    expect(result.rooms[0]!.polygon).toEqual(plan.rooms[0]!.polygon);
  });

  it('translates every point and preserves lengths, widths, and confidence', () => {
    // The placement moves the centroid (1, 0.5) to (11, -4): a delta of (+10, -4.5).
    const result = applyPlacement(samplePlan(), {
      x: 11,
      y: -4,
      rotationRad: 0,
    });

    expect(result.walls[0]!.from).toEqual([10, -4.5]); // (0,0) + delta
    expect(result.walls[2]!.to).toEqual([10, -3.5]); // (0,1) + delta
    // Rigid transform: measured lengths are unchanged.
    expect(result.walls.map((wall) => wall.lengthM)).toEqual([2, 1, 2, 1]);
    expect(result.openings[0]).toMatchObject({
      positionT: 0.5,
      widthM: 0.85,
      confidence: 1,
    });
    expect(result.rooms[0]!.confidence).toBe(1);
  });

  it('rotates around the plan centroid', () => {
    // Centroid (1, 0.5); +90° in y-down coordinates maps corner (2, 0) to (1.5, 1.5).
    const result = applyPlacement(samplePlan(), {
      x: 1,
      y: 0.5,
      rotationRad: Math.PI / 2,
    });

    expect(result.walls[0]!.from).toEqual([1.5, -0.5]); // (0,0) rotated
    expect(result.walls[0]!.to).toEqual([1.5, 1.5]); // (2,0) rotated
    expect(result.rooms[0]!.polygon).toEqual([
      [1.5, -0.5],
      [1.5, 1.5],
      [0.5, 1.5],
      [0.5, -0.5],
    ]);
    // Still a 2 x 1 room.
    expect(result.walls.map((wall) => wall.lengthM)).toEqual([2, 1, 2, 1]);
  });

  it('combines rotation and translation', () => {
    const result = applyPlacement(samplePlan(), {
      x: 10,
      y: 10,
      rotationRad: Math.PI, // 180°
    });
    // (0,0) relative to centroid (1,0.5): (-1,-0.5) → rotated 180° → (1,0.5) → +(10,10).
    expect(result.walls[0]!.from).toEqual([11, 10.5]);
    expect(result.walls[0]!.to).toEqual([9, 10.5]);
  });
});

describe('mergePlacedPlans', () => {
  it('unions placed plans with collision-free ids and valid references', () => {
    const kitchen = samplePlan();
    // A second room placed 3 m to the right of the first (no overlap).
    const hall = samplePlan();

    const merged = mergePlacedPlans([
      { plan: kitchen, placement: identityPlacement(kitchen) },
      { plan: hall, placement: { x: 4, y: 0.5, rotationRad: 0 } },
    ]);

    expect(merged.walls).toHaveLength(8);
    expect(merged.rooms).toHaveLength(2);
    const wallIds = merged.walls.map((wall) => wall.id);
    expect(new Set(wallIds).size).toBe(8);
    for (const opening of merged.openings) {
      expect(wallIds, `opening ${opening.id} wall ref`).toContain(
        opening.wallId,
      );
    }
    expect(merged.notes).toMatch(/Merged 2 room plans/);
  });

  it('keeps a single part intact', () => {
    const only = samplePlan();
    const merged = mergePlacedPlans([
      { plan: only, placement: identityPlacement(only) },
    ]);
    expect(merged.walls).toHaveLength(4);
    expect(merged.rooms[0]!.label).toBe('Kitchen');
  });
});

describe('combineBounds', () => {
  it('unions two boxes and passes nulls through', () => {
    const a = { minX: 0, minY: 0, maxX: 2, maxY: 1 };
    const b = { minX: 3, minY: -1, maxX: 5, maxY: 4 };
    expect(combineBounds(a, b)).toEqual({
      minX: 0,
      minY: -1,
      maxX: 5,
      maxY: 4,
    });
    expect(combineBounds(null, b)).toEqual(b);
    expect(combineBounds(a, null)).toEqual(a);
    expect(combineBounds(null, null)).toBeNull();
  });
});
