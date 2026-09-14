import {
  ViroARScene,
  ViroMaterials,
  ViroSphere,
  ViroTrackingStateConstants,
  isARSupportedOnDevice,
  requestRequiredPermissions,
  type ViroARHitTestResult,
} from '@reactvision/react-viro';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PhotoStrip } from '@/components/photo-strip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ToastBubble } from '@/components/toast-bubble';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ArCaptureSession, type ArTrackingQuality } from '@/lib/ar-capture';
import { preparePhoto, type ProcessedPhoto } from '@/lib/image-pipeline';
import {
  addPhoto,
  createRoom,
  getPhotos,
  getPlan,
  getRoomLabel,
  hasRoom,
  removePhoto,
  renameRoom,
  setArSession,
  setPlan as saveRoomPlan,
  setPlanSource,
} from '@/lib/session-store';
import { viroSafeStyle } from '@/lib/viro-interop';

// Corner marker material (ViroReact geometry takes materials by registered name).
// Guarded so a Viro version that throws here cannot break this module's evaluation —
// the /ar-capture route loads this screen lazily for exactly that reason.
try {
  ViroMaterials.createMaterials({
    cornerMarker: { diffuseColor: '#FF5252' },
  });
} catch {
  // Viro's native module is unavailable — the route's error boundary handles it.
}

const TOAST_DURATION_MS = 2500;

type Phase =
  | 'checking'
  | 'unsupported'
  | 'denied'
  | 'error'
  | 'ready'
  | 'photo'
  | 'finished';
type TapMode = 'corner' | 'opening';

interface PendingOpening {
  world: [number, number, number];
  wallIndex: number;
}

/**
 * AR tap-to-trace capture (no-external-API plan, Phase 1). The user walks the room
 * and taps each wall corner in order; each tap hit-tests against ARCore's tracked
 * geometry and records a real-world position (meters). Consecutive corners become
 * walls with measured lengths; door/window taps add openings on the nearest wall.
 * Rooms captured consecutively share one tracking frame, so they combine later by
 * plain geometry union — no AI involved. After finishing a room, optional reference
 * photos (expo-camera) can be captured for the user's records; they never feed the
 * plan. Taking them unmounts the AR scene, so the next room after a photo step gets
 * a fresh tracking frame and its own session id (combined via the align editor).
 */
