import { Image } from 'expo-image';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BlueprintSvg } from '@/components/blueprint-svg';
import { PhotoStrip } from '@/components/photo-strip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ToastBubble } from '@/components/toast-bubble';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { preparePhoto, type ProcessedPhoto } from '@/lib/image-pipeline';
import {
  PhotoAssistError,
  suggestWalls,
  type PhotoSuggestion,
} from '@/lib/photo-assist-client';
import {
  suggestionPreviewPlan,
  suggestionToPlan,
} from '@/lib/photo-assist-plan';
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

const TOAST_DURATION_MS = 2500;
/** The service accepts at most this many photos per request. */
const MAX_ASSIST_PHOTOS = 6;

type Phase = 'camera' | 'uploading' | 'review' | 'error';

/**
 * Photo-assist flow (no-external-API plan, Phase 2): for rooms the user can't or
 * doesn't want to walk in AR, snap a few photos and let the SELF-HOSTED MoGe service
 * propose candidate walls. Each photo is its own independent frame, so the review step
 * saves PER PHOTO: any number of photos can each be saved as their own room (the first
 * save goes to the bound room — the one joined via ?room= when re-running assist on an
 * existing room; later saves create new rooms). Saved plans carry capped confidence
 * (<= 0.5), an "auto-detected — verify" note, and a unique frame id, so they combine
 * with other rooms through the align editor like any cross-session room. No
 * third-party API is called; the only network traffic is to the operator's own service
 * (feature-flagged by EXPO_PUBLIC_PHOTO_ASSIST_URL — this screen is unreachable without
 * it).
 */
