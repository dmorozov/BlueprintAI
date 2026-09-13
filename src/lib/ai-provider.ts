import {
  planBounds,
  validateFloorPlan,
  type FloorPlan,
  type Point,
} from '@/lib/blueprint-schema';

/**
 * Floor-plan providers.
 *
 * The Gemini cloud provider was removed per docs/research/floorplan-no-external-api-plan.md
 * (Phase 1): real dimensions now come from on-device AR tap-to-trace capture
 * (src/lib/ar-capture.ts), which produces the same FloorPlan shape directly — measured,
 * not estimated. No external API calls remain in the app.
 *
 * The `mock` provider stays for UI development: local sample plans with simulated
 * latency let the full render/export flow be tested without a device in hand. It is
 * also what the legacy photo flow (src/screens/capture-screen.tsx) generates — always
 * labeled "Mock mode" in the UI so it is never mistaken for a real measurement.
 *
 * The FloorPlanProvider interface is kept as the seam where a future self-hosted
 * photo-assist provider (plan Phase 2, e.g. MoGe on your own GPU) would plug in.
 */

/** Raised for any provider-side failure with a user-presentable message. */
export class AiProviderError extends Error {}

interface PhotoPayload {
  base64: string;
  mimeType: string;
}

/** One room's contribution to a combined (multi-room) generation. */
export interface CombinedRoomInput {
  label: string;
  photos: PhotoPayload[];
  /** The room's own generated plan, when one exists (stronger signal than photos). */
  plan: FloorPlan | null;
}

/** A floor plan source. Implementations must return schema-validated plans. */
export interface FloorPlanProvider {
  /** Stable identifier, shown in the UI and useful for logs. */
  readonly id: string;
  generateFloorPlan(photos: PhotoPayload[]): Promise<FloorPlan>;
  generateCombinedPlan(rooms: CombinedRoomInput[]): Promise<FloorPlan>;
}

// ---------------------------------------------------------------------------
// Mock provider (keyless testing)
// ---------------------------------------------------------------------------

const MOCK_LATENCY_MS = { min: 1200, max: 2600 };
const COMBINED_GAP_M = 0.4;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Builds a plausible sample plan: a ~4.2 m × 3.1 m room with a door on the south wall
 * and a window on the east wall, with small per-run jitter so repeated generations look
 * different. Runs through validateFloorPlan as a self-test of the validator.
 */
function buildMockPlan(photoCount: number): FloorPlan {
  const jitter = () => (Math.random() - 0.5) * 0.12; // ±6 cm
  const round2 = (value: number) => Math.round(value * 100) / 100;

  const width = round2(4.2 + jitter());
  const height = round2(3.1 + jitter());

  return validateFloorPlan({
    unit: 'meters',
    walls: [
      {
        id: 'wall-north',
        from: [0, 0],
        to: [width, 0],
        lengthM: width,
        confidence: 0.98,
      },
      {
        id: 'wall-east',
        from: [width, 0],
        to: [width, height],
        lengthM: height,
        confidence: 0.97,
      },
      {
        id: 'wall-south',
        from: [width, height],
        to: [0, height],
        lengthM: width,
        confidence: 0.98,
      },
      {
        id: 'wall-west',
        from: [0, height],
        to: [0, 0],
        lengthM: height,
        confidence: 0.96,
      },
    ],
    rooms: [
      {
        id: 'room-1',
        label: 'Room',
        polygon: [
          [0, 0],
          [width, 0],
          [width, height],
          [0, height],
        ],
        confidence: 0.9,
      },
    ],
    openings: [
      {
        id: 'opening-door',
        type: 'door',
        wallId: 'wall-south',
        positionT: 0.35,
        widthM: 0.85,
        confidence: 0.85,
      },
      {
        id: 'opening-window',
        type: 'window',
        wallId: 'wall-east',
        positionT: 0.5,
        widthM: 1.2,
        confidence: 0.7,
      },
    ],
    notes: `Mock floor plan generated locally for UI testing (analyzed ${photoCount} photo${photoCount === 1 ? '' : 's'}). Use "Measure room with AR" for real measured plans.`,
  });
}

