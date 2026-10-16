import {
  deadSessionReason,
  trackingAdvice,
  trackingLostReason,
  type ArDiagnostics,
} from '@/lib/ar-diagnostics';
import type { ArEngineStatus } from '@/lib/ar-engine';

/**
 * What Viro and the log tail have reported about one engine session. `engineTracked`
 * and `timedOut` are the engine component's own bookkeeping: whether it has ever
 * tracked, and whether the dead-session timeout passed before it did.
 */
export interface ViroEngineReport {
  /** Viro's last tracking state (ViroTrackingStateConstants), null before any. */
  trackingState: number | null;
  /** Viro's last tracking reason (ViroARTrackingReasonConstants, plus 4 = light). */
  trackingReason: number | null;
  engineTracked: boolean;
  timedOut: boolean;
  diagnostics: ArDiagnostics;
  /** False where no log tail exists (iOS, builds without the guard module). */
  logReasonsAvailable: boolean;
}

// ViroTrackingStateConstants. Not imported: Viro's runtime module cannot load outside
// React Native, and this mapping is tested under Node.
const TRACKING_LIMITED = 2;
const TRACKING_NORMAL = 3;

/** A dead session's reason when no log tail can say more. */
const GENERIC_DEAD_SESSION_REASON =
  'AR didn’t start. Tap Restart AR to try again.';

/** Maps a Viro engine session's report to the seam's status. */
export function viroEngineStatus(report: ViroEngineReport): ArEngineStatus {
  if (report.diagnostics.failure !== null) {
    return { kind: 'dead', reason: report.diagnostics.failure.message };
  }
  if (!report.engineTracked) {
    if (!report.timedOut) return { kind: 'starting' };
    return {
      kind: 'dead',
      reason: report.logReasonsAvailable
        ? deadSessionReason(report.diagnostics, report.trackingReason)
        : GENERIC_DEAD_SESSION_REASON,
    };
  }
  if (report.trackingState === TRACKING_NORMAL) {
    return { kind: 'tracking', quality: 'normal', advice: null };
  }
  if (report.trackingState === TRACKING_LIMITED) {
    return {
      kind: 'tracking',
      quality: 'limited',
      advice: trackingAdvice(report.trackingReason),
    };
  }
  return {
    kind: 'lost',
    reason: trackingLostReason(report.diagnostics, report.trackingReason),
  };
}
