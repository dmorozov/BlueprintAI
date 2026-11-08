import type { ArHit, ArTap, Vec3 } from '@/lib/ar-engine';

// Real taps on the S22 Ultra (ticket 19, 2026-10-15): a 3 ft (0.9144 m) tape on the
// floor, each end tapped through the app with depth on, 1.3–2.0 m from the camera.
// Plane hits are the floor plane; points are feature or depth points (Viro reports
// both as FeaturePoint).
export const TAPE_M = 0.9144;
export const plane = (position: Vec3): ArHit => ({
  kind: 'plane',
  position,
  facesUp: true,
});
export const point = (position: Vec3): ArHit => ({
  kind: 'point',
  position,
  facesUp: false,
});

/** Try 1, tape start: the floor plane under the tap. */
export const TRY1_START: ArTap = {
  camera: [-0.469, -0.486, 1.944],
  hits: [plane([-0.883, -1.639, 1.487]), point([-0.878, -1.644, 1.482])],
};
/** Try 1, tape end: the nearest point is 10 cm above the floor (the tape case). */
export const TRY1_END: ArTap = {
  camera: [-0.46, -0.485, 1.947],
  hits: [
    point([-0.237, -1.541, 0.955]),
    point([-0.232, -1.542, 0.967]),
    point([-0.217, -1.636, 0.866]),
  ],
};
/** Try 2, tape start: the floor plane under the tap. */
export const TRY2_START: ArTap = {
  camera: [-0.379, -0.406, 1.985],
  hits: [plane([-0.658, -1.622, 1.268]), point([-0.652, -1.624, 1.266])],
};
/** The floor height of try 2's start tap. */
export const TRY2_FLOOR_Y = -1.622;
/** Try 2, tape end: floor-level points only. */
export const TRY2_END: ArTap = {
  camera: [-0.371, -0.408, 1.99],
  hits: [
    point([0.011, -1.618, 0.631]),
    point([0.004, -1.607, 0.64]),
    point([0.036, -1.697, 0.542]),
  ],
};

/** Try 3, tape start: the nearest point is 26 cm above the floor (the tape case). */
export const TRY3_START: ArTap = {
  camera: [-0.311, -0.364, 1.996],
  hits: [
    point([0.46, -1.358, 0.426]),
    point([0.653, -1.591, 0.058]),
    point([0.679, -1.624, 0.006]),
  ],
};
/** Try 3, tape end: floor-level points only. */
export const TRY3_END: ArTap = {
  camera: [-0.306, -0.371, 2.0],
  hits: [point([0.003, -1.623, 0.603]), point([0.002, -1.612, 0.622])],
};

/**
 * Ticket 19, session 1, after ARCore rebuilt its map: the floor plane at -1.653, behind
 * a point at the height of a stale plane. The tap 2 s before {@link GHOST_FLOOR}.
 */
export const FLOOR_BEFORE_GHOST: ArTap = {
  camera: [-0.158, -0.353, 0.635],
  hits: [
    point([0.434, -1.383, 0.882]),
    plane([0.588, -1.653, 0.947]),
    point([0.602, -1.687, 0.953]),
  ],
};
/**
 * Ticket 19, session 1, after ARCore rebuilt its map: two floor planes 27 cm apart
 * along one line of sight. The room had locked its floor at the lower one.
 */
export const GHOST_FLOOR: ArTap = {
  camera: [-0.165, -0.353, 0.638],
  hits: [
    plane([-0.38, -1.382, 1.487]),
    plane([-0.436, -1.653, 1.71]),
    point([-0.443, -1.688, 1.738]),
  ],
};

/** Wall length in plan, as ArCaptureSession measures it (floor-plane distance). */
export const planDistance = (a: Vec3, b: Vec3) =>
  Math.hypot(a[0] - b[0], a[2] - b[2]);
