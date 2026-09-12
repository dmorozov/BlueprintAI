import type { ProcessedPhoto } from '@/lib/image-pipeline';

/**
 * In-memory room session store. Photos live here between the capture and blueprint
 * screens for the lifetime of the app session (cleared on reload — acceptable for a
 * prototype; persistent storage lands in Phase 2 along with export).
 */
interface RoomSession {
  photos: ProcessedPhoto[];
}

const sessions = new Map<string, RoomSession>();

/** Creates a new room session and returns its id. */
export function createRoom(): string {
  const id = `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  sessions.set(id, { photos: [] });
  return id;
}

/** Appends a processed photo to the room (no-op for unknown rooms). */
export function addPhoto(roomId: string, photo: ProcessedPhoto): void {
  const session = sessions.get(roomId);
  if (session !== undefined) {
    session.photos.push(photo);
  }
}

/** Removes a photo by key from the room (no-op when absent). */
export function removePhoto(roomId: string, key: string): void {
  const session = sessions.get(roomId);
  if (session !== undefined) {
    session.photos = session.photos.filter((photo) => photo.key !== key);
  }
}

/** Returns a copy of the room's photos (empty for unknown rooms). */
export function getPhotos(roomId: string): ProcessedPhoto[] {
  return [...(sessions.get(roomId)?.photos ?? [])];
}

/** Whether a room session exists. */
export function hasRoom(roomId: string): boolean {
  return roomId !== '' && sessions.has(roomId);
}
