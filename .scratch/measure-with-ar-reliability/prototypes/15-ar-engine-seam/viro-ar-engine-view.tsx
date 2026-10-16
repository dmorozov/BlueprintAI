/**
 * PROTOTYPE (ticket 15) — the Viro implementation of the AR engine seam, as decided on
 * 2026-10-15. A sketch: it type-checks and shows where each piece of today's screen
 * goes, but nothing renders it. The spec's implementation moves it to
 * `src/components/viro-ar-engine-view.tsx` and deletes the matching code from
 * `src/screens/ar-capture-screen.tsx`.
 *
 * Moves in from the screen: the camera wait (ar-session-guard), the log watch and
 * ar-diagnostics, the dead-session timer, Viro's forced "unavailable" at mount, the
 * navigator/scene/marker rendering, the dp→px tap conversion and Viro's hit types.
 */

import {
  ViroARScene,
  ViroARSceneNavigator,
  ViroSphere,
  ViroTrackingStateConstants,
  type ViroARHitTestResult,
} from '@reactvision/react-viro';
import {
  createContext,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import { PixelRatio, Platform } from 'react-native';

import {
  INITIAL_AR_DIAGNOSTICS,
  deadSessionReason,
  trackingAdvice,
  trackingLostReason,
  type ArDiagnostics,
} from '@/lib/ar-diagnostics';
import { viroHitTestPoint, viroSafeStyle } from '@/lib/viro-interop';

import type {
  ArEngineHandle,
  ArEngineStatus,
  ArEngineViewProps,
  ArHit,
  Vec3,
} from './ar-engine';

/** 3 cm markers (ticket 15 Q7); today's 20 cm spheres hid the tape's end in ticket 19. */
const MARKER_RADIUS_M = 0.015;
/** A plane hit whose pose is tilted less than this is horizontal (UNVERIFIED on device). */
const HORIZONTAL_TILT_DEG = 15;
const GENERIC_DEAD_SESSION_REASON =
  'AR didn’t start. Tap Restart AR to try again.';

/**
 * Today's screen logic, as a pure mapping from what Viro and the log tail report to
 * the seam's status (unit-testable against ticket 04's logs).
 *
 * | Viro / log tail                                   | ArEngineStatus                       |
 * |---------------------------------------------------|--------------------------------------|
 * | `onRendererFailed` or #1762 line in the log tail  | dead (the failure's message)         |
 * | not tracked yet, timer not expired                | starting (Viro's forced UNAVAILABLE) |
 * | not tracked yet, timer expired                    | dead (deadSessionReason)             |
 * | TRACKING_NORMAL                                   | tracking normal                      |
 * | TRACKING_LIMITED + reason 2/3/4                   | tracking limited + trackingAdvice    |
 * | TRACKING_UNAVAILABLE after tracking               | lost (trackingLostReason)            |
 */
export function viroEngineStatus(input: {
  trackingState: number | null;
  trackingReason: number | null;
  engineTracked: boolean;
  timedOut: boolean;
  diagnostics: ArDiagnostics;
  logReasonsAvailable: boolean;
}): ArEngineStatus {
  const { trackingState, trackingReason, diagnostics } = input;
  if (diagnostics.failure !== null) {
    return { kind: 'dead', reason: diagnostics.failure.message };
  }
  if (!input.engineTracked) {
    if (!input.timedOut) return { kind: 'starting' };
    return {
      kind: 'dead',
      reason: input.logReasonsAvailable
        ? deadSessionReason(diagnostics, trackingReason)
        : GENERIC_DEAD_SESSION_REASON,
    };
  }
  if (trackingState === ViroTrackingStateConstants.TRACKING_NORMAL) {
    return { kind: 'tracking', quality: 'normal', advice: null };
  }
  if (trackingState === ViroTrackingStateConstants.TRACKING_LIMITED) {
    return {
      kind: 'tracking',
      quality: 'limited',
      advice: trackingAdvice(trackingReason),
    };
  }
  return {
    kind: 'lost',
    reason: trackingLostReason(diagnostics, trackingReason),
  };
}

/**
 * Viro's hit types → the seam's. Depth hits arrive as `FeaturePoint` (Viro bug,
 * ticket 19), so they become `point`. A plane's unbounded extension
 * (`EstimatedHorizontalPlane`) is dropped: it continues behind walls and furniture.
 */
function toArHit(result: ViroARHitTestResult): ArHit | null {
  const position = result.transform.position as Vec3;
  if (result.type === 'ExistingPlaneUsingExtent') {
    const [pitch, , roll] = result.transform.rotation;
    return {
      kind: 'plane',
      position,
      facesUp:
        Math.abs(pitch) < HORIZONTAL_TILT_DEG &&
        Math.abs(roll) < HORIZONTAL_TILT_DEG,
    };
  }
  if (result.type === 'FeaturePoint' || result.type === 'DepthPoint') {
    return { kind: 'point', position, facesUp: false };
  }
  return null;
}

interface SceneState {
  sceneRef: { current: ViroARScene | null };
  markers: readonly Vec3[];
  onTrackingUpdated: (state: number, reason: number) => void;
}

const SceneContext = createContext<SceneState | null>(null);

/** The navigator captures `initialScene` once, so the scene reads live state from context. */
function EngineScene() {
  const state = useContext(SceneContext);
  if (state === null) throw new Error('EngineScene needs SceneContext.');
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
          position={position}
          materials={['cornerMarker']}
        />
      ))}
    </ViroARScene>
  );
}

