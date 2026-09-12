import type { FloorPlan } from '@/lib/blueprint-schema';
import type { ProcessedPhoto } from '@/lib/image-pipeline';

/**
 * In-memory session store for rooms, their photos, and generated floor plans.
 * Everything lives here between screens for the lifetime of the app session
 * (cleared on reload — acceptable for a prototype; persistent storage is Phase 3).
 */
interface RoomSession {
  label: string;
  photos: ProcessedPhoto[];
  plan: FloorPlan | null;
  createdAt: number;
}

/** Summary of a room for list views. */
export interface RoomSummary {
  id: string;
  label: string;
  photoCount: number;
  hasPlan: boolean;
  createdAt: number;
}

const rooms = new Map<string, RoomSession>();
let combinedPlan: FloorPlan | null = null;

/** Creates a new room session (auto-labeled "Room N" unless given a label). */
export function createRoom(label?: string): string {
  const id = `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const fallbackLabel = `Room ${rooms.size + 1}`;
  rooms.set(id, {
    label: label !== undefined && label !== '' ? label : fallbackLabel,
    photos: [],
    plan: null,
    createdAt: Date.now(),
  });
  return id;
}

/** Renames a room (no-op for unknown rooms or empty labels). */
export function renameRoom(roomId: string, label: string): void {
  const room = rooms.get(roomId);
  if (room !== undefined && label !== '') {
    room.label = label;
  }
}

/** Returns the room's current label, or null for unknown rooms. */
export function getRoomLabel(roomId: string): string | null {
  return rooms.get(roomId)?.label ?? null;
}

/** Appends a processed photo to the room (no-op for unknown rooms). */
export function addPhoto(roomId: string, photo: ProcessedPhoto): void {
  const room = rooms.get(roomId);
  if (room !== undefined) {
    room.photos.push(photo);
  }
}

/** Removes a photo by key from the room (no-op when absent). */
export function removePhoto(roomId: string, key: string): void {
  const room = rooms.get(roomId);
  if (room !== undefined) {
    room.photos = room.photos.filter((photo) => photo.key !== key);
  }
}

/** Returns a copy of the room's photos (empty for unknown rooms). */
export function getPhotos(roomId: string): ProcessedPhoto[] {
  return [...(rooms.get(roomId)?.photos ?? [])];
}

/** Whether a room session exists. */
export function hasRoom(roomId: string): boolean {
  return roomId !== '' && rooms.has(roomId);
}

/** Stores (or clears, with null) the generated plan for a room. */
export function setPlan(roomId: string, plan: FloorPlan | null): void {
  const room = rooms.get(roomId);
  if (room !== undefined) {
    room.plan = plan;
  }
}

/** The room's stored plan, or null when none has been generated yet. */
export function getPlan(roomId: string): FloorPlan | null {
  return rooms.get(roomId)?.plan ?? null;
}

/** All rooms, newest first. */
export function listRooms(): RoomSummary[] {
  const summaries: RoomSummary[] = [];
  for (const [id, room] of rooms) {
    summaries.push({
      id,
      label: room.label,
      photoCount: room.photos.length,
      hasPlan: room.plan !== null,
      createdAt: room.createdAt,
    });
  }
  return summaries.sort((a, b) => b.createdAt - a.createdAt);
}

/** Deletes a room and its photos/plan. */
export function deleteRoom(roomId: string): void {
  rooms.delete(roomId);
}

/** Stores (or clears, with null) the combined multi-room plan. */
export function setCombinedPlan(plan: FloorPlan | null): void {
  combinedPlan = plan;
}

/** The stored combined plan, or null when none has been generated yet. */
export function getCombinedPlan(): FloorPlan | null {
  return combinedPlan;
}
