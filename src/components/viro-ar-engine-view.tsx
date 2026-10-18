import {
  ViroARScene,
  ViroARSceneNavigator,
  ViroMaterials,
  ViroSphere,
  ViroTrackingStateConstants,
  isARSupportedOnDevice,
  requestRequiredPermissions,
  type ViroARHitTestResult,
} from '@reactvision/react-viro';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type Ref,
  type RefObject,
} from 'react';
import { AppState, PixelRatio, Platform } from 'react-native';

import {
  AR_LOG_FILTER,
  INITIAL_AR_DIAGNOSTICS,
  applyArLogLine,
} from '@/lib/ar-diagnostics';
import type {
  ArEngineHandle,
  ArEngineViewProps,
  ArHit,
  ArReadiness,
  Vec3,
} from '@/lib/ar-engine';
import { viroEngineStatus } from '@/lib/viro-engine-status';
import { toArHit, viroHitTestPoint, viroSafeStyle } from '@/lib/viro-interop';

import ArSessionGuard from '../../modules/ar-session-guard';

// Corner marker material (ViroReact geometry takes materials by registered name).
// Guarded so a Viro version that throws here cannot break this module's evaluation —
// the /ar-capture route loads its screen lazily for exactly that reason.
try {
  ViroMaterials.createMaterials({
    cornerMarker: { diffuseColor: '#FF5252' },
  });
} catch {
  // Viro's native module is unavailable — the route's error boundary handles it.
}

/**
 * An engine that has not tracked (limited or normal) this long after mounting is a
 * dead session. Viro swallows ARCore's failure statuses, so without this "Starting…"
 * would last forever over a black preview.
 */
const DEAD_SESSION_TIMEOUT_MS = 10000;
/**
 * How long the engine waits for expo-camera to release the camera before mounting
 * anyway. The release took 1.4–1.5 s after leaving a camera screen on the S22 Ultra.
 */
const CAMERA_WAIT_TIMEOUT_MS = 3000;
/**
 * How long a session back from the background may take to track again before Viro's
 * "unavailable" counts as a loss. Tracking returned 1.5–2.8 s after the app came back
 * on the S22 Ultra.
 */
const RESUME_TIMEOUT_MS = 5000;
/**
 * Turns on ARCore's Depth API for hit tests, so a tap on a plain wall where no plane
 * was detected still lands (10 of 10 on the S22 Ultra, 0 of 12 without). Viro falls
 * back to no depth on phones that do not support it.
 */
const DEPTH_HITS_ENABLED = true;
/** Corner markers small enough not to hide the spot being tapped (3 cm across). */
const MARKER_RADIUS_M = 0.015;

