import { NativeModule, requireOptionalNativeModule } from 'expo';

export interface BackCameraWait {
  /** False when the timeout elapsed with the camera still held, or no back camera exists. */
  available: boolean;
  waitedMs: number;
  cameraId: string | null;
}

type ArSessionGuardEvents = {
  /** A line of this app's own logcat that matched the startLogWatch filter. */
  onArLog(event: { line: string }): void;
};

declare class ArSessionGuardModule extends NativeModule<ArSessionGuardEvents> {
  readonly packageName: string | null;
  /** Resolves once the primary back camera is free, or after `timeoutMs`. */
  awaitBackCameraAvailable(timeoutMs: number): Promise<BackCameraWait>;
  /** Starts forwarding matching log lines (a regex source) as `onArLog`. */
  startLogWatch(filter: string): void;
  stopLogWatch(): void;
}

/**
 * Android-only guards around Viro's AR engine: the camera hand-off from expo-camera,
 * and failure reasons read from the app's own logcat (Viro exposes none to JS). Null
 * on iOS and web, and on a development build that predates the module.
 */
export default requireOptionalNativeModule<ArSessionGuardModule>(
  'ArSessionGuard',
);