export function ArCaptureScreen() {
  const theme = useTheme();
  const router = useRouter();
  // Edge-to-edge (Android API 35+): the bottom bars and the opening panel must
  // clear the navigation bar, not sit at a fixed offset from the screen edge.
  const insets = useSafeAreaInsets();
  // "Re-measure with AR" (blueprint screen) joins an existing room via ?room=; the
  // home/rooms entry points arrive without it and start unbound.
  const { room } = useLocalSearchParams<{ room?: string }>();

  const sessionRef = useRef<ArCaptureSession | null>(null);
  if (sessionRef.current === null) sessionRef.current = new ArCaptureSession();
  // One AR tracking frame per screen visit; consecutive rooms stay aligned. The id
  // rotates when the scene remounts after a reference-photo step (new tracking frame).
  const [arSessionId, setArSessionId] = useState(
    () =>
      `ar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
  );

  const [phase, setPhase] = useState<Phase>('checking');
  const [trackingState, setTrackingState] = useState<number | null>(null);
  const [mode, setMode] = useState<TapMode>('corner');
  const [pendingOpening, setPendingOpening] = useState<PendingOpening | null>(
    null,
  );
  const [openingType, setOpeningType] = useState<'door' | 'window'>('door');
  const [openingWidth, setOpeningWidth] = useState('0.85');
  // Mirrors of the session's corner data — refreshed in event handlers after each
  // imperative mutation (refs must not be read during render).
  const [cornerCount, setCornerCount] = useState(0);
  const [cornerWorlds, setCornerWorlds] = useState<[number, number, number][]>(
    [],
  );

  const syncCorners = useCallback(() => {
    const session = sessionRef.current!;
    setCornerCount(session.cornerCount);
    setCornerWorlds(session.cornerWorldPositions);
  }, []);

  // The room id changes when the user starts the next room in the same AR session.
  // A fresh visit stays UNBOUND (null) until the first corner tap creates the room —
  // glancing at the camera and backing out must not leave an empty "Room N" card.
  // Re-measuring joins the given room instead, so its plan can be replaced in place.
  const [roomId, setRoomId] = useState<string | null>(() =>
    typeof room === 'string' && hasRoom(room) ? room : null,
  );
  const [roomName, setRoomName] = useState(() =>
    roomId !== null ? (getRoomLabel(roomId) ?? '') : '',
  );

  /** Returns the bound room id, creating it (with any typed name) on first use. */
  const ensureRoom = useCallback((): string => {
    if (roomId !== null) return roomId;
    const id = createRoom();
    setRoomId(id);
    if (roomName !== '') renameRoom(id, roomName);
    return id;
  }, [roomId, roomName]);

  // --- reference-photo step (after finishing a room; for the user's records) ---
  // The AR scene is unmounted in this phase so expo-camera exclusively owns the
  // device camera. Photos go through the same pipeline as the old capture flow but
  // never feed plan generation.
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [photos, setPhotos] = useState<ProcessedPhoto[]>([]);
  // Set when the preview fails to start (e.g. ARCore still releasing the camera).
  const [cameraError, setCameraError] = useState<string | null>(null);
  // Bumped on retry to force-remount the CameraView.
  const [cameraAttempt, setCameraAttempt] = useState(0);
  // The expo-camera docs require unmounting the preview when the screen is unfocused.
  const [screenFocused, setScreenFocused] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, []),
  );

  const sceneRef = useRef<ViroARScene | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(
      () => setToastMessage(null),
      TOAST_DURATION_MS,
    );
  }, []);

  useEffect(
    () => () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    },
    [],
  );

  // Support + camera permission gate. Promise chain inline (no named function call)
  // because react-hooks/set-state-in-effect conservatively flags any function that
  // captures a setState and is invoked synchronously from an effect body.
  useEffect(() => {
    let cancelled = false;
    isARSupportedOnDevice()
      .then((support) =>
        support.isARSupported ? requestRequiredPermissions(['camera']) : null,
      )
      .then((result) => {
        if (cancelled) return;
        if (result === null) setPhase('unsupported');
        else if (result.camera !== true) setPhase('denied');
        else setPhase('ready');
      })
      .catch(() => {
        if (!cancelled) setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleNameChange = useCallback(
    (text: string) => {
      setRoomName(text);
      // Live-rename only once the room exists; before that the name is local and is
      // applied by ensureRoom() when the first corner tap creates the room.
      if (roomId !== null) renameRoom(roomId, text);
    },
    [roomId],
  );

  const handleTrackingUpdated = useCallback((state: number) => {
    setTrackingState(state);
  }, []);

  const qualityNow = useCallback((): ArTrackingQuality | null => {
    if (trackingState === ViroTrackingStateConstants.TRACKING_NORMAL)
      return 'normal';
    if (trackingState === ViroTrackingStateConstants.TRACKING_LIMITED)
      return 'limited';
    return null;
  }, [trackingState]);

  const handleSceneTap = useCallback(
    async (event: {
      nativeEvent: { locationX: number; locationY: number };
    }) => {
      if (phase !== 'ready') return;
      const quality = qualityNow();
      if (quality === null) {
        showToast('Tracking lost — move the phone slowly and try again.');
        return;
      }
      const scene = sceneRef.current;
      if (scene === null) return;
      let results: ViroARHitTestResult[];
      try {
        results = (await scene.performARHitTestWithPoint(
          event.nativeEvent.locationX,
          event.nativeEvent.locationY,
        )) as ViroARHitTestResult[];
      } catch {
        showToast('Hit test failed — try again.');
        return;
      }
      const hit = results[0];
      if (hit === undefined) {
        showToast(
          'No surface detected — aim at the corner and move around slowly.',
        );
        return;
      }

      const session = sessionRef.current!;
      if (mode === 'corner') {
        // First meaningful input — the room comes into existence with this tap.
        ensureRoom();
        // Adding a corner shifts wall indices, which silently invalidates any
        // openings already recorded — say so instead of losing them invisibly.
        const cleared = session.addCorner(hit.transform.position, quality);
        if (cleared > 0) {
          showToast(
            `Openings cleared (${cleared}) — corner order changed; re-add them.`,
          );
        }
        syncCorners();
      } else {
        const location = session.locateOnWall(hit.transform.position);
        if (location === null) {
          showToast('Mark at least 2 corners before adding openings.');
          return;
        }
        setOpeningType('door');
        setOpeningWidth('0.85');
        setPendingOpening({
          world: hit.transform.position,
          wallIndex: location.wallIndex,
        });
      }
    },
    [ensureRoom, phase, mode, qualityNow, showToast, syncCorners],
  );

  const handleUndo = useCallback(() => {
    const session = sessionRef.current!;
    // Undoing a corner shifts wall indices, which discards any recorded openings —
    // surface that instead of letting it happen silently.
    const cleared = session.undoCorner();
    if (cleared > 0) {
      showToast(
        `Corner removed — ${cleared} opening${cleared === 1 ? '' : 's'} were cleared; re-add them.`,
      );
    }
    syncCorners();
  }, [showToast, syncCorners]);

  const handleClear = useCallback(() => {
    const session = sessionRef.current!;
    session.clear();
    setPendingOpening(null);
    syncCorners();
  }, [syncCorners]);

  const handleAddOpening = useCallback(() => {
    if (pendingOpening === null) return;
    const quality = qualityNow();
    if (quality === null) {
      showToast('Tracking lost — move the phone slowly and try again.');
      return;
    }
    const widthM = Number.parseFloat(openingWidth);
    if (!Number.isFinite(widthM) || widthM <= 0.1 || widthM > 4) {
      showToast('Width must be between 0.1 m and 4 m.');
      return;
    }
    sessionRef.current!.addOpening(
      pendingOpening.world,
      openingType,
      widthM,
      quality,
    );
    setPendingOpening(null);
    setMode('corner');
  }, [openingType, openingWidth, pendingOpening, qualityNow, showToast]);

  const finishAndSave = useCallback((): boolean => {
    // Unreachable in practice (Finish needs ≥3 corners, which implies a room), but the
    // type must be narrowed before touching the store.
    if (roomId === null) return false;
    try {
      const plan = sessionRef.current!.finishRoom(roomName);
      saveRoomPlan(roomId, plan);
      setArSession(roomId, arSessionId);
      // Real tap measurements — the UI must never present this as mock or assisted.
      setPlanSource(roomId, 'ar-tap');
      setPhase('finished');
      return true;
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Could not finish the room.',
      );
      return false;
    }
  }, [arSessionId, roomId, roomName, showToast]);

  const handleFinish = useCallback(() => {
    // Re-measuring a room that already has a plan replaces it — confirm first so an
    // accidental navigation here cannot destroy a finished measurement. Cancelling
    // keeps the trace on screen (session untouched) with the old plan intact.
    if (roomId !== null && getPlan(roomId) !== null) {
      Alert.alert(
        'Replace existing plan?',
        `Room "${roomName}" already has a saved plan. Replace it with this measurement?`,
        [
          { text: 'Keep old plan', style: 'cancel' },
          { text: 'Replace', style: 'destructive', onPress: finishAndSave },
        ],
      );
      return;
    }
    finishAndSave();
  }, [finishAndSave, roomId, roomName]);

  const handleNextRoom = useCallback(() => {
    sessionRef.current!.clear();
    setPendingOpening(null);
    setMode('corner');
    // The AR scene stays mounted so tracking (and the shared frame) continues; only
    // the room bookkeeping resets. The next room is created lazily on its first
    // corner tap, so leaving now leaves no empty card behind.
    setRoomId(null);
    setRoomName('');
    syncCorners();
    setPhase('ready');
  }, [syncCorners]);

  const handleDone = useCallback(() => {
    if (roomId === null) return; // unreachable: Done is only reachable after a save
    router.push(`/blueprint?room=${roomId}`);
  }, [router, roomId]);

  // --- reference-photo handlers -------------------------------------------------

  // Callback ref: when the preview unmounts (blur / error) React passes null, which
  // resets readiness so the shutter stays disabled until the camera is ready again.
  const handleCameraRef = useCallback((instance: CameraView | null) => {
    cameraRef.current = instance;
    if (instance === null) setCameraReady(false);
  }, []);

  const handleReferencePhotos = useCallback(() => {
    if (roomId === null) return; // unreachable: the photo step follows a finished room
    setPhotos(getPhotos(roomId));
    setCameraReady(false);
    setCameraError(null);
    setPhase('photo');
  }, [roomId]);

  const handlePhotoCapture = useCallback(async () => {
    if (!cameraReady || capturing) return;
    setCapturing(true);
    try {
      const camera = cameraRef.current;
      if (camera === null) return;
      // exif: false keeps GPS/EXIF out of the record photos (same as capture flow).
      const picture = await camera.takePictureAsync({
        quality: 0.85,
        exif: false,
      });
      const photo = await preparePhoto(
        picture,
        `photo-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`,
      );
      if (roomId === null) return; // unreachable: the photo step follows a finished room
      addPhoto(roomId, photo);
      setPhotos((prev) => [...prev, photo]);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to capture the photo.',
      );
    } finally {
      setCapturing(false);
    }
  }, [cameraReady, capturing, roomId, showToast]);

  const handleRemovePhoto = useCallback(
    (key: string) => {
      if (roomId === null) return; // unreachable: the photo step follows a finished room
      removePhoto(roomId, key);
      setPhotos((prev) => prev.filter((photo) => photo.key !== key));
    },
    [roomId],
  );

  const handleRetryCamera = useCallback(() => {
    setCameraError(null);
    setCameraAttempt((attempt) => attempt + 1);
  }, []);

  // Leaving the photo step remounts the AR scene with a fresh tracking frame, so the
  // next room gets a new session id and joins via the align editor (the old frame is
  // gone — auto-alignment across this boundary would be invalid).
  const handlePhotoNextRoom = useCallback(() => {
    setArSessionId(
      `ar-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    );
    sessionRef.current!.clear();
    setPendingOpening(null);
    setMode('corner');
    // The next room is created lazily on its first corner tap (see handleNextRoom).
    setRoomId(null);
    setRoomName('');
    syncCorners();
    setPhotos([]);
    setPhase('ready');
  }, [syncCorners]);

  const handlePhotoDone = useCallback(() => {
    if (roomId === null) return; // unreachable: the photo step follows a finished room
    router.push(`/blueprint?room=${roomId}`);
  }, [router, roomId]);

  if (phase === 'checking') {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" />
        <ThemedText variant="small">Checking AR support…</ThemedText>
      </ThemedView>
    );
  }

  if (phase === 'unsupported' || phase === 'denied' || phase === 'error') {
    return (
      <ThemedView style={styles.center}>
        <ThemedText variant="small">
          {phase === 'unsupported'
            ? 'This device does not support ARCore. Try the photo-based mock flow instead.'
            : phase === 'denied'
              ? 'Camera permission is required for AR measurement. Allow it in system settings, then reopen this screen.'
              : 'Could not start the AR session. Close other camera apps and try again.'}
        </ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: theme.primary },
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.buttonLabel}>Go back</Text>
        </Pressable>
      </ThemedView>
    );
  }

  if (phase === 'photo') {
    // The AR scene is unmounted here, so the expo-camera preview can own the camera.
    const cameraActive =
      screenFocused && permission?.granted === true && cameraError === null;
    return (
      <ThemedView style={styles.container}>
        <View style={styles.cameraArea}>
          {cameraActive ? (
            <CameraView
              key={cameraAttempt}
              ref={handleCameraRef}
              style={StyleSheet.absoluteFill}
              facing="back"
              mode="picture"
              onCameraReady={() => setCameraReady(true)}
              onMountError={(event) => setCameraError(event.message)}
            />
          ) : (
            <View
              style={[
                styles.placeholder,
                { backgroundColor: theme.backgroundElement },
              ]}
            >
              {cameraError !== null ? (
                <>
                  <ThemedText variant="small" themeColor="textSecondary">
                    Camera could not start: {cameraError}
                  </ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    onPress={handleRetryCamera}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      { backgroundColor: theme.primary },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.buttonLabel}>Retry camera</Text>
                  </Pressable>
                </>
              ) : permission?.granted === false ? (
                <>
                  <ThemedText variant="small" themeColor="textSecondary">
                    Camera access is needed for reference photos.
                  </ThemedText>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void requestPermission()}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      { backgroundColor: theme.primary },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.buttonLabel}>Grant camera access</Text>
                  </Pressable>
                </>
              ) : (
                <ActivityIndicator />
              )}
            </View>
          )}
        </View>

        {photos.length > 0 && (
          <PhotoStrip
            photos={photos}
            onRemove={handleRemovePhoto}
            disabled={capturing}
          />
        )}

        <View
          style={[
            styles.photoFooter,
            {
              backgroundColor: theme.background,
              paddingBottom: Spacing.three + insets.bottom,
            },
          ]}
        >
          <ThemedText variant="small" themeColor="textSecondary">
            Reference photos for your records — they do not change the measured
            plan.
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take reference photo"
            disabled={!cameraReady || capturing}
            onPress={() => void handlePhotoCapture()}
            style={({ pressed }) => [
              styles.shutter,
              { borderColor: theme.text },
              (!cameraReady || capturing) && styles.disabled,
              pressed && styles.pressed,
            ]}
          />
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              onPress={handlePhotoNextRoom}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.primary },
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.buttonLabel}>Next room</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={handlePhotoDone}
              style={({ pressed }) => [
                styles.secondaryButton,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.buttonLabel, { color: theme.text }]}>
                Done
              </Text>
            </Pressable>
          </View>
        </View>

        <ToastBubble message={toastMessage} />
      </ThemedView>
    );
  }

  const trackingBadge =
    trackingState === ViroTrackingStateConstants.TRACKING_NORMAL
      ? 'Tracking good'
      : trackingState === ViroTrackingStateConstants.TRACKING_LIMITED
        ? 'Tracking limited — move slowly'
        : 'Tracking lost';

  return (
    <ThemedView style={styles.container}>
      <View style={styles.arArea}>
        {/*
         * The absolute positioning lives on this plain RN wrapper, NOT on the
         * ViroARScene: under RN 0.86 Fabric, Viro's legacy Android view managers
         * receive style keys as top-level native props, and `position: 'absolute'`
         * collides with Viro's 3D `position` prop (ReadableArray), crashing the
         * view update with "String cannot be cast to ReadableArray". See
         * src/lib/viro-interop.ts for details.
         */}
        <View style={StyleSheet.absoluteFill}>
          <ViroARScene
            ref={sceneRef}
            style={viroSafeStyle({ flex: 1 })}
            displayPointCloud={{ maxPoints: 800 }}
            onTrackingUpdated={handleTrackingUpdated}
          >
            {cornerWorlds.map((position, index) => (
              <ViroSphere
                key={index}
                radius={0.1}
                position={[position[0], position[1] + 0.05, position[2]]}
                materials={['cornerMarker']}
              />
            ))}
          </ViroARScene>
        </View>

        {/* Tap capture layer over the camera view. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={(event) => void handleSceneTap(event)}
        />

        <View
          style={[
            styles.trackingBadge,
            { backgroundColor: theme.backgroundElement },
          ]}
        >
          <ThemedText
            variant="small"
            themeColor={
              trackingState === ViroTrackingStateConstants.TRACKING_NORMAL
                ? 'primary'
                : 'text'
            }
          >
            {trackingBadge}
          </ThemedText>
        </View>

        {pendingOpening !== null && (
          <View
            style={[
              styles.openingPanel,
              {
                backgroundColor: theme.background,
                bottom: Spacing.four + insets.bottom,
              },
            ]}
          >
            <ThemedText variant="smallBold">
              Add opening on wall {pendingOpening.wallIndex + 1}
            </ThemedText>
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setOpeningType('door');
                  setOpeningWidth('0.85');
                }}
                style={[
                  styles.chip,
                  { backgroundColor: theme.backgroundElement },
                  openingType === 'door' && {
                    borderColor: theme.primary,
                    borderWidth: 2,
                  },
                ]}
              >
                <Text style={[styles.chipLabel, { color: theme.text }]}>
                  Door
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setOpeningType('window');
                  setOpeningWidth('1.2');
                }}
                style={[
                  styles.chip,
                  { backgroundColor: theme.backgroundElement },
                  openingType === 'window' && {
                    borderColor: theme.primary,
                    borderWidth: 2,
                  },
                ]}
              >
                <Text style={[styles.chipLabel, { color: theme.text }]}>
                  Window
                </Text>
              </Pressable>
              <TextInput
                value={openingWidth}
                onChangeText={setOpeningWidth}
                keyboardType="decimal-pad"
                placeholder="width (m)"
                placeholderTextColor={theme.textSecondary}
                style={[
                  styles.widthInput,
                  { color: theme.text, borderColor: theme.textSecondary },
                ]}
              />
            </View>
            <View style={styles.row}>
              <Pressable
                accessibilityRole="button"
                onPress={handleAddOpening}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: theme.primary },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.buttonLabel}>Add</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => setPendingOpening(null)}
                style={({ pressed }) => [
                  styles.secondaryButton,
                  { backgroundColor: theme.backgroundElement },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.buttonLabel, { color: theme.text }]}>
                  Cancel
                </Text>
              </Pressable>
            </View>
          </View>
        )}
      </View>

      {phase === 'finished' ? (
        <View
          style={[
            styles.bottomBar,
            { paddingBottom: Spacing.three + insets.bottom },
          ]}
        >
          <ThemedText variant="smallBold">
            Room measured ({cornerCount} corners)
          </ThemedText>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              onPress={handleNextRoom}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.primary },
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.buttonLabel}>Next room</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={handleReferencePhotos}
              style={({ pressed }) => [
                styles.secondaryButton,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.buttonLabel, { color: theme.text }]}>
                Reference photos
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={handleDone}
              style={({ pressed }) => [
                styles.secondaryButton,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.buttonLabel, { color: theme.text }]}>
                Done
              </Text>
            </Pressable>
          </View>
          {/* The tracking-restart tradeoff is stated at the decision point, not buried. */}
          <ThemedText variant="small" themeColor="textSecondary">
            Tip: taking reference photos restarts tracking, so the next room
            will need manual alignment when combined.
          </ThemedText>
        </View>
      ) : (
        <View
          style={[
            styles.bottomBar,
            { paddingBottom: Spacing.three + insets.bottom },
          ]}
        >
          <TextInput
            value={roomName}
            onChangeText={handleNameChange}
            placeholder="Room name"
            placeholderTextColor={theme.textSecondary}
            maxLength={40}
            style={[styles.nameInput, { color: theme.text }]}
          />
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              onPress={() => setMode('corner')}
              style={[
                styles.chip,
                { backgroundColor: theme.backgroundElement },
                mode === 'corner' && {
                  borderColor: theme.primary,
                  borderWidth: 2,
                },
              ]}
            >
              <Text style={[styles.chipLabel, { color: theme.text }]}>
                Corners
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => setMode('opening')}
              style={[
                styles.chip,
                { backgroundColor: theme.backgroundElement },
                mode === 'opening' && {
                  borderColor: theme.primary,
                  borderWidth: 2,
                },
              ]}
            >
              <Text style={[styles.chipLabel, { color: theme.text }]}>
                Openings
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={handleUndo}
              disabled={cornerCount === 0}
              style={({ pressed }) => [
                styles.chip,
                { backgroundColor: theme.backgroundElement },
                cornerCount === 0 && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.chipLabel, { color: theme.text }]}>
                Undo
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={handleClear}
              disabled={cornerCount === 0}
              style={({ pressed }) => [
                styles.chip,
                { backgroundColor: theme.backgroundElement },
                cornerCount === 0 && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.chipLabel, { color: theme.text }]}>
                Clear
              </Text>
            </Pressable>
          </View>
          <ThemedText variant="small" themeColor="textSecondary">
            {mode === 'corner'
              ? `Tap each wall corner in order (${cornerCount} so far).`
              : 'Tap the position of a door or window on a wall.'}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={handleFinish}
            disabled={cornerCount < 3 || pendingOpening !== null}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: theme.primary },
              (cornerCount < 3 || pendingOpening !== null) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.buttonLabel}>Finish room ({cornerCount})</Text>
          </Pressable>
        </View>
      )}

      <ToastBubble message={toastMessage} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  arArea: {
    flex: 1,
  },
  cameraArea: {
    flex: 1,
  },
  placeholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  photoFooter: {
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    backgroundColor: 'transparent',
  },
  trackingBadge: {
    position: 'absolute',
    top: Spacing.two,
    alignSelf: 'center',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
  },
  openingPanel: {
    position: 'absolute',
    bottom: Spacing.four,
    left: Spacing.three,
    right: Spacing.three,
    borderRadius: 16,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  bottomBar: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.three,
  },
  nameInput: {
    fontSize: 16,
    fontWeight: 600,
    paddingVertical: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    alignItems: 'center',
  },
  chip: {
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: 600,
  },
  widthInput: {
    flex: 1,
    minWidth: 90,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    fontSize: 14,
  },
  primaryButton: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  secondaryButton: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: 700,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.8,
  },
});
