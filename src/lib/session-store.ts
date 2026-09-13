import type { FloorPlan } from '@/lib/blueprint-schema';
import type { ProcessedPhoto } from '@/lib/image-pipeline';
import type { RoomPlacement } from '@/lib/plan-transform';

/**
 * In-memory session store for rooms, their photos, and generated floor plans.
 * Everything lives here between screens for the lifetime of the app session
 * (cleared on reload — acceptable for a prototype; persistent storage is Phase 3).
 */
/** How a room's stored plan was produced (null when it has no plan yet). */
export type PlanSource = 'ar-tap' | 'photo-assist';

interface RoomSession {
  label: string;
  photos: ProcessedPhoto[];
  plan: FloorPlan | null;
  /**
   * How the stored plan was produced. 'ar-tap' = on-device AR tap-to-trace (real
   * measurements); 'photo-assist' = self-hosted MoGe suggestions the user confirmed
   * (auto-detected — verify). Null for mock-provider plans and rooms without a plan.
   * Drives UI labeling: photo-assist plans must never be presented as AR-measured.
   */
  planSource: PlanSource | null;
  /**
   * Frame-group id of the room's stored plan. For 'ar-tap' plans this is the AR
   * session that measured them — rooms sharing an id live in one tracking frame and
   * can be merged into a combined plan without alignment. Photo-assist plans get a
   * unique per-room id (each photo frame is unrelated to every other), so they join
   * the combined blueprint only via manual alignment. Null for mock plans.
   */
  arSessionId: string | null;
  /**
   * Manual placement of this room in the combined frame, set via the align editor for
   * rooms measured in a DIFFERENT AR session than the ones they are combined with.
   * Null when the room needs no manual alignment (same-frame merge or not yet aligned).
   */
  placement: RoomPlacement | null;
  createdAt: number;
}

/** Summary of a room for list views. */
export interface RoomSummary {
  id: string;
  label: string;
  photoCount: number;
  hasPlan: boolean;
  planSource: PlanSource | null;
  arSessionId: string | null;
  createdAt: number;
}

const rooms = new Map<string, RoomSession>();

/** Creates a new room session (auto-labeled "Room N" unless given a label). */
export function createRoom(label?: string): string {
  const id = `room-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const fallbackLabel = `Room ${rooms.size + 1}`;
  rooms.set(id, {
    label: label !== undefined && label !== '' ? label : fallbackLabel,
    photos: [],
    plan: null,
    planSource: null,
    arSessionId: null,
    placement: null,
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

/**
 * Stores (or clears, with null) the generated plan for a room. Clearing the plan also
 * clears its source — a source without a plan is meaningless. Storing a plan does NOT
 * set the source; flows call setPlanSource explicitly so mock generations stay null.
 */
export function setPlan(roomId: string, plan: FloorPlan | null): void {
  const room = rooms.get(roomId);
  if (room !== undefined) {
    room.plan = plan;
    if (plan === null) room.planSource = null;
  }
}

/** Records how the room's stored plan was produced (no-op for unknown rooms). */
export function setPlanSource(roomId: string, source: PlanSource | null): void {
  const room = rooms.get(roomId);
  if (room !== undefined) {
    room.planSource = source;
  }
}

/** How the room's stored plan was produced, or null (mock / no plan). */
export function getPlanSource(roomId: string): PlanSource | null {
  return rooms.get(roomId)?.planSource ?? null;
}

/** The room's stored plan, or null when none has been generated yet. */
export function getPlan(roomId: string): FloorPlan | null {
  return rooms.get(roomId)?.plan ?? null;
}

/** Records which AR session measured the room's plan (no-op for unknown rooms). */
export function setArSession(roomId: string, arSessionId: string): void {
  const room = rooms.get(roomId);
  if (room !== undefined) {
    room.arSessionId = arSessionId;
  }
}

/**
 * The frame-group id of the room's stored plan, or null when it has none (mock plans
 * and unmeasured rooms). Non-null for both AR-measured and photo-assist plans — use
 * getPlanSource to tell them apart.
 */
export function getArSession(roomId: string): string | null {
  return rooms.get(roomId)?.arSessionId ?? null;
}

/** Stores (or clears, with null) the room's manual placement in the combined frame. */
export function setPlacement(
  roomId: string,
  placement: RoomPlacement | null,
): void {
  const room = rooms.get(roomId);
  if (room !== undefined) {
    room.placement = placement;
  }
}

/** The room's manual placement in the combined frame, or null when not aligned. */
export function getPlacement(roomId: string): RoomPlacement | null {
  return rooms.get(roomId)?.placement ?? null;
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
      planSource: room.planSource,
      arSessionId: room.arSessionId,
      createdAt: room.createdAt,
    });
  }
  return summaries.sort((a, b) => b.createdAt - a.createdAt);
}

/** Deletes a room and its photos/plan. */
export function deleteRoom(roomId: string): void {
  rooms.delete(roomId);
}
