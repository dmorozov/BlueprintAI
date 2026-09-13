import { describe, expect, it } from 'vitest';

import type { SuggestedWall } from '@/lib/photo-assist-client';
import {
  ASSIST_CONFIDENCE_CAP,
  chainWallsToPolygon,
  suggestionPreviewPlan,
  suggestionToPlan,
} from '@/lib/photo-assist-plan';

const wall = (
  from: [number, number],
  to: [number, number],
  confidence = 0.9,
): SuggestedWall => ({
  from,
  to,
  lengthM: Math.hypot(to[0] - from[0], to[1] - from[1]),
  confidence,
});

/** A 4 m x 3 m rectangle as four suggested walls (deliberately unordered). */
const RECTANGLE: SuggestedWall[] = [
  wall([4, 3], [0, 3]), // south, reversed orientation
  wall([0, 0], [4, 0]), // north
  wall([0, 3], [0, 0]), // west, reversed orientation
  wall([4, 0], [4, 3]), // east
];

describe('chainWallsToPolygon', () => {
  it('chains an unordered rectangle into a closed polygon', () => {
    const polygon = chainWallsToPolygon(RECTANGLE);
    expect(polygon).not.toBeNull();
    expect(polygon!).toHaveLength(4);
    const xs = polygon!.map((p) => p[0]).sort((a, b) => a - b);
    const ys = polygon!.map((p) => p[1]).sort((a, b) => a - b);
    expect(xs).toEqual([0, 0, 4, 4]);
    expect(ys).toEqual([0, 0, 3, 3]);
  });

  it('returns null for an open chain', () => {
    const open = [
      wall([0, 0], [4, 0]),
      wall([4, 0], [4, 3]),
      wall([4, 3], [1, 3]), // does not close back to (0,0)
    ];
    expect(chainWallsToPolygon(open)).toBeNull();
  });

  it('returns null with fewer than three walls', () => {
    expect(chainWallsToPolygon([])).toBeNull();
    expect(chainWallsToPolygon(RECTANGLE.slice(0, 2))).toBeNull();
  });

  it('snaps junction gaps within tolerance but not beyond it', () => {
    // ~11 cm gap between wall 1's end and wall 2's start (< 15 cm snap).
    const snapped = [
      wall([0, 0], [4, 0]),
      wall([4.09, 0.06], [4, 3]),
      wall([4, 3], [0, 3]),
      wall([0, 3], [0, 0]),
    ];
    expect(chainWallsToPolygon(snapped)).not.toBeNull();

    // 50 cm gap at the same junction (> snap) — the chain must not close.
    const far = [
      wall([0, 0], [4, 0]),
      wall([4.5, 0], [4.5, 3]),
      wall([4.5, 3], [0, 3]),
      wall([0, 3], [0, 0]),
    ];
    expect(chainWallsToPolygon(far)).toBeNull();
  });
});

describe('suggestionToPlan', () => {
  it('caps every confidence below AR measurements and marks the plan as auto-detected', () => {
    const plan = suggestionToPlan(RECTANGLE, 'Kitchen');
    for (const w of plan.walls) {
      expect(w.confidence).toBeLessThanOrEqual(ASSIST_CONFIDENCE_CAP);
    }
    expect(plan.rooms[0]?.confidence).toBe(ASSIST_CONFIDENCE_CAP);
    expect(plan.notes).toMatch(/auto-detected/i);
    expect(plan.notes).toMatch(/verify/i);
  });

  it('synthesizes the room polygon when walls close, and keeps the label', () => {
    const plan = suggestionToPlan(RECTANGLE, 'Kitchen');
    expect(plan.walls).toHaveLength(4);
    expect(plan.rooms).toHaveLength(1);
    expect(plan.rooms[0]?.label).toBe('Kitchen');
    expect(plan.rooms[0]?.polygon).toHaveLength(4);
  });

  it('produces a walls-only plan when the chain does not close', () => {
    const open = [
      wall([0, 0], [4, 0]),
      wall([4, 0], [4, 3]),
      wall([4, 3], [1, 3]),
    ];
    const plan = suggestionToPlan(open, 'Room');
    expect(plan.walls).toHaveLength(3);
    expect(plan.rooms).toHaveLength(0);
    expect(plan.openings).toHaveLength(0);
  });

  it('rounds lengths to centimeters', () => {
    const plan = suggestionToPlan([wall([0, 0], [1.234, 0])], 'Room');
    expect(plan.walls[0]?.lengthM).toBe(1.23);
  });

  it('passes the schema validator (self-check)', () => {
    // suggestionToPlan already returns validateFloorPlan output; a throwing re-check
    // would surface any drift from the FloorPlan contract.
    expect(() => suggestionToPlan(RECTANGLE, 'Room')).not.toThrow();
  });
});

describe('suggestionPreviewPlan', () => {
  it('renders walls only (no room polygon) for the review UI', () => {
    const plan = suggestionPreviewPlan(RECTANGLE);
    expect(plan.walls).toHaveLength(4);
    expect(plan.rooms).toHaveLength(0);
    for (const w of plan.walls) {
      expect(w.confidence).toBeLessThanOrEqual(ASSIST_CONFIDENCE_CAP);
    }
  });
});
