import {
  floorPlanJsonSchema,
  planBounds,
  validateFloorPlan,
  type FloorPlan,
  type Point,
} from '@/lib/blueprint-schema';

/**
 * AI providers for photo → floor plan.
 *
 * Two implementations:
 * - `gemini` — Google Gemini's Interactions API (`POST /v1beta/interactions`) with
 *   structured JSON output; request/response shapes verified against the official docs
 *   and the first-party `@google/genai` SDK types (model name from the current pricing page).
 * - `mock` — local sample plans with simulated latency, so the full capture → analyze →
 *   render flow can be tested without an API key or network access.
 *
 * Selection: `EXPO_PUBLIC_AI_PROVIDER=mock|gemini` forces one; by default Gemini is used
 * when `EXPO_PUBLIC_GEMINI_API_KEY` is set and the mock otherwise. The active provider is
 * shown on the blueprint screen so mock results are never mistaken for real ones.
 *
 * Prototype note: EXPO_PUBLIC_* values are inlined into the client bundle. That is fine
 * for a prototype; move the AI call behind a small backend proxy before any real
 * deployment (see docs/research/blueprint-from-photos.md, §5 risks).
 */

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/interactions';
const GEMINI_MODEL = 'gemini-3.8-flash';

/** Raised for any AI-side failure with a user-presentable message. */
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
  readonly id: 'gemini' | 'mock';
  generateFloorPlan(photos: PhotoPayload[]): Promise<FloorPlan>;
  generateCombinedPlan(rooms: CombinedRoomInput[]): Promise<FloorPlan>;
}

function getApiKey(): string | null {
  const key = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  return key !== undefined && key !== '' ? key : null;
}

// ---------------------------------------------------------------------------
// Gemini provider
// ---------------------------------------------------------------------------

type GeminiInputPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mime_type: string };

const SYSTEM_INSTRUCTION = [
  'You are an architectural floor-plan extraction engine.',
  'You receive photos of a single room (or a photo of a paper floor-plan drawing) taken from several angles.',
  'Produce a top-down 2D floor plan as JSON that exactly matches the required schema.',
  '',
  'Coordinate system: meters. Origin at the top-left corner of the plan bounding box; x increases to the right, y increases downward. Round all coordinates to two decimals.',
  '',
  'walls: every wall segment of the room as a straight line between two endpoints. Split walls at corners and where doors or windows interrupt them. Keep the scale consistent across all elements.',
  'rooms: one closed polygon per distinct room area; for a single-room capture produce exactly one polygon approximating the outer boundary, following the wall lines.',
  'openings: every door and window. Associate each with a wall via wallId; positionT is the fractional distance along that wall from its "from" endpoint (0..1); widthM is the estimated width (typical interior door 0.8-0.9 m, window 0.6-1.5 m).',
  'lengthM: estimated length of each wall in meters.',
  '',
  'Estimate real-world scale from common interior references (door height ~2 m, door width ~0.8-0.9 m, typical room proportions). All dimensions are estimates: set confidence per element (1.0 clearly visible, 0.5 inferred from context, <=0.3 guessed).',
  'Only include elements you can see or strongly infer from the photos; never invent walls, doors, windows, or rooms that the images do not support.',
  'If the input is a photo of a paper floor-plan drawing, transcribe the drawn walls, rooms, and openings into the same schema.',
  'Use "notes" for anything ambiguous (assumptions, missing information, low-confidence areas).',
].join('\n');

const COMBINED_SYSTEM_INSTRUCTION = [
  'You are an architectural floor-plan assembler.',
  'You receive the extracted floor plans (JSON) of several rooms, plus up to a few reference photos per room.',
  'Assemble them into ONE coherent combined floor plan as JSON that exactly matches the required schema.',
  '',
  'Rules:',
  '- Use one consistent meter coordinate system for the whole layout (x right, y down).',
  '- Align shared walls: where two rooms are adjacent, their common wall must be a single line at identical coordinates.',
  '- Connect doorways between rooms where the photos or plans indicate them; keep every room polygon and its label.',
  '- If you cannot determine how two rooms connect, place them with a small gap (0.3-0.5 m) and explain in notes.',
  '- Preserve per-element confidence; lower it for geometry you had to guess during assembly.',
].join('\n');

/** Cost control: combined calls include at most this many photos per room. */
const COMBINED_PHOTOS_PER_ROOM = 3;

function buildUserPrompt(photoCount: number): string {
  return `Here are ${photoCount} photo${photoCount === 1 ? '' : 's'} of the space. Extract its floor plan as JSON matching the required schema.`;
}

