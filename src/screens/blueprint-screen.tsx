import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BlueprintSvg } from '@/components/blueprint-svg';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  activeProvider,
  generateCombinedPlan,
  generateFloorPlan,
} from '@/lib/ai-provider';
import type { FloorPlan } from '@/lib/blueprint-schema';
import { planToDxfString } from '@/lib/dxf-export';
import { savePlanToGallery } from '@/lib/gallery-save';
import { planToSvgString } from '@/lib/svg-export';
import {
  getCombinedPlan,
  getPhotos,
  getPlan,
  getRoomLabel,
  hasRoom,
  listRooms,
  setCombinedPlan,
  setPlan as saveRoomPlan,
} from '@/lib/session-store';

type BlueprintStatus = 'working' | 'error' | 'done';

type ExportFormat = 'svg' | 'json' | 'dxf';

/**
 * Blueprint screen: generates (or shows a stored) floor plan and renders it as SVG.
 *
 * Two modes, selected by route params:
 * - room mode (`?room=<id>`): one room's photos → its plan (persisted in the session
 *   store, so reopening the room shows the stored plan without another AI call).
 * - combined mode (`?view=combined`): all rooms with photos assembled into one plan.
 *
 * The fetch runs inline in the mount effect (promise chain, no named function call)
 * because react-hooks/set-state-in-effect conservatively flags any named function that
 * captures a setState — even when every update happens after an await.
 */
