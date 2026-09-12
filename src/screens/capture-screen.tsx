import { CameraView, useCameraPermissions } from 'expo-camera';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { PhotoStrip } from '@/components/photo-strip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ToastBubble } from '@/components/toast-bubble';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { preparePhoto, type ProcessedPhoto } from '@/lib/image-pipeline';
import {
  addPhoto,
  createRoom,
  getPhotos,
  getRoomLabel,
  hasRoom,
  removePhoto,
  renameRoom,
} from '@/lib/session-store';

const TOAST_DURATION_MS = 2500;

/**
 * Capture screen: permission gate → live camera preview → shutter → per-room photo
 * strip → hand off to the blueprint screen. Joins the room given via `?room=` (from the
 * room list) or creates a new one; the room name is editable in place.
 */
export function CaptureScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const { room } = useLocalSearchParams<{ room?: string }>();

  // Join an existing room when opened with a valid id; otherwise start a new one.
  const [roomId] = useState(() =>
    typeof room === 'string' && hasRoom(room) ? room : createRoom(),
  );

  const cameraRef = useRef<CameraView | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [screenFocused, setScreenFocused] = useState(true);
  const [capturing, setCapturing] = useState(false);
  const [photos, setPhotos] = useState<ProcessedPhoto[]>(() =>
    getPhotos(roomId),
  );
  const [roomName, setRoomName] = useState(() => getRoomLabel(roomId) ?? '');
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNameChange = useCallback(
    (text: string) => {
      setRoomName(text);
      renameRoom(roomId, text);
    },
    [roomId],
  );

  // The camera docs require unmounting the preview whenever the screen is unfocused
  // (only one active camera preview is allowed at a time).
  useFocusEffect(
    useCallback(() => {
      setScreenFocused(true);
      return () => setScreenFocused(false);
    }, []),
  );

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

  // Callback ref: when the preview unmounts (screen blur / permission loss) React
  // passes null, which resets readiness so the shutter stays disabled until the
  // camera is ready again.
  const handleCameraRef = useCallback((instance: CameraView | null) => {
    cameraRef.current = instance;
    if (instance === null) setCameraReady(false);
  }, []);

  const cameraActive = screenFocused && permission?.granted === true;

  const handleCapture = useCallback(async () => {
    if (!cameraReady || capturing) return;
    setCapturing(true);
    try {
      const camera = cameraRef.current;
      if (camera === null) return;
      // exif: false keeps GPS/EXIF out of the upload payload. skipProcessing stays off
      // (default) so Android devices with misoriented sensors still save straight photos.
      const picture = await camera.takePictureAsync({
        quality: 0.85,
        exif: false,
      });
      const photo = await preparePhoto(picture, `photo-${Date.now()}`);
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

  const handleRemove = useCallback(
    (key: string) => {
      removePhoto(roomId, key);
      setPhotos((prev) => prev.filter((photo) => photo.key !== key));
    },
    [roomId],
  );

  const handleGenerate = useCallback(() => {
    router.push(`/blueprint?room=${roomId}`);
  }, [router, roomId]);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.cameraArea}>
        {cameraActive ? (
          <CameraView
            ref={handleCameraRef}
            style={StyleSheet.absoluteFill}
            facing="back"
            mode="picture"
            onCameraReady={() => setCameraReady(true)}
          />
        ) : (
          <View
            style={[
              styles.placeholder,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            {permission?.granted === false ? (
              <>
                <ThemedText variant="small" themeColor="textSecondary">
                  Camera access is needed to capture photos of your space.
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void requestPermission()}
                  style={({ pressed }) => [
                    styles.permissionButton,
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

      {photos.length > 0 && (
        <PhotoStrip
          photos={photos}
          onRemove={handleRemove}
          disabled={capturing}
        />
      )}

      <View style={[styles.footer, { backgroundColor: theme.background }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          disabled={!cameraReady || capturing}
          onPress={() => void handleCapture()}
          style={({ pressed }) => [
            styles.shutter,
            { borderColor: theme.text },
            (!cameraReady || capturing) && styles.disabled,
            pressed && styles.pressed,
          ]}
        />
        <Pressable
          accessibilityRole="button"
          disabled={photos.length === 0 || capturing}
          onPress={handleGenerate}
          style={({ pressed }) => [
            styles.generateButton,
            {
              backgroundColor:
                photos.length > 0 ? theme.primary : theme.backgroundElement,
            },
            (photos.length === 0 || capturing) && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text
            style={[
              styles.buttonLabel,
              photos.length === 0 && { color: theme.textSecondary },
            ]}
          >
            {capturing
              ? 'Processing…'
              : `Generate blueprint (${photos.length})`}
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
  permissionButton: {
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  nameBar: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  nameInput: {
    backgroundColor: 'transparent',
    fontSize: 16,
    fontWeight: 600,
    paddingVertical: Spacing.one,
  },
  footer: {
    alignItems: 'center',
    gap: Spacing.three,
    paddingTop: Spacing.three,
    paddingBottom: Spacing.four,
  },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 4,
    backgroundColor: 'transparent',
  },
  generateButton: {
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 700,
  },
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.8,
  },
});