/** Shifts every coordinate of a plan by (dx, dy) and re-prefixes element ids. */
function offsetPlan(
  plan: FloorPlan,
  prefix: string,
  dx: number,
  dy: number,
): FloorPlan {
  const shift = (point: Point): [number, number] => [
    Math.round((point[0] + dx) * 100) / 100,
    Math.round((point[1] + dy) * 100) / 100,
  ];
  return {
    unit: 'meters',
    walls: plan.walls.map((wall) => ({
      ...wall,
      id: `${prefix}-${wall.id}`,
      from: shift(wall.from),
      to: shift(wall.to),
    })),
    rooms: plan.rooms.map((room) => ({
      ...room,
      id: `${prefix}-${room.id}`,
      polygon: room.polygon.map(shift),
    })),
    openings: plan.openings.map((opening) => ({
      ...opening,
      id: `${prefix}-${opening.id}`,
      wallId: `${prefix}-${opening.wallId}`,
    })),
  };
}

/**
 * Mock combined layout: places each room's plan (or a synthesized sample when the room
 * has none yet) side by side with a gap, top-aligned. Clearly labeled as mock in notes.
 */
function buildMockCombinedPlan(rooms: CombinedRoomInput[]): FloorPlan {
  let offsetX = 0;
  const walls: FloorPlan['walls'] = [];
  const roomsOut: FloorPlan['rooms'] = [];
  const openings: FloorPlan['openings'] = [];

  for (const [index, room] of rooms.entries()) {
    const source = room.plan ?? buildMockPlan(room.photos.length);
    const bounds = planBounds(source);
    if (bounds === null) continue;
    const dx = offsetX - bounds.minX;
    const dy = -bounds.minY;
    const shifted = offsetPlan(source, `r${index}`, dx, dy);
    walls.push(...shifted.walls);
    roomsOut.push(...shifted.rooms.map((r) => ({ ...r, label: room.label })));
    openings.push(...shifted.openings);
    offsetX += bounds.maxX - bounds.minX + COMBINED_GAP_M;
  }

  return validateFloorPlan({
    unit: 'meters',
    walls,
    rooms: roomsOut,
    openings,
    notes: `Mock combined layout — ${rooms.length} room${rooms.length === 1 ? '' : 's'} placed side by side for UI testing. Rooms measured in one AR session combine automatically (no AI).`,
  });
}

const mockProvider: FloorPlanProvider = {
  id: 'mock',
  async generateFloorPlan(photos) {
    const latency =
      MOCK_LATENCY_MS.min +
      Math.random() * (MOCK_LATENCY_MS.max - MOCK_LATENCY_MS.min);
    await delay(latency);
    return buildMockPlan(photos.length);
  },
  async generateCombinedPlan(rooms) {
    const latency =
      MOCK_LATENCY_MS.min +
      Math.random() * (MOCK_LATENCY_MS.max - MOCK_LATENCY_MS.min);
    await delay(latency);
    return buildMockCombinedPlan(rooms);
  },
};

// ---------------------------------------------------------------------------
// Provider selection
// ---------------------------------------------------------------------------

/**
 * Resolves the active provider. Only the mock provider exists for now (the Gemini
 * cloud provider was removed in favor of on-device AR capture); a self-hosted
 * photo-assist provider may be added later per the no-external-API plan's Phase 2.
 */
export function activeProvider(): FloorPlanProvider {
  return mockProvider;
}

/**
 * Generates a floor plan for one room's photos using the active provider (mock: a
 * local sample plan — never derived from the photos).
 * Throws AiProviderError with a user-presentable message on any failure.
 */
export async function generateFloorPlan(
  photos: PhotoPayload[],
): Promise<FloorPlan> {
  return activeProvider().generateFloorPlan(photos);
}

/**
 * Assembles several rooms into one combined floor plan using the active provider
 * (mock: a local side-by-side layout).
 * Throws AiProviderError with a user-presentable message on any failure.
 */
export async function generateCombinedPlan(
  rooms: CombinedRoomInput[],
): Promise<FloorPlan> {
  return activeProvider().generateCombinedPlan(rooms);
}
