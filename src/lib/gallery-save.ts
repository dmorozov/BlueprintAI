import { File, Paths } from 'expo-file-system';
import { Asset, requestPermissionsAsync } from 'expo-media-library';

import type { FloorPlan } from '@/lib/blueprint-schema';
import { encodePng } from '@/lib/png-encoder';
import { rasterizePlan } from '@/lib/plan-rasterizer';

/** Raised for any gallery-save failure with a user-presentable message. */
export class GallerySaveError extends Error {}

function slugify(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug !== '' ? slug : 'room';
}

/**
 * Renders a floor plan to a PNG entirely on-device and saves it to the photo library.
 * No network calls: rasterizer + PNG encoder are pure TypeScript (see those modules).
 *
 * Uses the v57 media-library API — `Asset.create(fileUri)`; the legacy
 * `saveToLibraryAsync` is deprecated in SDK 57 and throws at runtime. Permission is
 * requested with `writeOnly: true`, since we only ever add an image.
 */
export async function savePlanToGallery(
  plan: FloorPlan,
  label: string,
): Promise<void> {
  let file: File;
  try {
    const raster = rasterizePlan(plan);
    const png = encodePng(raster.width, raster.height, raster.rgba);
    file = new File(
      Paths.cache,
      `blueprint-${slugify(label)}-${Date.now()}.png`,
    );
    const writer = file.writableStream().getWriter();
    await writer.write(png);
    await writer.close();
  } catch (error) {
    throw new GallerySaveError(
      `Could not render the blueprint image: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let permission;
  try {
    permission = await requestPermissionsAsync(true);
  } catch (error) {
    throw new GallerySaveError(
      `Could not check photo library permission: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (permission.status !== 'granted') {
    throw new GallerySaveError(
      'Permission to save to the photo library was denied. Allow access in system settings, then try again.',
    );
  }

  try {
    await Asset.create(file.uri);
  } catch (error) {
    throw new GallerySaveError(
      `Saving to the photo library failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
