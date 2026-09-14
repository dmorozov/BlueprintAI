import { describe, expect, it } from 'vitest';

import { VIRO_STYLE_COLLISION_KEYS, viroSafeStyle } from '@/lib/viro-interop';

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
