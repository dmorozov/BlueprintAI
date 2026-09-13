import type { ProcessedPhoto } from '@/lib/image-pipeline';

/**
 * Thin HTTP client for the self-hosted photo-assist service (no-external-API plan,
 * Phase 2). The service runs MoGe-2 (MIT) on the operator's own GPU and returns
 * candidate wall segments in meters — no third-party API is ever called.
 *
 * Feature-flagged by `EXPO_PUBLIC_PHOTO_ASSIST_URL`: when it is unset, there is no UI
 * entry point anywhere in the app and this module cannot make a request. When set to
 * the LAN address of services/photo-assist, the home screen offers the flow.
 *
 * The response parser is a pure function so it can be unit-tested without a network.
 */

/** Raised for any assist-service failure with a user-presentable message. */
export class PhotoAssistError extends Error {}

/** One suggested wall in the photo's local frame (meters). */
export interface SuggestedWall {
  from: [number, number];
  to: [number, number];
  lengthM: number;
  /** Service-side support score; the plan builder caps it below AR measurements. */
  confidence: number;
}

/** Per-photo result: candidate walls in that photo's camera frame (x right, y forward). */
export interface PhotoSuggestion {
  index: number;
  walls: SuggestedWall[];
  /** Present when the service failed to process this one photo. */
  error?: string;
}

/** Full response of POST /v1/suggest-walls. */
export interface AssistResponse {
  photos: PhotoSuggestion[];
  frameNote?: string;
}

const REQUEST_TIMEOUT_MS = 180_000; // GPU inference is fast; allow CPU fallback/first run

function photoAssistUrl(): string {
  return (process.env.EXPO_PUBLIC_PHOTO_ASSIST_URL ?? '').replace(/\/+$/, '');
}

/** Feature flag: true only when the operator configured a self-hosted service URL. */
export function isPhotoAssistConfigured(): boolean {
  return photoAssistUrl() !== '';
}

function isPoint(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((part) => typeof part === 'number' && Number.isFinite(part))
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Validates the service response envelope. Malformed individual walls are dropped; a
 * malformed top-level shape throws PhotoAssistError (the caller shows a retry UI).
 */
export function parseAssistResponse(raw: unknown): AssistResponse {
  const root = raw as Record<string, unknown> | null;
  if (
    typeof root !== 'object' ||
    root === null ||
    !Array.isArray(root.photos)
  ) {
    throw new PhotoAssistError(
      'The assist service returned a malformed response.',
    );
  }

  const photos: PhotoSuggestion[] = [];
  for (const [i, entry] of (root.photos as unknown[]).entries()) {
    const record = entry as Record<string, unknown> | null;
    if (typeof record !== 'object' || record === null) continue;

    const walls: SuggestedWall[] = [];
    if (Array.isArray(record.walls)) {
      for (const value of record.walls as unknown[]) {
        const w = value as Record<string, unknown>;
        if (typeof w !== 'object' || w === null) continue;
        if (!isPoint(w.from) || !isPoint(w.to)) continue;
        if (w.from[0] === w.to[0] && w.from[1] === w.to[1]) continue; // degenerate
        const lengthM =
          typeof w.lengthM === 'number' && Number.isFinite(w.lengthM)
            ? w.lengthM
            : Math.hypot(w.to[0] - w.from[0], w.to[1] - w.from[1]);
        walls.push({
          from: w.from,
          to: w.to,
          lengthM,
          confidence: clamp01(
            typeof w.confidence === 'number' ? w.confidence : 0.5,
          ),
        });
      }
    }

    photos.push({
      index: typeof record.index === 'number' ? record.index : i,
      walls,
      error: typeof record.error === 'string' ? record.error : undefined,
    });
  }

  return {
    photos,
    frameNote: typeof root.frameNote === 'string' ? root.frameNote : undefined,
  };
}

/**
 * Sends the room's photos to the self-hosted service and returns per-photo wall
 * suggestions. Throws PhotoAssistError with a user-presentable message on any failure.
 */
export async function suggestWalls(
  photos: ProcessedPhoto[],
): Promise<AssistResponse> {
  const url = photoAssistUrl();
  if (url === '') {
    throw new PhotoAssistError('No photo assist server is configured.');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${url}/v1/suggest-walls`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        photos: photos.map((photo) => ({
          base64: photo.base64,
          mimeType: photo.mimeType,
        })),
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new PhotoAssistError(
        `The assist service responded with HTTP ${response.status}.`,
      );
    }
    return parseAssistResponse(await response.json());
  } catch (error) {
    if (error instanceof PhotoAssistError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new PhotoAssistError(
        'The assist service took too long to respond.',
      );
    }
    throw new PhotoAssistError(
      'Could not reach the photo assist server. Is it running and reachable?',
    );
  } finally {
    clearTimeout(timer);
  }
}
