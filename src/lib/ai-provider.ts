import {
  floorPlanJsonSchema,
  validateFloorPlan,
  type FloorPlan,
} from '@/lib/blueprint-schema';

/**
 * Cloud AI provider for photo → floor plan.
 *
 * Uses Google Gemini's Interactions API (`POST /v1beta/interactions`) with structured
 * JSON output — the request/response shapes were verified against the official docs and
 * the first-party `@google/genai` SDK types (model name from the current pricing page).
 *
 * Prototype note: the API key is inlined into the client bundle via `EXPO_PUBLIC_*`.
 * That is fine for a prototype; move the call behind a small backend proxy before any
 * real deployment (see docs/research/blueprint-from-photos.md, §5 risks).
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

function getApiKey(): string | null {
  const key = process.env.EXPO_PUBLIC_GEMINI_API_KEY;
  return key !== undefined && key !== '' ? key : null;
}

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

function buildUserPrompt(photoCount: number): string {
  return `Here are ${photoCount} photo${photoCount === 1 ? '' : 's'} of the space. Extract its floor plan as JSON matching the required schema.`;
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

/**
 * Sends the room's photos to the vision model and returns a validated floor plan.
 * Throws AiProviderError with a user-presentable message on any failure.
 */
export async function generateFloorPlan(
  photos: PhotoPayload[],
): Promise<FloorPlan> {
  const apiKey = getApiKey();
  if (apiKey === null) {
    throw new AiProviderError(
      'No Gemini API key configured. Add EXPO_PUBLIC_GEMINI_API_KEY to .env.local and restart the dev server.',
    );
  }

  const input = [
    { type: 'text' as const, text: buildUserPrompt(photos.length) },
    ...photos.map((photo) => ({
      type: 'image' as const,
      data: photo.base64,
      mime_type: photo.mimeType,
    })),
  ];

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
        system_instruction: SYSTEM_INSTRUCTION,
        input,
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
