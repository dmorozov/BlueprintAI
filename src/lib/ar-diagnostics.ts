/**
 * Human-readable reasons for AR engine failures on Android.
 *
 * Viro discards ARCore's session statuses and emits no failure event to JS; its
 * startup failures reach logcat only. The ar-session-guard module therefore forwards
 * the app's own log lines that match {@link AR_LOG_FILTER}, and this module turns
 * them into engine milestones, failures and camera-client state.
 *
 * Only deterministic signatures belong here. A healthy ARCore session logs hundreds
 * of `E native` lines (plane refinement, Kalman-filter corrections, missing sensor
 * callback lists, CAM_IMU_DESYNC while initialising), so no reason may key on
 * ARCore's generic error output.
 */

/** Engine start-up steps, in the order a healthy start logs them. */
export type ArMilestone =
  /** The navigator created Viro's AR view (the engine exists). */
  | 'engine-attached'
  /** Google Play Services for AR passed Viro's install/update check. */
  | 'arcore-ready'
  /** ArSession_create and the camera config succeeded. */
  | 'session-created'
  /** ArSession_resume was called. Viro logs this even when the resume failed. */
  | 'session-resumed';

export interface ArFailure {
  /** Viro's StartupError name, or a code of ours for ARCore signatures. */
  code: string;
  message: string;
  /** The raw log line, for bug reports. */
  line: string;
}

export interface ArDiagnostics {
  milestones: readonly ArMilestone[];
  /** The first failure of this engine; later lines are its consequences. */
  failure: ArFailure | null;
  /** Back cameras another app currently has open: camera id → package. */
  foreignCameraClients: Readonly<Record<string, string>>;
}

export const INITIAL_AR_DIAGNOSTICS: ArDiagnostics = {
  milestones: [],
  failure: null,
  foreignCameraClients: {},
};

const MILESTONE_SIGNATURES: readonly [ArMilestone, string][] = [
  ['engine-attached', '=== onAttachedToWindow START ==='],
  ['arcore-ready', 'ARCore installed on device'],
  ['session-created', 'Selected camera config'],
  ['session-resumed', 'AR session resumed'],
];

// Viro bridge, VRTARSceneNavigator.StartupListenerARCore.onFailure:
// Log.e("Viro", "onRendererFailed [error: " + error + "], message [" + message + "]")
// (the class file has a space after "error:", which javap does not show).
const RENDERER_FAILED_SIGNATURE = 'onRendererFailed [error:';
const RENDERER_FAILED = /onRendererFailed \[error:\s*(\w+)\], message \[(.*)\]/;

// ARCore's Session.resume failure in google-ar/arcore-android-sdk#1762.
const SENSOR_FAILED_SIGNATURE = 'Failed to register sensor to queue';

// CameraManagerGlobal logs every camera's state in this process, other apps' clients
// included (seen on the S22 Ultra, Android 16; other builds may not log it).
const CAMERA_STATE_SIGNATURE = 'facing CAMERA_FACING_BACK state now';
const CAMERA_STATE =
  /Camera (\S+) facing CAMERA_FACING_BACK state now CAMERA_STATE_(\w+) for client (\S+)/;
const CAMERA_HELD_STATES = new Set(['OPENING', 'OPEN', 'ACTIVE', 'IDLE']);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Regex source the native log watcher pre-filters with (Java- and JS-compatible). */
export const AR_LOG_FILTER = [
  ...MILESTONE_SIGNATURES.map(([, signature]) => signature),
  RENDERER_FAILED_SIGNATURE,
  SENSOR_FAILED_SIGNATURE,
  CAMERA_STATE_SIGNATURE,
]
  .map(escapeRegExp)
  .join('|');

const INSTALL_ADVICE =
  'Install or update Google Play Services for AR from the Play Store, then tap Restart AR.';

function rendererFailureMessage(error: string, detail: string): string {
  switch (error) {
    case 'CAMERA_PERMISSIONS_NOT_GRANTED':
      return 'Camera permission was not granted. Allow camera access in system settings, then reopen this screen.';
    case 'ARCORE_NOT_SUPPORTED':
      return 'This phone does not support ARCore, so AR measuring is unavailable.';
    case 'ARCORE_NOT_INSTALLED':
    case 'ARCORE_USER_DECLINED_INSTALL':
      return `AR measuring needs Google Play Services for AR. ${INSTALL_ADVICE}`;
    case 'ARCORE_NEEDS_UPDATE':
      return `Google Play Services for AR is out of date. ${INSTALL_ADVICE}`;
    case 'ARCORE_SDK_NEEDS_UPDATE':
      return 'This app’s AR engine is too old for the installed Google Play Services for AR. Update the app.';
    case 'ARCORE_TRANSIENT':
      return 'ARCore is temporarily unavailable. Tap Restart AR to try again.';
    default:
      return detail !== ''
        ? `ARCore could not start (${detail}). Tap Restart AR to try again.`
        : 'ARCore could not start. Tap Restart AR to try again.';
  }
}

function withFailure(
  diagnostics: ArDiagnostics,
  failure: ArFailure,
): ArDiagnostics {
  return diagnostics.failure === null
    ? { ...diagnostics, failure }
    : diagnostics;
}

