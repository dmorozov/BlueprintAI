import type { ArTap } from '@/lib/ar-engine';

import { plane, point } from './ticket-19-taps';

// Real taps on the S22 Ultra (step 5, Viro 3.0.3, 2026-11-07) around the two times
// "The floor moved" refused a corner. In both, ARCore's map had moved: the floor
// planes and the feature/depth points under the refused taps agreed with each other,
// not with the room's floor height. Plane hits are upward-facing floor planes.

/** Event 2, corner 1: the floor plane and a point agree; it locks the room at −1.104. */
export const SHIFT_LOCK: ArTap = {
  camera: [0.292, 0.002, -0.354],
  hits: [plane([0.422, -1.104, -0.912]), point([0.423, -1.132, -0.925])],
};
export const SHIFT_LOCK_FLOOR_Y = -1.104;
/** Event 2, corner 2, 5 s later: the floor still at the room's height. */
export const SHIFT_CORNER_2: ArTap = {
  camera: [0.565, 0.069, -0.12],
  hits: [plane([1.394, -1.102, -0.203]), point([1.378, -1.085, -0.197])],
};
/**
 * Event 2, 28 s later with no tracking loss in between: the floor plane and the point
 * under the tap both 17 cm below the room's height.
 */
export const SHIFTED_FLOOR: ArTap = {
  camera: [0.307, -0.059, -0.157],
  hits: [plane([0.296, -1.275, -0.992]), point([0.3, -1.285, -0.991])],
};

/** Event 1: the room locked its floor at −0.917 (plane and points agreed). */
export const STACKED_LOCK_FLOOR_Y = -0.917;
/**
 * Event 1, 22 s after the lock: stale floor planes stacked along one line of sight,
 * none within 10 cm of the room's height; the points sit with the lower planes.
 */
export const STACKED_FLOORS: ArTap = {
  camera: [0.426, -0.082, -0.163],
  hits: [
    point([0.311, -0.993, -0.481]),
    plane([0.308, -1.023, -0.492]),
    plane([0.307, -1.024, -0.492]),
    plane([0.293, -1.14, -0.533]),
    point([0.299, -1.122, -0.528]),
    plane([0.134, -2.404, -0.975]),
  ],
};
