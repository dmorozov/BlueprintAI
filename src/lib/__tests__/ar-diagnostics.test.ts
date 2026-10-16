import { describe, expect, it } from 'vitest';

import {
  AR_LOG_FILTER,
  INITIAL_AR_DIAGNOSTICS,
  applyArLogLine,
  resetEngineDiagnostics,
  deadSessionReason,
  trackingAdvice,
  trackingLostReason,
  type ArDiagnostics,
} from '@/lib/ar-diagnostics';

const OWN = 'com.anonymous.blueprintai';

// Real S22 Ultra lines (logcat -v brief), from a healthy start-up.
const HEALTHY_START = [
  'I/ViroAR  ( 6018): === onAttachedToWindow START ===',
  'I/Viro    ( 6018): ARCore installed on device',
  'I/ViroARCore( 6018): Selected camera config 2: CPU image 1920x1080 (status=0)',
  'I/Viro    ( 6018): AR session resumed',
];

// Healthy sessions log these at error level; none may become a failure.
const HEALTHY_NOISE = [
  'E/native  ( 6018): E0000 00:00:1790132925.1 13423 plane_manager.cc:218] The refinement should not fail. Check why landmarks does not contain any inliers.',
  'E/native  ( 6018): E0000 00:00:1790132925.1 13445 android_data_source.cc:816] [Live DS] Callback list for SENSOR_TYPE_GYROSCOPE_UNCALIBRATED at ordinal 0 not found.',
  'E/native  ( 6018): E0000 00:00:1790132925.1 9743 ralph_kf.cc:433] [Ralph::Initialize] Extended Kalman Filter Correction failed.',
  'E/native  ( 6018): E0000 00:00:1790132925.1 13279 hit_test.cc:427] INTERNAL: No point hit.',
];

function fold(
  lines: string[],
  start: ArDiagnostics = INITIAL_AR_DIAGNOSTICS,
): ArDiagnostics {
  return lines.reduce(
    (diagnostics, line) => applyArLogLine(diagnostics, line, OWN),
    start,
  );
}

describe('AR_LOG_FILTER', () => {
  const filter = new RegExp(AR_LOG_FILTER);

  it('passes every signature line', () => {
    for (const line of [
      ...HEALTHY_START,
      'E/Viro    ( 6018): onRendererFailed [error: ARCORE_NOT_INSTALLED], message [ARCore not installed]',
      'E/native  ( 6018): E0000 android_data_source.cc:1073] Failed to register sensor to queue 0',
      'I/CameraManagerGlobal( 6018): Camera 0 facing CAMERA_FACING_BACK state now CAMERA_STATE_OPEN for client com.sec.android.app.camera API Level 2 User Id 0Device Id 0',
    ]) {
      expect(filter.test(line), line).toBe(true);
    }
  });

  it('drops healthy-session noise', () => {
    for (const line of HEALTHY_NOISE)
      expect(filter.test(line), line).toBe(false);
  });
});

describe('applyArLogLine', () => {
  it('records the start-up milestones in order, once each', () => {
    const diagnostics = fold([...HEALTHY_START, HEALTHY_START[3]!]);
    expect(diagnostics.milestones).toEqual([
      'engine-attached',
      'arcore-ready',
      'session-created',
      'session-resumed',
    ]);
    expect(diagnostics.failure).toBeNull();
  });

  it('never turns healthy-session noise into a failure', () => {
    expect(fold(HEALTHY_NOISE)).toBe(INITIAL_AR_DIAGNOSTICS);
  });

  it('maps Viro startup failures to a reason and keeps the first one', () => {
    const diagnostics = fold([
      'E/Viro    ( 6018): onRendererFailed [error: ARCORE_USER_DECLINED_INSTALL], message [User declined]',
      'E/Viro    ( 6018): onRendererFailed [error: ARCORE_UNKNOWN], message [later]',
    ]);
    expect(diagnostics.failure?.code).toBe('ARCORE_USER_DECLINED_INSTALL');
    expect(diagnostics.failure?.message).toMatch(/Google Play Services for AR/);
  });

  it('includes the detail for failures without a specific reason', () => {
    const diagnostics = fold([
      'E/Viro    ( 6018): onRendererFailed [error: ARCORE_UNKNOWN], message [Session failed]',
    ]);
    expect(diagnostics.failure?.message).toContain('Session failed');
  });

  it('recognises the #1762 sensor failure', () => {
    const diagnostics = fold([
      'E/native  ( 6018): E0000 android_data_source.cc:1073] Failed to register sensor to queue 0',
    ]);
    expect(diagnostics.failure?.code).toBe('SENSOR_REGISTRATION_FAILED');
  });

  it('tracks back cameras held by other apps, not by this app', () => {
    const held = fold([
      'I/CameraManagerGlobal( 6018): Camera 0 facing CAMERA_FACING_BACK state now CAMERA_STATE_OPEN for client com.sec.android.app.camera API Level 2 User Id 0Device Id 0',
      `I/CameraManagerGlobal( 6018): Camera 2 facing CAMERA_FACING_BACK state now CAMERA_STATE_ACTIVE for client ${OWN} API Level 2 User Id 0Device Id 0`,
    ]);
    expect(held.foreignCameraClients).toEqual({
      '0': 'com.sec.android.app.camera',
    });
    const released = fold(
      [
        'I/CameraManagerGlobal( 6018): Camera 0 facing CAMERA_FACING_BACK state now CAMERA_STATE_CLOSED for client com.sec.android.app.camera API Level 2 User Id 0Device Id 0',
      ],
      held,
    );
    expect(released.foreignCameraClients).toEqual({});
  });

  it('ignores cameras that were closed all along', () => {
    const line =
      'I/CameraManagerGlobal( 6018): Camera 20 facing CAMERA_FACING_BACK state now CAMERA_STATE_CLOSED for client com.sec.android.app.camera API Level 2 User Id 0Device Id 0';
    expect(fold([line])).toBe(INITIAL_AR_DIAGNOSTICS);
  });
});