/**
 * Folds one forwarded log line into the diagnostics. Returns the same object when the
 * line changes nothing, so a React state update bails out.
 */
export function applyArLogLine(
  diagnostics: ArDiagnostics,
  line: string,
  ownPackage: string | null,
): ArDiagnostics {
  for (const [milestone, signature] of MILESTONE_SIGNATURES) {
    if (!line.includes(signature)) continue;
    return diagnostics.milestones.includes(milestone)
      ? diagnostics
      : { ...diagnostics, milestones: [...diagnostics.milestones, milestone] };
  }

  const rendererFailed = RENDERER_FAILED.exec(line);
  if (rendererFailed !== null) {
    const [, error = 'ARCORE_UNKNOWN', detail = ''] = rendererFailed;
    return withFailure(diagnostics, {
      code: error,
      message: rendererFailureMessage(error, detail),
      line,
    });
  }

  if (line.includes(SENSOR_FAILED_SIGNATURE)) {
    return withFailure(diagnostics, {
      code: 'SENSOR_REGISTRATION_FAILED',
      message:
        'ARCore could not start the phone’s motion sensors (a known Google Play Services for AR issue on some Android 16 phones). Tap Restart AR; if it keeps happening, update Google Play Services for AR.',
      line,
    });
  }

  const camera = CAMERA_STATE.exec(line);
  if (camera !== null) {
    const [, cameraId = '', state = '', client = ''] = camera;
    const held = CAMERA_HELD_STATES.has(state) && client !== ownPackage;
    const current = diagnostics.foreignCameraClients[cameraId];
    if (held && current === client) return diagnostics;
    if (!held && current === undefined) return diagnostics;
    const foreignCameraClients = { ...diagnostics.foreignCameraClients };
    if (held) foreignCameraClients[cameraId] = client;
    else delete foreignCameraClients[cameraId];
    return { ...diagnostics, foreignCameraClients };
  }

  return diagnostics;
}

/** A fresh engine starts over; which app holds a camera is device state, so it stays. */
export function resetEngineDiagnostics(
  diagnostics: ArDiagnostics,
): ArDiagnostics {
  return {
    ...INITIAL_AR_DIAGNOSTICS,
    foreignCameraClients: diagnostics.foreignCameraClients,
  };
}

/** Viro's tracking reason for "insufficient light" (native-only, not in its TS enum). */
const TRACKING_REASON_INSUFFICIENT_LIGHT = 4;

/**
 * The reason shown when the engine has not tracked within the dead-session timeout, from how
 * far its start-up got and Viro's latest tracking reason.
 */
export function deadSessionReason(
  diagnostics: ArDiagnostics,
  trackingReason: number | null = null,
): string {
  const foreignClient = Object.values(diagnostics.foreignCameraClients)[0];
  if (foreignClient !== undefined) {
    return `The camera is in use by another app (${foreignClient}). Close that app, then tap Restart AR.`;
  }
  const reached = new Set(diagnostics.milestones);
  if (!reached.has('engine-attached')) {
    return 'The AR engine did not start. Tap Restart AR to try again.';
  }
  if (!reached.has('arcore-ready')) {
    return `Google Play Services for AR did not respond. ${INSTALL_ADVICE}`;
  }
  if (!reached.has('session-created')) {
    return 'ARCore could not create an AR session. Tap Restart AR to try again.';
  }
  // With camera access turned off in Quick Settings the camera delivers blank frames,
  // which ARCore reports as insufficient light (seen on the S22 Ultra).
  if (trackingReason === TRACKING_REASON_INSUFFICIENT_LIGHT) {
    return 'The camera image is dark or blank. Turn on a light, check that the lens is not covered and that camera access is not turned off in Quick Settings, then tap Restart AR.';
  }
  // A healthy session that is not moved stays here too, so the advice covers both.
  return 'ARCore started but has not begun tracking. Move the phone slowly over a textured floor. If the view stays black, check that camera access is not turned off in Quick Settings and close other camera apps, then tap Restart AR.';
}

/**
 * The message for an engine that tracked and then lost tracking. Another app taking
 * the camera (it evicts ARCore when it gets focus) looks like a plain loss to Viro;
 * ARCore takes the camera back by itself once this app has focus again.
 */
export function trackingLostReason(
  diagnostics: ArDiagnostics,
  trackingReason: number | null,
): string {
  const foreignClient = Object.values(diagnostics.foreignCameraClients)[0];
  if (foreignClient !== undefined) {
    return `The camera is in use by another app (${foreignClient}). Tap this screen or close that app; AR resumes by itself.`;
  }
  return `Tracking lost — ${trackingAdvice(trackingReason)}, or tap Restart AR below.`;
}

/**
 * Advice for Viro's tracking-limited reason (ViroARTrackingReasonConstants: 2 excessive
 * motion, 3 insufficient features; the native side also sends 4, insufficient light).
 */
export function trackingAdvice(reason: number | null): string {
  switch (reason) {
    case 2:
      return 'moving too fast, slow down';
    case 3:
      return 'not enough detail, aim at a textured surface';
    case TRACKING_REASON_INSUFFICIENT_LIGHT:
      return 'too dark, turn on a light';
    default:
      return 'move the phone slowly';
  }
}
