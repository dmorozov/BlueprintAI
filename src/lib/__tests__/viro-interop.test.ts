import { describe, expect, it } from 'vitest';

import {
  VIRO_STYLE_COLLISION_KEYS,
  toArHit,
  viroHitTestPoint,
  viroSafeStyle,
} from '@/lib/viro-interop';

// Same shape as react-native's StyleSheet.absoluteFill (RN itself cannot be
// imported under the node test environment).
const ABSOLUTE_FILL = {
  position: 'absolute' as const,
  left: 0,
  top: 0,
  right: 0,
  bottom: 0,
};

/**
 * Regression guard for the Android RedBox:
 * "Error while updating property 'position' of a view managed by: VRTARScene —
 * java.lang.String cannot be cast to com.facebook.react.bridge.ReadableArray".
 *
 * Under RN 0.86 Fabric, Viro's legacy view managers receive style keys as top-level
 * native props; `position: 'absolute'` then hits Viro's 3D `setPosition(ReadableArray)`
 * setter and crashes. Any style that can reach a Viro component must be free of the
 * colliding keys below.
 */
describe('viroSafeStyle', () => {
  it('strips position from an absoluteFill style (the original crash input)', () => {
    const safe = viroSafeStyle(ABSOLUTE_FILL);
    expect(safe).not.toHaveProperty('position');
    // The remaining layout keys survive so the view still fills its parent.
    expect(safe).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });

  it('keeps non-colliding styles unchanged', () => {
    const style = { flex: 1, opacity: 0.5 };
    expect(viroSafeStyle(style)).toEqual(style);
  });

  it('flattens style arrays and strips colliding keys from every entry', () => {
    const safe = viroSafeStyle([
      { position: 'absolute' as const, left: 0 },
      null,
      { top: 0, flex: 1 },
    ]);
    expect(safe).not.toHaveProperty('position');
    expect(safe).toEqual({ left: 0, top: 0, flex: 1 });
  });

  it('does not mutate its input', () => {
    const style = { position: 'absolute' as const, top: 0 };
    viroSafeStyle(style);
    expect(style).toEqual({ position: 'absolute', top: 0 });
  });

  it('returns an empty object for undefined styles', () => {
    expect(viroSafeStyle(undefined)).toEqual({});
  });

  it('lists every key that must never reach a Viro style', () => {
    // The collision set is the contract: anything added here needs a test above.
    expect(VIRO_STYLE_COLLISION_KEYS).toContain('position');
  });
});

/**
 * Regression guard for AR tap-to-trace corners landing in the wrong place on
 * Android: Viro's bridge forwards the hit-test point unscaled to a renderer that
 * works in physical pixels, while RN touch locations are density-independent.
 */
describe('viroHitTestPoint', () => {
  it('scales an Android touch location to physical pixels', () => {
    expect(
      viroHitTestPoint(
        { locationX: 100, locationY: 200 },
        { os: 'android', pixelRatio: 3 },
      ),
    ).toEqual([300, 600]);
  });

  it('rounds Android points to whole pixels (the native parameters are ints)', () => {
    // 120.4 × 2.8125 = 338.625 → 339; 250.1 × 2.8125 = 703.40625 → 703
    expect(
      viroHitTestPoint(
        { locationX: 120.4, locationY: 250.1 },
        { os: 'android', pixelRatio: 2.8125 },
      ),
    ).toEqual([339, 703]);
  });

  it('passes iOS locations through unchanged (view points already match RN units)', () => {
    expect(
      viroHitTestPoint(
        { locationX: 120.4, locationY: 250.1 },
        { os: 'ios', pixelRatio: 3 },
      ),
    ).toEqual([120.4, 250.1]);
  });
});

describe('toArHit', () => {
  type ViroHitType = Parameters<typeof toArHit>[0]['type'];
  const viroHit = (
    type: ViroHitType,
    rotation: [number, number, number] = [0, 0, 0],
  ) => ({
    type,
    transform: {
      position: [0.5, -1.6, -1] as [number, number, number],
      rotation,
      scale: [1, 1, 1] as [number, number, number],
    },
    hasDepthData: false,
  });

  it('maps a hit inside a detected plane to a plane hit', () => {
    expect(toArHit(viroHit('ExistingPlaneUsingExtent'))).toEqual({
      kind: 'plane',
      position: [0.5, -1.6, -1],
      facesUp: true,
    });
  });

  it('maps feature and depth points to point hits', () => {
    for (const type of ['FeaturePoint', 'DepthPoint'] as const) {
      expect(toArHit(viroHit(type))).toEqual({
        kind: 'point',
        position: [0.5, -1.6, -1],
        facesUp: false,
      });
    }
  });

  it('drops hits on a plane’s unbounded extension, which can lie behind a wall', () => {
    expect(toArHit(viroHit('EstimatedHorizontalPlane'))).toBeNull();
    expect(toArHit(viroHit('ExistingPlane'))).toBeNull();
  });

  // Provisional: ARCore gives a horizontal plane's pose a yaw only and a wall's pose a
  // 90° tilt. Spec step 4 checks this against rotations recorded on the phone.
  it('tells floor-like planes from walls by the hit pose’s tilt', () => {
    const facesUp = (rotation: [number, number, number]) =>
      toArHit(viroHit('ExistingPlaneUsingExtent', rotation))?.facesUp;
    expect(facesUp([0, 37, 0])).toBe(true);
    expect(facesUp([4, -120, -6])).toBe(true);
    expect(facesUp([90, 0, 0])).toBe(false);
    expect(facesUp([0, 15, -90])).toBe(false);
  });
});