export function PhotoAssistScreen() {
  const theme = useTheme();
  const router = useRouter();
  // Edge-to-edge (Android API 35+): the footers must clear the navigation bar.
  const insets = useSafeAreaInsets();
  const { room } = useLocalSearchParams<{ room?: string }>();

  // Join an existing room when opened with a valid id (re-run flow); otherwise stay
  // unbound until the first captured photo creates the room, so an abandoned visit
  // leaves no empty "Room N" card behind.
  const [roomId, setRoomId] = useState<string | null>(() =>
    typeof room === 'string' && hasRoom(room) ? room : null,
  );
  // True when the joined room already had a plan before this visit — saving into it
  // then replaces an existing plan and must be confirmed.
  const [preExistingPlan] = useState(
    () => roomId !== null && getPlan(roomId) !== null,
  );
  const [roomName, setRoomName] = useState(() =>
    roomId !== null ? (getRoomLabel(roomId) ?? '') : '',
  );
  // Photo index -> id of the room that photo's walls were saved into.
  const [savedRooms, setSavedRooms] = useState<Record<number, string>>({});
  // The typed name is applied to at most one auto-created room per visit (saving
  // several photos as rooms must not produce five identically named rooms).
  const nameAppliedRef = useRef(false);
  const [phase, setPhase] = useState<Phase>('camera');
  const [failureMessage, setFailureMessage] = useState<string | null>(null);

  /** Returns the bound room id, creating it (with any typed name) on first use. */
  const ensureRoom = useCallback((): string => {
    if (roomId !== null) return roomId;
    const id = createRoom();
    setRoomId(id);
    if (roomName !== '' && !nameAppliedRef.current) {
      renameRoom(id, roomName);
      nameAppliedRef.current = true;
    }
    return id;
  }, [roomId, roomName]);

  // --- camera step -------------------------------------------------------------
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [photos, setPhotos] = useState<ProcessedPhoto[]>(() =>
    roomId !== null ? getPhotos(roomId) : [],
  );
  // Set when the preview fails to start; cleared on retry (remount via key bump).
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraAttempt, setCameraAttempt] = useState(0);
  // The expo-camera docs require unmounting the preview when the screen is unfocused.
  const [screenFocused, setScreenFocused] = useState(true);

  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, []),
  );

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    },
    [],
  );

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(
      () => setToastMessage(null),
      TOAST_DURATION_MS,
    );
  }, []);

  const handleNameChange = useCallback(
    (text: string) => {
      setRoomName(text);
      // Live-rename only once the room exists; before that the name is local and is
      // applied by ensureRoom() when the first photo creates the room.
      if (roomId !== null) renameRoom(roomId, text);
    },
    [roomId],
  );

  // Callback ref: when the preview unmounts (blur / error) React passes null, which
  // resets readiness so the shutter stays disabled until the camera is ready again.
  const handleCameraRef = useCallback((instance: CameraView | null) => {
    cameraRef.current = instance;
    if (instance === null) setCameraReady(false);
  }, []);

  const handleRetryCamera = useCallback(() => {
    setCameraError(null);
    setCameraAttempt((attempt) => attempt + 1);
  }, []);

  const handleCapture = useCallback(async () => {
    if (!cameraReady || capturing || photos.length >= MAX_ASSIST_PHOTOS) return;
    setCapturing(true);
    try {
      const camera = cameraRef.current;
      if (camera === null) return;
      // exif: false keeps GPS/EXIF out of the upload payload.
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
      // First meaningful input — this is when the room actually comes into existence.
      addPhoto(ensureRoom(), photo);
      setPhotos((prev) => [...prev, photo]);
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to capture the photo.',
      );
    } finally {
      setCapturing(false);
    }
  }, [cameraReady, capturing, ensureRoom, photos.length, showToast]);

  const handleRemovePhoto = useCallback(
    (key: string) => {
      if (roomId === null) return; // no photos exist before the room does
      removePhoto(roomId, key);
      setPhotos((prev) => prev.filter((photo) => photo.key !== key));
    },
    [roomId],
  );

  // --- review state (declared before the handlers that mutate it) -----------------
  const [results, setResults] = useState<PhotoSuggestion[] | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  // Per result index: which wall positions the user tapped away.
  const [deletedWalls, setDeletedWalls] = useState<Record<number, boolean[]>>(
    {},
  );

  // --- upload step ---------------------------------------------------------------
  const handleAnalyze = useCallback(() => {
    if (photos.length === 0 || phase === 'uploading') return;
    setFailureMessage(null);
    setPhase('uploading');
    suggestWalls(photos)
      .then((response) => {
        setResults(response.photos);
        // Pre-select the first photo that actually produced walls.
        const first = response.photos.find((entry) => entry.walls.length > 0);
        setSelectedIndex(first !== undefined ? first.index : null);
        setPhase('review');
      })
      .catch((error) => {
        setFailureMessage(
          error instanceof PhotoAssistError || error instanceof Error
            ? error.message
            : 'The assist request failed.',
        );
        setPhase('error');
      });
  }, [photos, phase]);

  // --- review step ---------------------------------------------------------------
  const selectedResult = useMemo(() => {
    if (results === null || selectedIndex === null) return null;
    return results.find((entry) => entry.index === selectedIndex) ?? null;
  }, [results, selectedIndex]);

  const keptWalls = useMemo(() => {
    if (selectedResult === null) return [];
    const deleted = deletedWalls[selectedResult.index] ?? [];
    return selectedResult.walls.filter((_, i) => deleted[i] !== true);
  }, [selectedResult, deletedWalls]);

  /** How many walls the user kept for a given photo (drives its save button). */
  const keptCountFor = useCallback(
    (index: number): number => {
      const entry = results?.find((candidate) => candidate.index === index);
      if (entry === undefined) return 0;
      const deleted = deletedWalls[index] ?? [];
      return entry.walls.filter((_, i) => deleted[i] !== true).length;
    },
    [results, deletedWalls],
  );

  const previewPlan = useMemo(
    () => suggestionPreviewPlan(keptWalls),
    [keptWalls],
  );

  const handleToggleWall = useCallback(
    (wallIndex: number) => {
      if (selectedResult === null) return;
      setDeletedWalls((current) => {
        const existing = current[selectedResult.index] ?? [];
        const next = [...existing];
        next[wallIndex] = next[wallIndex] !== true;
        return { ...current, [selectedResult.index]: next };
      });
    },
    [selectedResult],
  );

  // --- per-photo save (F2: one photo -> one room, several may be saved) -----------
  // The bound room (joined via ?room= or created on the first photo) receives the
  // FIRST save of the visit; every later save creates a new room. Re-saving a photo
  // that was already saved updates that photo's own room.
  const resolveSaveTarget = useCallback((): string => {
    if (roomId === null) return ensureRoom(); // unreachable: saving needs a photo
    if (Object.keys(savedRooms).length === 0) return roomId;
    const id = createRoom();
    if (roomName !== '' && !nameAppliedRef.current) {
      renameRoom(id, roomName);
      nameAppliedRef.current = true;
    }
    return id;
  }, [ensureRoom, roomId, savedRooms, roomName]);

  const savePhotoToRoom = useCallback(
    (index: number, targetId: string) => {
      const entry = results?.find((candidate) => candidate.index === index);
      if (entry === undefined) return;
      const deleted = deletedWalls[index] ?? [];
      const kept = entry.walls.filter((_, i) => deleted[i] !== true);
      if (kept.length === 0) return;
      try {
        const plan = suggestionToPlan(kept, getRoomLabel(targetId) ?? roomName);
        saveRoomPlan(targetId, plan);
        // Each photo frame is unrelated to every other: a unique per-room frame id keeps
        // this room out of auto-merge — it joins the combined blueprint via the align
        // editor, exactly like a cross-session AR room.
        setArSession(targetId, `assist-${targetId}`);
        setPlanSource(targetId, 'photo-assist');
        setSavedRooms((current) => ({ ...current, [index]: targetId }));
        showToast(`Saved as "${getRoomLabel(targetId) ?? 'room'}"`);
      } catch (error) {
        showToast(
          error instanceof Error ? error.message : 'Could not save the plan.',
        );
      }
    },
    [deletedWalls, results, roomName, showToast],
  );

  const handleSavePhoto = useCallback(
    (index: number) => {
      const targetId = savedRooms[index] ?? resolveSaveTarget();
      // Replacing a plan that existed BEFORE this visit (re-run flow) is destructive —
      // confirm it. Updating a room created or already saved during this visit is not
      // (the first save into the joined room consumed the confirmation).
      const alreadySavedThisVisit =
        Object.values(savedRooms).includes(targetId);
      if (targetId === roomId && preExistingPlan && !alreadySavedThisVisit) {
        Alert.alert(
          'Replace existing plan?',
          `Room "${getRoomLabel(targetId) ?? ''}" already has a saved plan. Replace it with this photo's walls?`,
          [
            { text: 'Keep old plan', style: 'cancel' },
            {
              text: 'Replace',
              style: 'destructive',
              onPress: () => savePhotoToRoom(index, targetId),
            },
          ],
        );
        return;
      }
      savePhotoToRoom(index, targetId);
    },
    [preExistingPlan, resolveSaveTarget, roomId, savedRooms, savePhotoToRoom],
  );

  const anySaved = Object.keys(savedRooms).length > 0;

  const handleRetake = useCallback(() => {
    setResults(null);
    setSelectedIndex(null);
    setDeletedWalls({});
    // The saved ROOMS stay in the list (real data), but the photo→room mapping is
    // stale once the photo set changes — a fresh analysis must not show "Saved" for
    // photos that were never saved.
    setSavedRooms({});
    setFailureMessage(null);
    setPhase('camera');
  }, []);

  // --- render ---------------------------------------------------------------------
  if (phase === 'uploading') {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator size="large" />
        <ThemedText variant="smallBold">
          {`Sending ${photos.length} photo${photos.length === 1 ? '' : 's'} to your assist server…`}
        </ThemedText>
        <ThemedText variant="small" themeColor="textSecondary">
          MoGe runs on your own GPU — this usually takes a few seconds.
        </ThemedText>
      </ThemedView>
    );
  }

  if (phase === 'error') {
    return (
      <ThemedView style={styles.center}>
        <ThemedText variant="small">{failureMessage}</ThemedText>
        <Pressable
          accessibilityRole="button"
          onPress={handleAnalyze}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: theme.primary },
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.buttonLabel}>Try again</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={handleRetake}
          style={({ pressed }) => [
            styles.secondaryButton,
            { backgroundColor: theme.backgroundElement },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.buttonLabel, { color: theme.text }]}>
            Back to photos
          </Text>
        </Pressable>
      </ThemedView>
    );
  }

  if (phase === 'review') {
    const withWalls = (results ?? []).filter((entry) => entry.walls.length > 0);
    const failedCount = (results ?? []).filter(
      (entry) => entry.error !== undefined,
    ).length;

    return (
      <ThemedView
        style={[
          styles.container,
          { paddingBottom: Spacing.three + insets.bottom },
        ]}
      >
        <ThemedText variant="small" themeColor="textSecondary">
          {withWalls.length > 0
            ? 'Each photo can become its own room. Tap a photo, remove false-positive walls, then save it as a room — you can save several.'
            : 'No walls detected in any photo.'}
        </ThemedText>

        {withWalls.length === 0 && (
          <View
            style={[
              styles.hintCard,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            <ThemedText variant="small">
              Try holding the phone level, about 2–3 m from a wall, with the
              wall filling most of the frame. Then re-shoot and analyze again.
            </ThemedText>
          </View>
        )}

        {failedCount > 0 && (
          <ThemedText variant="small" themeColor="textSecondary">
            {failedCount} photo{failedCount === 1 ? '' : 's'} could not be
            processed.
          </ThemedText>
        )}

        <ScrollView contentContainerStyle={styles.reviewList}>
          {withWalls.map((entry) => {
            const selected = entry.index === selectedIndex;
            const totalM = entry.walls.reduce(
              (sum, wall) => sum + wall.lengthM,
              0,
            );
            const keptCount = keptCountFor(entry.index);
            const savedId = savedRooms[entry.index];
            return (
              <View
                key={entry.index}
                style={[
                  styles.resultCard,
                  { backgroundColor: theme.backgroundElement },
                  selected && { borderColor: theme.primary, borderWidth: 2 },
                ]}
              >
                {/* The card selects the photo for curation; saving is a separate,
                    explicit action so "curate" and "commit" never blur together. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Select photo ${entry.index + 1}`}
                  onPress={() => setSelectedIndex(entry.index)}
                  style={styles.resultSelect}
                >
                  <Image
                    source={{ uri: photos[entry.index]?.uri ?? '' }}
                    style={styles.resultThumb}
                    contentFit="cover"
                  />
                  <View style={styles.resultText}>
                    <ThemedText variant="smallBold">
                      Photo {entry.index + 1} — {entry.walls.length} wall
                      {entry.walls.length === 1 ? '' : 's'}
                    </ThemedText>
                    <ThemedText variant="small" themeColor="textSecondary">
                      ~{totalM.toFixed(1)} m total · auto-detected, verify
                    </ThemedText>
                  </View>
                </Pressable>
                {savedId !== undefined ? (
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push(`/blueprint?room=${savedId}`)}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      { backgroundColor: theme.backgroundSelected },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipLabel, { color: theme.text }]}>
                      Saved — view plan
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    disabled={keptCount === 0}
                    onPress={() => handleSavePhoto(entry.index)}
                    style={({ pressed }) => [
                      styles.primaryButton,
                      { backgroundColor: theme.primary },
                      keptCount === 0 && styles.disabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.buttonLabel}>
                      Save as room ({keptCount} wall{keptCount === 1 ? '' : 's'}
                      )
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })}

          {selectedResult !== null && (
            <>
              <View
                style={[
                  styles.previewArea,
                  { backgroundColor: theme.backgroundElement },
                ]}
              >
                <BlueprintSvg plan={previewPlan} />
              </View>
              <ThemedText variant="smallBold">
                Suggested walls — tap to keep or remove
              </ThemedText>
              {selectedResult.walls.map((wall, i) => {
                const removed =
                  (deletedWalls[selectedResult.index] ?? [])[i] === true;
                return (
                  <Pressable
                    key={i}
                    accessibilityRole="button"
                    accessibilityLabel={
                      removed ? `Restore wall ${i + 1}` : `Remove wall ${i + 1}`
                    }
                    onPress={() => handleToggleWall(i)}
                    style={[
                      styles.wallRow,
                      { backgroundColor: theme.backgroundElement },
                      removed && styles.disabled,
                    ]}
                  >
                    <ThemedText
                      variant="small"
                      themeColor={removed ? 'textSecondary' : 'text'}
                    >
                      Wall {i + 1} — {wall.lengthM.toFixed(2)} m
                    </ThemedText>
                    <Text style={[styles.wallAction, { color: theme.text }]}>
                      {removed ? 'Restore' : 'Remove'}
                    </Text>
                  </Pressable>
                );
              })}
            </>
          )}
        </ScrollView>

        <View style={[styles.footer, { backgroundColor: theme.background }]}>
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              onPress={handleRetake}
              style={({ pressed }) => [
                styles.secondaryButton,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.buttonLabel, { color: theme.text }]}>
                Retake photos
              </Text>
            </Pressable>
            {anySaved && (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.back()}
                style={({ pressed }) => [
                  styles.primaryButton,
                  { backgroundColor: theme.primary },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.buttonLabel}>Done</Text>
              </Pressable>
            )}
          </View>
        </View>

        <ToastBubble message={toastMessage} />
      </ThemedView>
    );
  }

  // phase === 'camera'
  const cameraActive =
    screenFocused && permission?.granted === true && cameraError === null;

  return (
    <ThemedView
      style={[
        styles.container,
        { paddingBottom: Spacing.three + insets.bottom },
      ]}
    >
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
                  Camera access is needed for photo-assisted plans.
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

      <View style={[styles.nameBar, { backgroundColor: theme.background }]}>
        <TextInput
          value={roomName}
          onChangeText={handleNameChange}
          placeholder="Room name"
          placeholderTextColor={theme.textSecondary}
          maxLength={40}
          style={[styles.nameInput, { color: theme.text }]}
        />
      </View>

      <ThemedText variant="small" themeColor="textSecondary">
        Hold the phone level, 2–3 m from each wall. Up to {MAX_ASSIST_PHOTOS}{' '}
        photos; your self-hosted server proposes the walls — nothing leaves your
        network.
      </ThemedText>

      {photos.length > 0 && (
        <PhotoStrip
          photos={photos}
          onRemove={handleRemovePhoto}
          disabled={capturing}
        />
      )}

      <View style={[styles.footer, { backgroundColor: theme.background }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          disabled={
            !cameraReady || capturing || photos.length >= MAX_ASSIST_PHOTOS
          }
          onPress={() => void handleCapture()}
          style={({ pressed }) => [
            styles.shutter,
            { borderColor: theme.text },
            (!cameraReady || capturing || photos.length >= MAX_ASSIST_PHOTOS) &&
              styles.disabled,
            pressed && styles.pressed,
          ]}
        />
        <Pressable
          accessibilityRole="button"
          disabled={photos.length === 0}
          onPress={handleAnalyze}
          style={({ pressed }) => [
            styles.analyzeButton,
            {
              backgroundColor:
                photos.length > 0 ? theme.primary : theme.backgroundElement,
            },
            photos.length === 0 && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.buttonLabel}>
            {photos.length === 0
              ? 'Analyze photos'
              : `Analyze (${photos.length})`}
          </Text>
        </Pressable>
      </View>

      <ToastBubble message={toastMessage} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: Spacing.two,
    padding: Spacing.three,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
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
  nameBar: {
    paddingVertical: Spacing.one,
  },
  nameInput: {
    backgroundColor: 'transparent',
    fontSize: 16,
    fontWeight: 600,
    paddingVertical: Spacing.one,
  },
  reviewList: {
    gap: Spacing.two,
    paddingBottom: Spacing.two,
  },
  hintCard: {
    borderRadius: 12,
    padding: Spacing.three,
  },
  resultCard: {
    gap: Spacing.two,
    borderRadius: 12,
    padding: Spacing.two,
  },
  resultSelect: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  resultThumb: {
    width: 64,
    height: 64,
    borderRadius: 8,
  },
  chipLabel: {
    fontSize: 13,
    fontWeight: 600,
  },
  resultText: {
    flex: 1,
    gap: Spacing.half,
  },
  previewArea: {
    height: 240,
    borderRadius: 12,
  },
  wallRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  wallAction: {
    fontSize: 13,
    fontWeight: 700,
  },
  footer: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingTop: Spacing.two,
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    backgroundColor: 'transparent',
  },
  analyzeButton: {
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    justifyContent: 'center',
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
