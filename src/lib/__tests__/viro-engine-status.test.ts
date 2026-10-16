import { describe, expect, it } from 'vitest';

import {
  INITIAL_AR_DIAGNOSTICS,
  applyArLogLine,
  type ArDiagnostics,
} from '@/lib/ar-diagnostics';
import { viroEngineStatus } from '@/lib/viro-engine-status';

const OWN = 'com.anonymous.blueprintai';

// Viro's tracking states (ViroTrackingStateConstants).
const UNAVAILABLE = 1;
const LIMITED = 2;
const NORMAL = 3;
// Viro's tracking reason for excessive motion (ViroARTrackingReasonConstants).
const EXCESSIVE_MOTION = 2;

function fold(lines: string[]): ArDiagnostics {
  return lines.reduce(
    (diagnostics, line) => applyArLogLine(diagnostics, line, OWN),
    INITIAL_AR_DIAGNOSTICS,
  );
}

const base = {
  trackingState: null,
  trackingReason: null,
  engineTracked: false,
  timedOut: false,
  diagnostics: INITIAL_AR_DIAGNOSTICS,
  logReasonsAvailable: true,
};

describe('viroEngineStatus', () => {
  it('is starting through Viro’s forced "unavailable" at mount', () => {
    expect(viroEngineStatus({ ...base, trackingState: UNAVAILABLE })).toEqual({
      kind: 'starting',
    });
  });

  it('is a dead session with the best-guess reason once the timeout passes untracked', () => {
    const diagnostics = fold([
      'I/ViroAR  ( 6018): === onAttachedToWindow START ===',
      'I/Viro    ( 6018): ARCore installed on device',
      'I/ViroARCore( 6018): Selected camera config 2: CPU image 1920x1080 (status=0)',
      'I/Viro    ( 6018): AR session resumed',
    ]);
    const status = viroEngineStatus({
      ...base,
      trackingState: UNAVAILABLE,
      timedOut: true,
      diagnostics,
    });
    expect(status.kind).toBe('dead');
    expect(status.kind === 'dead' && status.reason).toMatch(
      /has not begun tracking/,
    );
  });

  it('gives the generic reason where no log tail exists', () => {
    expect(
      viroEngineStatus({ ...base, timedOut: true, logReasonsAvailable: false }),
    ).toEqual({
      kind: 'dead',
      reason: 'AR didn’t start. Tap Restart AR to try again.',
    });
  });

  it('is tracking when tracking starts after the timeout passed', () => {
    expect(
      viroEngineStatus({
        ...base,
        trackingState: NORMAL,
        engineTracked: true,
        timedOut: true,
      }),
    ).toEqual({ kind: 'tracking', quality: 'normal', advice: null });
  });

  it('is lost with recovery advice when no other app holds the camera', () => {
    const status = viroEngineStatus({
      ...base,
      trackingState: UNAVAILABLE,
      engineTracked: true,
    });
    expect(status.kind === 'lost' && status.reason).toMatch(
      /^Tracking lost — .*Restart AR/,
    );
  });

  it('is tracking normally with no advice', () => {
    expect(
      viroEngineStatus({ ...base, trackingState: NORMAL, engineTracked: true }),
    ).toEqual({ kind: 'tracking', quality: 'normal', advice: null });
  });

  it('is limited tracking with advice for the reason', () => {
    const status = viroEngineStatus({
      ...base,
      trackingState: LIMITED,
      trackingReason: EXCESSIVE_MOTION,
      engineTracked: true,
    });
    expect(status).toMatchObject({ kind: 'tracking', quality: 'limited' });
    expect(status.kind === 'tracking' && status.advice).toMatch(/too fast/);
  });

  it('is lost after tracking, naming the app that took the camera', () => {
    const diagnostics = fold([
      'I/CameraManagerGlobal( 5025): Camera 20 facing CAMERA_FACING_BACK state now CAMERA_STATE_OPEN for client com.sec.android.app.camera API Level 2 User Id 0Device Id 0',
    ]);
    const status = viroEngineStatus({
      ...base,
      trackingState: UNAVAILABLE,
      engineTracked: true,
      diagnostics,
    });
    expect(status.kind).toBe('lost');
    expect(status.kind === 'lost' && status.reason).toContain(
      'com.sec.android.app.camera',
    );
  });

  it('is a dead session as soon as the engine logs a failure, whatever Viro reports', () => {
    const diagnostics = fold([
      'E/Viro    ( 6018): onRendererFailed [error: ARCORE_NEEDS_UPDATE], message [ARCore needs update]',
    ]);
    const status = viroEngineStatus({
      ...base,
      trackingState: NORMAL,
      engineTracked: true,
      diagnostics,
    });
    expect(status.kind).toBe('dead');
    expect(status.kind === 'dead' && status.reason).toMatch(/out of date/);
  });
});
