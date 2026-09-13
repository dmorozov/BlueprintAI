import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PhotoAssistError,
  isPhotoAssistConfigured,
  parseAssistResponse,
  suggestWalls,
} from '@/lib/photo-assist-client';
import type { ProcessedPhoto } from '@/lib/image-pipeline';

const PHOTO: ProcessedPhoto = {
  key: 'photo-1',
  uri: 'file:///cache/photo-1.jpg',
  base64: 'aGVsbG8=',
  mimeType: 'image/jpeg',
  width: 100,
  height: 100,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('isPhotoAssistConfigured', () => {
  it('is false when no service URL is configured', () => {
    expect(isPhotoAssistConfigured()).toBe(false);
  });

  it('is true once a URL is set (trailing slash tolerated)', () => {
    vi.stubEnv('EXPO_PUBLIC_PHOTO_ASSIST_URL', 'http://192.168.1.42:8734/');
    expect(isPhotoAssistConfigured()).toBe(true);
  });
});

describe('parseAssistResponse', () => {
  it('parses a well-formed response', () => {
    const parsed = parseAssistResponse({
      photos: [
        {
          index: 0,
          walls: [{ from: [0, 2], to: [4, 2], lengthM: 4, confidence: 0.7 }],
        },
      ],
      frameNote: 'Per-photo frame…',
    });
    expect(parsed.photos).toHaveLength(1);
    expect(parsed.photos[0]?.walls).toEqual([
      { from: [0, 2], to: [4, 2], lengthM: 4, confidence: 0.7 },
    ]);
    expect(parsed.frameNote).toBe('Per-photo frame…');
  });

  it('drops malformed and degenerate walls but keeps valid ones', () => {
    const parsed = parseAssistResponse({
      photos: [
        {
          index: 0,
          walls: [
            { from: 'nope', to: [1, 1], lengthM: 1, confidence: 0.5 },
            { from: [0, 0], to: [0, 0], lengthM: 0, confidence: 0.5 },
            { from: [NaN, 0], to: [1, 1], lengthM: 1, confidence: 0.5 },
            'garbage',
            { from: [0, 0], to: [3, 4] }, // no lengthM/confidence -> derived
          ],
        },
      ],
    });
    expect(parsed.photos[0]?.walls).toEqual([
      { from: [0, 0], to: [3, 4], lengthM: 5, confidence: 0.5 },
    ]);
  });

  it('clamps confidence into 0..1 and preserves per-photo errors', () => {
    const parsed = parseAssistResponse({
      photos: [
        {
          index: 0,
          walls: [{ from: [0, 0], to: [1, 0], lengthM: 1, confidence: 3 }],
        },
        { index: 1, walls: [], error: 'boom' },
      ],
    });
    expect(parsed.photos[0]?.walls[0]?.confidence).toBe(1);
    expect(parsed.photos[1]?.error).toBe('boom');
  });

  it('throws PhotoAssistError on a malformed envelope', () => {
    expect(() => parseAssistResponse(null)).toThrow(PhotoAssistError);
    expect(() => parseAssistResponse({})).toThrow(PhotoAssistError);
    expect(() => parseAssistResponse({ photos: 'nope' })).toThrow(
      PhotoAssistError,
    );
  });
});

describe('suggestWalls', () => {
  it('refuses to run when no service URL is configured', async () => {
    await expect(suggestWalls([PHOTO])).rejects.toThrow(
      'No photo assist server is configured.',
    );
  });

  it('POSTs the photos and returns the parsed response', async () => {
    vi.stubEnv('EXPO_PUBLIC_PHOTO_ASSIST_URL', 'http://assist.test');
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        photos: [
          {
            index: 0,
            walls: [{ from: [0, 1], to: [2, 1], lengthM: 2, confidence: 0.6 }],
          },
        ],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await suggestWalls([PHOTO]);
    expect(response.photos[0]?.walls).toHaveLength(1);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://assist.test/v1/suggest-walls');
    expect(init?.method).toBe('POST');
    const body = JSON.parse(String(init?.body)) as {
      photos: { base64: string; mimeType: string }[];
    };
    expect(body.photos).toEqual([
      { base64: 'aGVsbG8=', mimeType: 'image/jpeg' },
    ]);
  });

  it('maps HTTP errors to a presentable PhotoAssistError', async () => {
    vi.stubEnv('EXPO_PUBLIC_PHOTO_ASSIST_URL', 'http://assist.test');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 502 }),
    );
    await expect(suggestWalls([PHOTO])).rejects.toThrow(
      'The assist service responded with HTTP 502.',
    );
  });

  it('maps network failures to a presentable PhotoAssistError', async () => {
    vi.stubEnv('EXPO_PUBLIC_PHOTO_ASSIST_URL', 'http://assist.test');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    );
    await expect(suggestWalls([PHOTO])).rejects.toThrow(
      'Could not reach the photo assist server.',
    );
  });

  it('maps timeouts to a presentable PhotoAssistError', async () => {
    vi.stubEnv('EXPO_PUBLIC_PHOTO_ASSIST_URL', 'http://assist.test');
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));
    await expect(suggestWalls([PHOTO])).rejects.toThrow(
      'The assist service took too long to respond.',
    );
  });
});
