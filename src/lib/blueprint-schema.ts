/**
 * Floor plan data model shared by the AI provider, the response validator, and the
 * SVG renderer.
 *
 * Coordinate system: top-down view in meters. Origin at the top-left corner of the
 * plan bounding box; x increases to the right, y increases downward. All dimensions
 * are estimates produced by the vision model — treat them as approximate.
 */

/** A 2D point `[x, y]` in meters. */
export type Point = readonly [number, number];

/** A straight wall segment between two endpoints. */
export interface BlueprintWall {
  id: string;
  from: Point;
  to: Point;
  /** Estimated length in meters. */
  lengthM?: number;
  /** 0..1 — model confidence that this wall exists. */
  confidence: number;
}

/** A labeled room area as a closed polygon. */
export interface BlueprintRoom {
  id: string;
  label: string;
  polygon: Point[];
  confidence: number;
}

export type OpeningType = 'door' | 'window';

/** A door or window placed on a wall. */
export interface BlueprintOpening {
  id: string;
  type: OpeningType;
  /** The wall this opening belongs to (a `BlueprintWall.id`). */
  wallId: string;
  /** Fractional position along the wall: 0 = `from` endpoint, 1 = `to` endpoint. */
  positionT?: number;
  /** Estimated width in meters. */
  widthM?: number;
  confidence: number;
}

/** A complete floor plan extracted from photos. */
export interface FloorPlan {
  unit: 'meters';
  walls: BlueprintWall[];
  rooms: BlueprintRoom[];
  openings: BlueprintOpening[];
  /** Free-form caveats from the model (assumptions, ambiguities). */
  notes?: string;
}

const pointSchema = {
  type: 'array',
  items: { type: 'number' },
  minItems: 2,
  maxItems: 2,
} as const;

/** JSON Schema sent to the AI provider as the required response shape. */
export const floorPlanJsonSchema = {
  type: 'object',
  properties: {
    unit: { type: 'string', enum: ['meters'] },
    walls: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          from: pointSchema,
          to: pointSchema,
          lengthM: { type: 'number' },
          confidence: { type: 'number' },
        },
        required: ['id', 'from', 'to', 'confidence'],
      },
    },
    rooms: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          polygon: { type: 'array', items: pointSchema },
          confidence: { type: 'number' },
        },
        required: ['id', 'label', 'polygon', 'confidence'],
      },
    },
    openings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: ['door', 'window'] },
          wallId: { type: 'string' },
          positionT: { type: 'number' },
          widthM: { type: 'number' },
          confidence: { type: 'number' },
        },
        required: ['id', 'type', 'wallId', 'confidence'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['unit', 'walls', 'rooms', 'openings'],
} as const;

/** Raised when the AI response does not match the floor plan schema. */
export class FloorPlanValidationError extends Error {}

function isPoint(value: unknown): value is Point {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === 'number' && Number.isFinite(part))
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readString(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function readFiniteNumber(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Validates raw AI output against the floor plan schema and normalizes it.
 * Malformed individual entries are dropped (with their neighbors kept); a response
 * missing one of the top-level arrays throws FloorPlanValidationError.
 */
export function validateFloorPlan(raw: unknown): FloorPlan {
  const root = asRecord(raw);
  if (root === null) {
    throw new FloorPlanValidationError('The AI response is not a JSON object.');
  }

  const walls: BlueprintWall[] = [];
  if (!Array.isArray(root.walls)) {
    throw new FloorPlanValidationError(
      'The AI response is missing the "walls" array.',
    );
  }
  for (const [index, entry] of root.walls.entries()) {
    const record = asRecord(entry);
    if (record === null) continue;
    const from = record.from;
    const to = record.to;
    if (!isPoint(from) || !isPoint(to)) continue;
    if (from[0] === to[0] && from[1] === to[1]) continue; // degenerate zero-length wall
    walls.push({
      id: readString(record, 'id') ?? `wall-${index}`,
      from,
      to,
      lengthM: readFiniteNumber(record, 'lengthM'),
      confidence: clamp01(readFiniteNumber(record, 'confidence') ?? 0.5),
    });
  }

  const rooms: BlueprintRoom[] = [];
  if (!Array.isArray(root.rooms)) {
    throw new FloorPlanValidationError(
      'The AI response is missing the "rooms" array.',
    );
  }
  for (const [index, entry] of root.rooms.entries()) {
    const record = asRecord(entry);
    if (record === null) continue;
    if (!Array.isArray(record.polygon)) continue;
    const polygon = record.polygon.filter(isPoint);
    if (polygon.length < 3) continue; // need at least a triangle to enclose an area
    rooms.push({
      id: readString(record, 'id') ?? `room-${index}`,
      label: readString(record, 'label') ?? `Room ${index + 1}`,
      polygon,
      confidence: clamp01(readFiniteNumber(record, 'confidence') ?? 0.5),
    });
  }

  const wallIds = new Set(walls.map((wall) => wall.id));
  const openings: BlueprintOpening[] = [];
  if (!Array.isArray(root.openings)) {
    throw new FloorPlanValidationError(
      'The AI response is missing the "openings" array.',
    );
  }
  for (const [index, entry] of root.openings.entries()) {
    const record = asRecord(entry);
    if (record === null) continue;
    const type = readString(record, 'type');
    const wallId = readString(record, 'wallId');
    if ((type !== 'door' && type !== 'window') || wallId === undefined)
      continue;
    if (!wallIds.has(wallId)) continue; // opening on an unknown wall — drop it
    const positionT = readFiniteNumber(record, 'positionT');
    openings.push({
      id: readString(record, 'id') ?? `opening-${index}`,
      type,
      wallId,
      positionT:
        positionT === undefined
          ? undefined
          : Math.min(1, Math.max(0, positionT)),
      widthM: readFiniteNumber(record, 'widthM'),
      confidence: clamp01(readFiniteNumber(record, 'confidence') ?? 0.5),
    });
  }

  const notes = readString(root, 'notes');

  return { unit: 'meters', walls, rooms, openings, notes };
}

// ---------------------------------------------------------------------------
// Geometry helpers (shared by the SVG renderer and the file exporters)
// ---------------------------------------------------------------------------

export interface PlanBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of all wall endpoints and room polygon points, or null when empty. */
export function planBounds(plan: FloorPlan): PlanBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const absorb = (point: Point) => {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return;
    minX = Math.min(minX, point[0]);
    minY = Math.min(minY, point[1]);
    maxX = Math.max(maxX, point[0]);
    maxY = Math.max(maxY, point[1]);
  };

  for (const wall of plan.walls) {
    absorb(wall.from);
    absorb(wall.to);
  }
  for (const room of plan.rooms) {
    for (const point of room.polygon) absorb(point);
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxY)) return null;
  return { minX, minY, maxX, maxY };
}

/** Arithmetic centroid of a polygon's vertices. */
export function polygonCentroid(polygon: Point[]): Point {
  let x = 0;
  let y = 0;
  for (const point of polygon) {
    x += point[0];
    y += point[1];
  }
  const count = Math.max(polygon.length, 1);
  return [x / count, y / count];
}

/** A point at fractional position `t` along a wall (0 = from, 1 = to). */
export function pointOnWall(
  from: Point,
  to: Point,
  t: number,
): [number, number] {
  return [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
}
