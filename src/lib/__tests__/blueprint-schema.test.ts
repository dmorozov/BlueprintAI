import { describe, expect, it } from 'vitest';

import {
  formatAreaM2,
  planAreaM2,
  polygonAreaM2,
  type FloorPlan,
  type Point,
} from '@/lib/blueprint-schema';

const RECT: Point[] = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
];
const RECT_CW: Point[] = [
  [0, 0],
  [0, 3],
  [4, 3],
  [4, 0],
];

describe('polygonAreaM2', () => {
  it('computes the enclosed area of a rectangle (shoelace)', () => {
    expect(polygonAreaM2(RECT)).toBeCloseTo(12);
  });

  it('does not depend on winding order or starting vertex', () => {
    expect(polygonAreaM2(RECT_CW)).toBeCloseTo(polygonAreaM2(RECT));
    // Rotating the starting vertex must not change the area.
    const rotated: Point[] = [
      [4, 0],
      [4, 3],
      [0, 3],
      [0, 0],
    ];
    expect(polygonAreaM2(rotated)).toBeCloseTo(12);
  });

  it('handles a non-rectangular polygon', () => {
    // Right triangle with legs 3 and 4 → area 6.
    const triangle: Point[] = [
      [0, 0],
      [3, 0],
      [0, 4],
    ];
    expect(polygonAreaM2(triangle)).toBeCloseTo(6);
  });

  it('returns 0 for degenerate polygons', () => {
    expect(polygonAreaM2([])).toBe(0);
    const one: Point[] = [[0, 0]];
    expect(polygonAreaM2(one)).toBe(0);
    const two: Point[] = [
      [0, 0],
      [1, 1],
    ];
    expect(polygonAreaM2(two)).toBe(0);
  });
});

describe('planAreaM2', () => {
  it('sums the areas of all rooms in the plan', () => {
    const roomB: Point[] = [
      [5, 0],
      [7, 0],
      [7, 2],
      [5, 2],
    ];
    const plan: FloorPlan = {
      unit: 'meters',
      walls: [],
      rooms: [
        { id: 'r1', label: 'A', polygon: RECT, confidence: 1 },
        { id: 'r2', label: 'B', polygon: roomB, confidence: 1 },
      ],
      openings: [],
    };
    expect(planAreaM2(plan)).toBeCloseTo(16); // 12 + 4
  });

  it('returns null for walls-only plans (no closed room polygon)', () => {
    const plan: FloorPlan = {
      unit: 'meters',
      walls: [{ id: 'w1', from: [0, 0], to: [3, 0], confidence: 0.5 }],
      rooms: [],
      openings: [],
    };
    expect(planAreaM2(plan)).toBeNull();
  });
});

describe('formatAreaM2', () => {
  it('formats with one decimal below 100 m² and whole meters above', () => {
    expect(formatAreaM2(13.047)).toBe('≈ 13.0 m²');
    expect(formatAreaM2(120.4)).toBe('≈ 120 m²');
  });

  it('returns null when no area can be shown', () => {
    expect(formatAreaM2(null)).toBeNull();
    expect(formatAreaM2(0)).toBeNull();
    expect(formatAreaM2(Number.NaN)).toBeNull();
  });
});
