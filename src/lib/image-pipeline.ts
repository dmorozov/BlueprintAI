import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

/** A captured photo after resize/compression, ready for display and upload. */
export interface ProcessedPhoto {
  /** Stable key within the room session (used as a React list key). */
  key: string;
  /** URI usable directly as an `<Image>` source (cache file on native, data URI on web). */
  uri: string;
  /** Base64 JPEG payload for the AI request (no `data:` prefix). */
  base64: string;
  mimeType: 'image/jpeg';
  width: number;
  height: number;
}

/** The minimum camera-capture fields the pipeline needs. */
export interface CapturedImage {
  uri: string;
  width: number;
  height: number;
}

/**
 * Long-edge target for upload. Keeps wall/door detail while staying well under every
 * vendor's image limits, which keeps per-room API cost and latency low (cost scales
 * with pixel count for all three major vision APIs).
 */
const MAX_LONG_EDGE = 2048;
const JPEG_COMPRESSION = 0.8;

/**
 * Down-scales (never upscales) and re-encodes a captured image as compressed JPEG,
 * returning both a display URI and the base64 payload. Works with file URIs (native)
 * and data URIs (web).
 */
export async function preparePhoto(
  source: CapturedImage,
  key: string,
): Promise<ProcessedPhoto> {
  const context = ImageManipulator.manipulate(source.uri);

  const longEdge = Math.max(source.width, source.height);
  if (longEdge > MAX_LONG_EDGE) {
    const scale = MAX_LONG_EDGE / longEdge;
    context.resize({
      width: Math.round(source.width * scale),
      height: Math.round(source.height * scale),
    });
  }

  const imageRef = await context.renderAsync();
  const saved = await imageRef.saveAsync({
    format: SaveFormat.JPEG,
    compress: JPEG_COMPRESSION,
    base64: true,
  });

  if (saved.base64 === undefined) {
    throw new Error('Image pipeline did not return a base64 payload.');
  }

  return {
    key,
    uri: saved.uri,
    base64: saved.base64,
    mimeType: 'image/jpeg',
    width: saved.width,
    height: saved.height,
  };
}
