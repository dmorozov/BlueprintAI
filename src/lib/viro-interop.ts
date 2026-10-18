import type { ViroARHitTestResult } from '@reactvision/react-viro';
import type { StyleProp, ViewStyle } from 'react-native';

import type { ArHit, Vec3 } from '@/lib/ar-engine';

/**
 * ViroReact on Android ships legacy (pre-Fabric) view managers. Under RN 0.86's
 * new architecture they are rendered through the legacy-view-manager interop
 * layer, which forwards a component's style keys as top-level native view props.
 *
 * Viro's scene view managers declare 3D scene props whose names collide with CSS
 * layout props — most importantly `position` (a `[x, y, z]` number array on the
 * native side). Passing `style={{ position: 'absolute' }}` to a Viro component
 * therefore sends the string `"absolute"` into the native
 * `setPosition(ReadableArray)` setter and crashes the view update with
 * `java.lang.String cannot be cast to com.facebook.react.bridge.ReadableArray`
 * (RedBox: "Error while updating property 'position' of a view managed by:
 * VRTARScene").
 *
 * Rule: never pass a colliding key in a style attached to a Viro component.
 * Express layout intent on a plain RN wrapper View instead, and route any style
 * that does reach a Viro component through {@link viroSafeStyle} as a guard.
 */
export const VIRO_STYLE_COLLISION_KEYS: readonly string[] = ['position'];

const collisionSet = new Set<string>(VIRO_STYLE_COLLISION_KEYS);

/**
 * Returns a copy of `style` with keys that collide with Viro native view props
 * removed (see module docs). Accepts any RN style shape, including arrays.
 * Non-colliding keys are preserved as-is; the input is never mutated.
 */
export function viroSafeStyle(style?: StyleProp<ViewStyle>): ViewStyle {
  if (style == null) return {};
  const flat = Array.isArray(style)
    ? style.filter((entry): entry is ViewStyle => entry != null)
    : [style];
  const result: Record<string, unknown> = {};
  for (const entry of flat) {
    for (const [key, value] of Object.entries(entry)) {
      if (!collisionSet.has(key)) result[key] = value;
    }
  }
  return result as ViewStyle;
}

/**
 * Converts a React Native touch location into the point that
 * `ViroARScene.performARHitTestWithPoint` expects.
 *
 * On Android, Viro's bridge forwards `x`/`y` unscaled (as `int`s) into
 * `ViroViewARCore.performARHitTest(Point)`, and the renderer hit-tests against
 * ARCore's display geometry, which is set from the GL surface size in physical
 * pixels. RN touch locations are density-independent, so without scaling every tap
 * hit-tests a point pulled toward the top-left corner by the pixel ratio. Rounded
 * because the native parameters are ints (the bridge would otherwise truncate).
 *
 * On iOS, UIKit/ARKit take view points, which already equal RN units, so the
 * location passes through unchanged (not device-verified: Viro ships no iOS sources).
 */
export function viroHitTestPoint(
  location: { locationX: number; locationY: number },
  platform: { os: string; pixelRatio: number },
): [number, number] {
  if (platform.os !== 'android') {
    return [location.locationX, location.locationY];
  }
  return [
    Math.round(location.locationX * platform.pixelRatio),
    Math.round(location.locationY * platform.pixelRatio),
  ];
}

/**
 * A plane hit whose pose is tilted less than this (pitch and roll, degrees) is
 * horizontal: ARCore gives a horizontal plane's pose a yaw only and a wall's a 90°
 * tilt. Not yet checked against rotations recorded on the phone.
 */
const HORIZONTAL_TILT_DEG = 15;

/**
 * Maps one of Viro's hit-test results to the AR engine seam's hit, or null for a hit
 * the app must not use.
 *
 * On Android, Viro labels an ARCore plane hit inside the detected plane
 * `ExistingPlaneUsingExtent`, a hit on the plane's unbounded extension
 * `EstimatedHorizontalPlane` (walls included, despite the name) and anything else
 * `FeaturePoint` (virocore v2.58.1, `VROARFrameARCore::hitTest`). ARCore's depth hits
 * also arrive as `FeaturePoint`: Viro's `acquireTrackable` returns no trackable for
 * anything but a plane, so its `DepthPoint` branch never runs (through 3.0.3).
 * `ExistingPlane` is iOS-only: ARKit's plane without its extent (not device-verified).
 * Unbounded planes are dropped because they continue behind walls and furniture: a
 * tap low on a wall can hit the floor's extension behind it.
 */
export function toArHit(result: ViroARHitTestResult): ArHit | null {
  const position = result.transform.position as Vec3;
  if (result.type === 'FeaturePoint' || result.type === 'DepthPoint') {
    return { kind: 'point', position, facesUp: false };
  }
  if (result.type !== 'ExistingPlaneUsingExtent') return null;
  const [pitch, , roll] = result.transform.rotation;
  return {
    kind: 'plane',
    position,
    facesUp:
      Math.abs(pitch) < HORIZONTAL_TILT_DEG &&
      Math.abs(roll) < HORIZONTAL_TILT_DEG,
  };
}
