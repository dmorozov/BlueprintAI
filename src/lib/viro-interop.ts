import type { StyleProp, ViewStyle } from 'react-native';

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