describe('resetEngineDiagnostics', () => {
  it('forgets the engine but keeps camera clients', () => {
    const diagnostics = fold([
      ...HEALTHY_START,
      'E/Viro    ( 6018): onRendererFailed [error: ARCORE_TRANSIENT], message []',
      'I/CameraManagerGlobal( 6018): Camera 0 facing CAMERA_FACING_BACK state now CAMERA_STATE_OPEN for client com.other.app API Level 2 User Id 0Device Id 0',
    ]);
    expect(resetEngineDiagnostics(diagnostics)).toEqual({
      milestones: [],
      failure: null,
      foreignCameraClients: { '0': 'com.other.app' },
    });
  });
});

describe('deadSessionReason', () => {
  it('names another app holding the camera first', () => {
    const diagnostics = fold([
      ...HEALTHY_START,
      'I/CameraManagerGlobal( 6018): Camera 0 facing CAMERA_FACING_BACK state now CAMERA_STATE_OPEN for client com.other.app API Level 2 User Id 0Device Id 0',
    ]);
    expect(deadSessionReason(diagnostics)).toContain('com.other.app');
  });

  it('points at a dark or blocked camera when ARCore reports insufficient light', () => {
    expect(deadSessionReason(fold(HEALTHY_START), 4)).toMatch(/dark or blank/);
    expect(deadSessionReason(fold(HEALTHY_START), 1)).toMatch(
      /has not begun tracking/,
    );
  });

  it('says how far the start-up got', () => {
    expect(deadSessionReason(INITIAL_AR_DIAGNOSTICS)).toMatch(
      /engine did not start/,
    );
    expect(deadSessionReason(fold(HEALTHY_START.slice(0, 1)))).toMatch(
      /did not respond/,
    );
    expect(deadSessionReason(fold(HEALTHY_START.slice(0, 2)))).toMatch(
      /could not create/,
    );
    expect(deadSessionReason(fold(HEALTHY_START))).toMatch(
      /has not begun tracking/,
    );
  });
});

describe('trackingLostReason', () => {
  it('names the app that took the camera', () => {
    const diagnostics = fold([
      ...HEALTHY_START,
      'I/CameraManagerGlobal( 5025): Camera 20 facing CAMERA_FACING_BACK state now CAMERA_STATE_OPEN for client com.sec.android.app.camera API Level 2 User Id 0Device Id 0',
    ]);
    expect(trackingLostReason(diagnostics, 1)).toContain(
      'com.sec.android.app.camera',
    );
  });

  it('otherwise gives the tracking advice', () => {
    expect(trackingLostReason(fold(HEALTHY_START), 2)).toBe(
      'Tracking lost — moving too fast, slow down, or tap Restart AR below.',
    );
  });
});

describe('trackingAdvice', () => {
  it('maps Viro tracking reasons to advice', () => {
    expect(trackingAdvice(2)).toMatch(/too fast/);
    expect(trackingAdvice(3)).toMatch(/textured/);
    expect(trackingAdvice(4)).toMatch(/dark/);
    expect(trackingAdvice(1)).toBe('move the phone slowly');
    expect(trackingAdvice(null)).toBe('move the phone slowly');
  });
});