export function BlueprintScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { room, view } = useLocalSearchParams<{
    room?: string;
    view?: 'combined';
  }>();
  const roomId = typeof room === 'string' ? room : '';
  const isCombined = view === 'combined';

  // Shown in the UI so mock results are never mistaken for real AI output.
  const provider = activeProvider();

  // Bumped by retry to re-run the generation effect (also refreshes combined inputs).
  const [generation, setGeneration] = useState(0);

  // --- inputs (derived during render) -------------------------------------
  const photos = useMemo(
    () => (isCombined ? [] : getPhotos(roomId)),
    [roomId, isCombined],
  );
  const missingPhotos =
    !isCombined && (!hasRoom(roomId) || photos.length === 0);

  const combinedRooms = useMemo(() => {
    if (!isCombined) return [];
    return listRooms()
      .filter((r) => r.photoCount > 0)
      .map((r) => ({
        label: r.label,
        photos: getPhotos(r.id).map((photo) => ({
          base64: photo.base64,
          mimeType: photo.mimeType,
        })),
        plan: getPlan(r.id),
      }));
    // `generation` is intentional: retry must re-read the in-memory store even when
    // no React state changed (react-hooks/exhaustive-deps cannot see module stores).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCombined, generation]);

  const insufficientRooms = isCombined && combinedRooms.length < 2;

  // A stored plan (from an earlier generation) short-circuits the AI call.
  const storedPlan = useMemo(
    () =>
      isCombined ? getCombinedPlan() : roomId !== '' ? getPlan(roomId) : null,
    [roomId, isCombined],
  );

  // --- state ----------------------------------------------------------------
  const [status, setStatus] = useState<BlueprintStatus>(
    storedPlan !== null ? 'done' : 'working',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<FloorPlan | null>(storedPlan);
  const inFlight = useRef(false);
  const didAutoRun = useRef(false);

  useEffect(() => {
    if (inFlight.current || missingPhotos || insufficientRooms) return;
    // First run with a stored plan: show it, skip the AI call entirely.
    if (!didAutoRun.current && storedPlan !== null) {
      didAutoRun.current = true;
      return;
    }
    didAutoRun.current = true;
    inFlight.current = true;
    const request = isCombined
      ? generateCombinedPlan(combinedRooms)
      : generateFloorPlan(
          photos.map((photo) => ({
            base64: photo.base64,
            mimeType: photo.mimeType,
          })),
        );
    request
      .then((result) => {
        if (isCombined) setCombinedPlan(result);
        else saveRoomPlan(roomId, result);
        setPlan(result);
        setStatus('done');
      })
      .catch((error) => {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : 'Unexpected error while generating the blueprint.',
        );
        setStatus('error');
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [
    photos,
    missingPhotos,
    insufficientRooms,
    combinedRooms,
    isCombined,
    roomId,
    storedPlan,
    generation,
  ]);

  // Retry is an event: show the working state immediately and bump the generation.
  const handleRetry = useCallback(() => {
    if (missingPhotos || insufficientRooms || status === 'working') return;
    setStatus('working');
    setErrorMessage(null);
    setGeneration((current) => current + 1);
  }, [missingPhotos, insufficientRooms, status]);

  const handleBack = useCallback(() => {
    if (isCombined) router.push('/rooms');
    else router.back();
  }, [isCombined, router]);

  // --- export ----------------------------------------------------------------
  const sharePlan = useCallback(
    async (format: ExportFormat) => {
      if (plan === null) return;
      const content =
        format === 'svg'
          ? planToSvgString(plan)
          : format === 'json'
            ? JSON.stringify(plan, null, 2)
            : planToDxfString(plan);
      try {
        await Share.share({
          message: content,
          title: `Blueprint (${format.toUpperCase()})`,
        });
      } catch {
        // Share sheet unavailable on this platform — nothing else to do.
      }
    },
    [plan],
  );

  const handleSaveToGallery = useCallback(async () => {
    if (plan === null) return;
    const label = isCombined ? 'combined' : (getRoomLabel(roomId) ?? 'room');
    try {
      await savePlanToGallery(plan, label);
      Alert.alert('Saved', 'Blueprint image saved to your photo library.');
    } catch (error) {
      Alert.alert(
        'Could not save to gallery',
        error instanceof Error ? error.message : 'Unknown error.',
      );
    }
  }, [plan, isCombined, roomId]);

  const handleExport = useCallback(() => {
    if (plan === null) return;
    Alert.alert('Export blueprint', 'Choose a format to share:', [
      {
        text: 'Save image to gallery',
        onPress: () => void handleSaveToGallery(),
      },
      { text: 'SVG image', onPress: () => void sharePlan('svg') },
      { text: 'JSON data', onPress: () => void sharePlan('json') },
      { text: 'DXF (CAD)', onPress: () => void sharePlan('dxf') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [plan, sharePlan, handleSaveToGallery]);

  // --- render -----------------------------------------------------------------
  const blocked = missingPhotos || insufficientRooms;

  return (
    <ThemedView style={styles.container}>
      {blocked ? (
        <View style={styles.center}>
          <ThemedText variant="small">
            {missingPhotos
              ? 'No photos found for this room. Go back and capture some.'
              : 'A combined blueprint needs at least 2 rooms with photos.'}
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={handleBack}
            style={({ pressed }) => [
              styles.primaryButton,
              { backgroundColor: theme.primary },
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.buttonLabel}>
              {isCombined ? 'Back to rooms' : 'Retake photos'}
            </Text>
          </Pressable>
        </View>
      ) : status === 'working' ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
          <ThemedText variant="smallBold">
            {isCombined
              ? `Assembling ${combinedRooms.length} rooms…`
              : `Analyzing ${photos.length} photo${photos.length === 1 ? '' : 's'}…`}
          </ThemedText>
          <ThemedText variant="small" themeColor="textSecondary">
            This usually takes a few seconds. Dimensions are estimates.
          </ThemedText>
          {provider.id === 'mock' && (
            <ThemedText variant="small" themeColor="textSecondary">
              Mock mode — sample plan, no AI call is made.
            </ThemedText>
          )}
        </View>
      ) : status === 'error' ? (
        <View style={styles.center}>
          <ThemedText variant="small">{errorMessage}</ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={handleRetry}
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
            onPress={handleBack}
            style={({ pressed }) => [
              styles.secondaryButton,
              { backgroundColor: theme.backgroundElement },
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.buttonLabel, { color: theme.text }]}>
              {isCombined ? 'Back to rooms' : 'Retake photos'}
            </Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View
            style={[
              styles.planArea,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            <BlueprintSvg plan={plan ?? emptyPlan} />
          </View>
          {plan !== null && (
            <View style={styles.summary}>
              <ThemedText variant="small" themeColor="textSecondary">
                {provider.id === 'mock'
                  ? isCombined
                    ? 'Mock mode — sample combined layout.'
                    : 'Mock mode — sample plan, not derived from your photos.'
                  : isCombined
                    ? 'Combined blueprint generated by Gemini.'
                    : 'Generated by Gemini.'}
              </ThemedText>
              <ThemedText variant="smallBold">
                {plan.walls.length} walls · {plan.rooms.length} room
                {plan.rooms.length === 1 ? '' : 's'} · {plan.openings.length}{' '}
                openings
              </ThemedText>
              {plan.notes !== undefined && (
                <ThemedText variant="small" themeColor="textSecondary">
                  {plan.notes}
                </ThemedText>
              )}
            </View>
          )}
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={handleRetry}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.primary },
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.buttonLabel}>Regenerate</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={handleExport}
              style={({ pressed }) => [
                styles.secondaryButton,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.buttonLabel, { color: theme.text }]}>
                Export
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={handleBack}
              style={({ pressed }) => [
                styles.secondaryButton,
                { backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.buttonLabel, { color: theme.text }]}>
                {isCombined ? 'Rooms' : 'Retake photos'}
              </Text>
            </Pressable>
          </View>
        </>
      )}
    </ThemedView>
  );
}

/** Placeholder plan for the (unreachable) done-without-plan render branch. */
const emptyPlan: FloorPlan = {
  unit: 'meters',
  walls: [],
  rooms: [],
  openings: [],
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    gap: Spacing.three,
    padding: Spacing.three,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  planArea: {
    flex: 1,
    borderRadius: 16,
    padding: Spacing.two,
  },
  summary: {
    gap: Spacing.one,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: Spacing.two,
    paddingBottom: Spacing.two,
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
  pressed: {
    opacity: 0.8,
  },
});