const ENGINE_SCENE = { scene: EngineScene };

export function ViroArEngineView({
  markers,
  onStatusChange,
  onFrameStart,
  ref,
}: ArEngineViewProps & { ref?: Ref<ArEngineHandle> }) {
  const sceneRef = useRef<ViroARScene | null>(null);
  const [trackingState, setTrackingState] = useState<number | null>(null);
  const [trackingReason, setTrackingReason] = useState<number | null>(null);
  const [engineTracked, setEngineTracked] = useState(false);
  // MOVES IN: the camera wait (awaitBackCameraAvailable, 3 s cap) gating the navigator,
  // the log watch feeding applyArLogLine, and the 10 s dead-session timer — today's
  // screen code, unchanged. Stubbed here.
  const [timedOut] = useState(false);
  const [diagnostics] = useState<ArDiagnostics>(INITIAL_AR_DIAGNOSTICS);
  const cameraFree = true;

  // One tracking frame per mounted engine; the screen remounts it (key) to restart.
  useEffect(() => {
    onFrameStart(
      `ar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    );
  }, [onFrameStart]);

  useEffect(() => {
    onStatusChange(
      viroEngineStatus({
        trackingState,
        trackingReason,
        engineTracked,
        timedOut,
        diagnostics,
        logReasonsAvailable: true,
      }),
    );
  }, [
    diagnostics,
    engineTracked,
    onStatusChange,
    timedOut,
    trackingReason,
    trackingState,
  ]);

  useImperativeHandle(
    ref,
    () => ({
      async hitTest(x, y) {
        const scene = sceneRef.current;
        if (scene === null) throw new Error('The AR engine is not ready.');
        const [px, py] = viroHitTestPoint(
          { locationX: x, locationY: y },
          { os: Platform.OS, pixelRatio: PixelRatio.get() },
        );
        // In parallel, so the camera pose and the hits come from nearly the same frame.
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

  if (!cameraFree) return null;
  return (
    <SceneContext.Provider
      value={{
        sceneRef,
        markers,
        onTrackingUpdated: (state, reason) => {
          setTrackingState(state);
          setTrackingReason(reason);
          if (state !== ViroTrackingStateConstants.TRACKING_UNAVAILABLE) {
            setEngineTracked(true);
          }
        },
      }}
    >
      <ViroARSceneNavigator
        initialScene={ENGINE_SCENE}
        provider="none"
        depthEnabled
        style={viroSafeStyle({ flex: 1 })}
      />
    </SceneContext.Provider>
  );
}