function newFrameId(): string {
  return `ar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Whether AR measuring can start here: ARCore support, then the camera permission
 * (Viro asks for it).
 */
export async function viroArReadiness(): Promise<ArReadiness> {
  const support = await isARSupportedOnDevice();
  if (!support.isARSupported) return 'unsupported';
  const permissions = await requestRequiredPermissions(['camera']);
  return permissions.camera === true ? 'ready' : 'denied';
}

/**
 * Live engine state the scene needs. ViroARSceneNavigator captures `initialScene` once
 * at construction, so the scene must be a stable component; it reads everything that
 * changes from this context (the navigator renders its scenes as ordinary React
 * children, so context flows through it).
 */
interface EngineSceneState {
  sceneRef: RefObject<ViroARScene | null>;
  markers: readonly Vec3[];
  onTrackingUpdated: (state: number, reason: number) => void;
}

const EngineSceneContext = createContext<EngineSceneState | null>(null);

/**
 * The AR scene mounted by the navigator: tracked world plus a marker per corner.
 * Only ViroARSceneNavigator creates the AR engine (ARCore session, camera background);
 * a ViroARScene rendered outside one is an empty view that never tracks, and its hit
 * tests reject, because Viro resolves them via the navigator.
 */
function EngineScene() {
  const state = useContext(EngineSceneContext);
  if (state === null) {
    throw new Error('EngineScene must be rendered inside EngineSceneContext.');
  }
  const { sceneRef, markers, onTrackingUpdated } = state;
  return (
    <ViroARScene
      ref={sceneRef}
      style={viroSafeStyle({ flex: 1 })}
      displayPointCloud={{ maxPoints: 800 }}
      onTrackingUpdated={onTrackingUpdated}
    >
      {markers.map((position, index) => (
        <ViroSphere
          key={index}
          radius={MARKER_RADIUS_M}
          position={[position[0], position[1] + MARKER_RADIUS_M, position[2]]}
          materials={['cornerMarker']}
        />
      ))}
    </ViroARScene>
  );
}

const ENGINE_SCENE = { scene: EngineScene };

/**
 * The Viro implementation of the AR engine seam: one engine session (one ARCore
 * session, one tracking frame) per mount. It waits for the back camera, then mounts
 * Viro's navigator, reads failure reasons from the app's own log (Viro passes none to
 * JS), runs the dead-session timeout, and reports one ArEngineStatus.
 */
export function ViroArEngineView({
  markers,
  onStatusChange,
  onFrameStart,
  ref,
}: ArEngineViewProps & { ref?: Ref<ArEngineHandle> }) {
  const sceneRef = useRef<ViroARScene | null>(null);
  const [frameId] = useState(newFrameId);
  // Without the guard module (iOS, older builds) the engine mounts at once.
  const [cameraFree, setCameraFree] = useState(ArSessionGuard === null);
  const [trackingState, setTrackingState] = useState<number | null>(null);
  const [trackingReason, setTrackingReason] = useState<number | null>(null);
  // Viro reports one forced "unavailable" at mount, and a session that never starts
  // stays there without reporting anything else, so only real tracking (limited or
  // normal) proves the engine alive.
  const [engineTracked, setEngineTracked] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  // Viro pauses ARCore in the background and, back in the foreground, reports
  // "unavailable" before tracking returns. Until it tracks again, or the resume
  // timeout passes, the session is resuming, not lost.
  const [resume, setResume] = useState<'none' | 'paused' | 'resuming'>('none');
  const [diagnostics, setDiagnostics] = useState(INITIAL_AR_DIAGNOSTICS);

  useEffect(() => {
    onFrameStart(frameId);
  }, [frameId, onFrameStart]);

  // ARCore gets the camera in an orderly hand-off once expo-camera (Capture, Photo
  // assist or the reference-photo step) has released it, instead of by evicting the
  // older client. A timeout or a failed call still mounts the engine.
  useEffect(() => {
    if (ArSessionGuard === null) return;
    let cancelled = false;
    void ArSessionGuard.awaitBackCameraAvailable(CAMERA_WAIT_TIMEOUT_MS)
      .catch(() => null)
      .then(() => {
        if (!cancelled) setCameraFree(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The guard module forwards the matching lines of the app's own logcat, and
  // ar-diagnostics turns them into milestones, failures and camera holders.
  useEffect(() => {
    const guard = ArSessionGuard;
    if (guard === null) return;
    const subscription = guard.addListener('onArLog', ({ line }) =>
      setDiagnostics((current) =>
        applyArLogLine(current, line, guard.packageName),
      ),
    );
    guard.startLogWatch(AR_LOG_FILTER);
    return () => {
      guard.stopLogWatch();
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!cameraFree || engineTracked) return;
    const timer = setTimeout(() => setTimedOut(true), DEAD_SESSION_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [cameraFree, engineTracked]);

  // Only "background" pauses the session: iOS's "inactive" (Control Center, an
  // incoming call banner) leaves ARKit running, and Android never reports it.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') setResume('paused');
      if (state === 'active') {
        setResume((current) => (current === 'paused' ? 'resuming' : current));
      }
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (resume !== 'resuming') return;
    const timer = setTimeout(() => setResume('none'), RESUME_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [resume]);

  const status = useMemo(
    () =>
      viroEngineStatus({
        trackingState,
        trackingReason,
        engineTracked,
        timedOut,
        diagnostics,
        logReasonsAvailable: ArSessionGuard !== null,
        cameraFree,
        resuming: resume !== 'none',
      }),
    [
      cameraFree,
      diagnostics,
      engineTracked,
      resume,
      timedOut,
      trackingReason,
      trackingState,
    ],
  );
  useEffect(() => {
    onStatusChange(status);
  }, [onStatusChange, status]);

  useImperativeHandle(
    ref,
    () => ({
      async hitTest(x, y) {
        const scene = sceneRef.current;
        if (scene === null) throw new Error('The AR engine is not ready.');
        // Android's renderer hit-tests in physical pixels; RN locations are in dp.
        const [px, py] = viroHitTestPoint(
          { locationX: x, locationY: y },
          { os: Platform.OS, pixelRatio: PixelRatio.get() },
        );
        // In parallel, so the camera position and the hits come from nearly the
        // same frame.
        const [results, camera] = await Promise.all([
          scene.performARHitTestWithPoint(px, py) as Promise<
            ViroARHitTestResult[]
          >,
          scene.getCameraOrientationAsync(),
        ]);
        return {
          hits: results
            .map(toArHit)
            .filter((hit): hit is ArHit => hit !== null),
          camera: camera.position as Vec3,
        };
      },
    }),
    [],
  );

  const handleTrackingUpdated = useCallback((state: number, reason: number) => {
    setTrackingState(state);
    setTrackingReason(reason);
    if (state !== ViroTrackingStateConstants.TRACKING_UNAVAILABLE) {
      setEngineTracked(true);
      // Only in the foreground: a report in the background does not end the pause.
      setResume((current) => (current === 'resuming' ? 'none' : current));
    }
  }, []);

  const scene = useMemo<EngineSceneState>(
    () => ({ sceneRef, markers, onTrackingUpdated: handleTrackingUpdated }),
    [handleTrackingUpdated, markers],
  );

  if (!cameraFree) return null;
  // provider="none" matches the Viro config plugin in app.json (the navigator
  // otherwise defaults to ReactVision cloud anchors).
  return (
    <EngineSceneContext.Provider value={scene}>
      <ViroARSceneNavigator
        initialScene={ENGINE_SCENE}
        provider="none"
        depthEnabled={DEPTH_HITS_ENABLED}
        style={viroSafeStyle({ flex: 1 })}
      />
    </EngineSceneContext.Provider>
  );
}
