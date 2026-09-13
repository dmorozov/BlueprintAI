import {
  ViroARScene,
  ViroMaterials,
  ViroSphere,
  ViroTrackingStateConstants,
  isARSupportedOnDevice,
  requestRequiredPermissions,
  type ViroARHitTestResult,
} from '@reactvision/react-viro';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ToastBubble } from '@/components/toast-bubble';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { ArCaptureSession, type ArTrackingQuality } from '@/lib/ar-capture';
import {
  createRoom,
  getRoomLabel,
  setArSession,
  setPlan as saveRoomPlan,
} from '@/lib/session-store';

// Corner marker material (ViroReact geometry takes materials by registered name).
ViroMaterials.createMaterials({
  cornerMarker: { diffuseColor: '#FF5252' },
});

const TOAST_DURATION_MS = 2500;

type Phase =
  'checking' | 'unsupported' | 'denied' | 'error' | 'ready' | 'finished';
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
 * plain geometry union — no AI involved.
 */
export function ArCaptureScreen() {
  const theme = useTheme();
  const router = useRouter();

  const sessionRef = useRef<ArCaptureSession | null>(null);
  if (sessionRef.current === null) sessionRef.current = new ArCaptureSession();
  // One AR tracking frame per screen visit; consecutive rooms stay aligned.
  const [arSessionId] = useState(
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
  const [roomId, setRoomId] = useState(() => createRoom());
  const [roomName, setRoomName] = useState(() => getRoomLabel(roomId) ?? '');

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

  const handleNameChange = useCallback((text: string) => {
    setRoomName(text);
  }, []);

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
        session.addCorner(hit.transform.position, quality);
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
    [phase, mode, qualityNow, showToast, syncCorners],
  );

  const handleUndo = useCallback(() => {
    const session = sessionRef.current!;
    session.undoCorner();
    syncCorners();
  }, [syncCorners]);

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

  const handleFinish = useCallback(() => {
    try {
      const plan = sessionRef.current!.finishRoom(roomName);
      saveRoomPlan(roomId, plan);
      setArSession(roomId, arSessionId);
      setPhase('finished');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Could not finish the room.',
      );
    }
  }, [arSessionId, roomId, roomName, showToast]);

  const handleNextRoom = useCallback(() => {
    sessionRef.current!.clear();
    setPendingOpening(null);
    setMode('corner');
    // The AR scene stays mounted so tracking (and the shared frame) continues;
    // only the room bookkeeping resets.
    const newId = createRoom();
    setRoomId(newId);
    setRoomName(getRoomLabel(newId) ?? '');
    syncCorners();
    setPhase('ready');
  }, [syncCorners]);

  const handleDone = useCallback(() => {
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

  const trackingBadge =
    trackingState === ViroTrackingStateConstants.TRACKING_NORMAL
      ? 'Tracking good'
      : trackingState === ViroTrackingStateConstants.TRACKING_LIMITED
        ? 'Tracking limited — move slowly'
        : 'Tracking lost';

  return (
    <ThemedView style={styles.container}>
      <View style={styles.arArea}>
        <ViroARScene
          ref={sceneRef}
          style={StyleSheet.absoluteFill}
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
            style={[styles.openingPanel, { backgroundColor: theme.background }]}
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
        <View style={styles.bottomBar}>
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
              <Text style={styles.buttonLabel}>Next room (same session)</Text>
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
        </View>
      ) : (
        <View style={styles.bottomBar}>
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
    padding: Spacing.three,
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
