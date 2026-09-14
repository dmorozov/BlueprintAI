import type { FloorPlan } from '@/lib/blueprint-schema';

import { encodePng } from '@/lib/png-encoder';
import { rasterizePlan } from '@/lib/plan-rasterizer';

/** Raised for any gallery-save failure with a user-presentable message. */
export class GallerySaveError extends Error {}

type FileSystemModule = typeof import('expo-file-system');
type MediaLibraryModule = typeof import('expo-media-library');

function slugify(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug !== '' ? slug : 'room';
}

/**
 * Loads the native-module-backed Expo packages dynamically. A static import would throw
 * at bundle-evaluation time in builds that lack the native module (Expo Go or a stale
 * dev client: "Cannot find native module 'ExpoMediaLibraryNext'") — and because
 * expo-router evaluates every route's module graph when the app starts, that would take
 * down the whole blueprint route. Dynamic import keeps the failure local to this call.
 */
async function loadNativeModules(): Promise<{
  fileSystem: FileSystemModule;
  mediaLibrary: MediaLibraryModule;
}> {
  try {
    const [fileSystem, mediaLibrary] = await Promise.all([
      import('expo-file-system'),
      import('expo-media-library'),
    ]);
    return { fileSystem, mediaLibrary };
  } catch {
    throw new GallerySaveError(
      'Saving to the photo library is unavailable in this app build. Rebuild the development client (e.g. `npx expo run:android`) and try again.',
    );
  }
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
  const { fileSystem, mediaLibrary } = await loadNativeModules();

  let file: InstanceType<FileSystemModule['File']>;
  try {
    const raster = rasterizePlan(plan);
    const png = encodePng(raster.width, raster.height, raster.rgba);
    file = new fileSystem.File(
      fileSystem.Paths.cache,
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
    permission = await mediaLibrary.requestPermissionsAsync(true);
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
    await mediaLibrary.Asset.create(file.uri);
  } catch (error) {
    throw new GallerySaveError(
      `Saving to the photo library failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}