function buildCombinedPrompt(rooms: CombinedRoomInput[]): string {
  const sections = rooms.map((room, index) => {
    const planText =
      room.plan !== null
        ? JSON.stringify(room.plan)
        : '(no per-room plan available — derive this room from its photos)';
    return `Room ${index + 1} "${room.label}":\n${planText}`;
  });
  return [
    `Assemble these ${rooms.length} rooms into one combined floor plan as JSON matching the required schema.`,
    '',
    sections.join('\n\n'),
  ].join('\n');
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface GeminiInteractionResponse {
  output_text?: string;
  errors?: { message?: string }[];
}

/** Runs one Interactions API call with structured JSON output and validates it. */
async function callGemini(
  apiKey: string,
  systemInstruction: string,
  parts: GeminiInputPart[],
): Promise<FloorPlan> {
  let response: Response;
  try {
    response = await fetch(GEMINI_API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        model: GEMINI_MODEL,
        system_instruction: systemInstruction,
        input: parts,
        response_format: {
          type: 'text',
          mime_type: 'application/json',
          schema: floorPlanJsonSchema,
        },
      }),
    });
  } catch (error) {
    throw new AiProviderError(
      `Network error while contacting the AI service: ${errorMessage(error)}`,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new AiProviderError(
      `AI request failed with HTTP ${response.status}. ${truncate(detail, 300)}`.trim(),
    );
  }

  const data = (await response.json()) as GeminiInteractionResponse;
  const apiErrors = (data.errors ?? [])
    .map((entry) => entry.message)
    .filter((message): message is string => message !== undefined);
  if (apiErrors.length > 0) {
    throw new AiProviderError(
      `AI service error: ${truncate(apiErrors.join(' | '), 300)}`,
    );
  }
  if (typeof data.output_text !== 'string' || data.output_text.trim() === '') {
    throw new AiProviderError(
      'The AI service returned an empty response. Try again.',
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data.output_text);
  } catch {
    throw new AiProviderError(
      'The AI response was not valid JSON. Try again or retake the photos.',
    );
  }

  return validateFloorPlan(parsed);
}

function requireApiKey(): string {
  const apiKey = getApiKey();
  if (apiKey === null) {
    throw new AiProviderError(
      'No Gemini API key configured. Add EXPO_PUBLIC_GEMINI_API_KEY to .env.local and restart the dev server — or set EXPO_PUBLIC_AI_PROVIDER=mock to test with a sample plan.',
    );
  }
  return apiKey;
}

const geminiProvider: FloorPlanProvider = {
  id: 'gemini',
  async generateFloorPlan(photos) {
    const parts: GeminiInputPart[] = [
      { type: 'text', text: buildUserPrompt(photos.length) },
      ...photos.map((photo) => ({
        type: 'image' as const,
        data: photo.base64,
        mime_type: photo.mimeType,
      })),
    ];
    return callGemini(requireApiKey(), SYSTEM_INSTRUCTION, parts);
  },
  async generateCombinedPlan(rooms) {
    const parts: GeminiInputPart[] = [
      { type: 'text', text: buildCombinedPrompt(rooms) },
    ];
    for (const room of rooms) {
      for (const photo of room.photos.slice(0, COMBINED_PHOTOS_PER_ROOM)) {
        parts.push({
          type: 'image',
          data: photo.base64,
          mime_type: photo.mimeType,
        });
      }
    }
    return callGemini(requireApiKey(), COMBINED_SYSTEM_INSTRUCTION, parts);
  },
};

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
    notes: `Mock floor plan generated locally for testing (analyzed ${photoCount} photo${photoCount === 1 ? '' : 's'}). Set EXPO_PUBLIC_GEMINI_API_KEY to use the real AI provider.`,
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
    notes: `Mock combined layout — ${rooms.length} room${rooms.length === 1 ? '' : 's'} placed side by side for testing. Set EXPO_PUBLIC_GEMINI_API_KEY to use the real AI assembler.`,
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
 * Resolves the active provider. `EXPO_PUBLIC_AI_PROVIDER` forces one; otherwise Gemini
 * is used when a key is configured and the mock provider otherwise (so the full flow
 * works out of the box for testing).
 */
export function activeProvider(): FloorPlanProvider {
  const forced = process.env.EXPO_PUBLIC_AI_PROVIDER;
  if (forced === 'mock') return mockProvider;
  if (forced === 'gemini') return geminiProvider;
  return getApiKey() !== null ? geminiProvider : mockProvider;
}

/**
 * Generates a floor plan for one room's photos using the active provider.
 * Throws AiProviderError with a user-presentable message on any failure.
 */
export async function generateFloorPlan(
  photos: PhotoPayload[],
): Promise<FloorPlan> {
  return activeProvider().generateFloorPlan(photos);
}

/**
 * Assembles several rooms into one combined floor plan using the active provider.
 * Throws AiProviderError with a user-presentable message on any failure.
 */
export async function generateCombinedPlan(
  rooms: CombinedRoomInput[],
): Promise<FloorPlan> {
  return activeProvider().generateCombinedPlan(rooms);
}
