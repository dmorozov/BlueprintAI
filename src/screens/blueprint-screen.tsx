import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
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
import { PhotoStrip } from '@/components/photo-strip';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { activeProvider, generateFloorPlan } from '@/lib/ai-provider';
import { mergeSameFramePlans } from '@/lib/ar-capture';
import type { FloorPlan } from '@/lib/blueprint-schema';
import { planToDxfString } from '@/lib/dxf-export';
import { savePlanToGallery } from '@/lib/gallery-save';
import {
  identityPlacement,
  mergePlacedPlans,
  type RoomPlacement,
} from '@/lib/plan-transform';
import { planToSvgString } from '@/lib/svg-export';
import {
  getArSession,
  getPhotos,
  getPlan,
  getPlacement,
  getRoomLabel,
  hasRoom,
  listRooms,
  setPlan as saveRoomPlan,
} from '@/lib/session-store';

/** Merges one AR session's room plans into a single plan (identity when alone). */
function mergeGroupPlans(ids: string[]): FloorPlan {
  const plans = ids.map((id) => getPlan(id)!);
  return plans.length > 1 ? mergeSameFramePlans(plans) : plans[0]!;
}

/** One non-anchor room group in the combined view. */
interface CombinedRoomEntry {
  /** Any room id of the group (the align editor pulls in the whole group). */
  id: string;
  label: string;
  placed: boolean;
}

type BlueprintStatus = 'working' | 'error' | 'done';

type ExportFormat = 'svg' | 'json' | 'dxf';

/**
 * Blueprint screen: generates (or shows a stored) floor plan and renders it as SVG.
 *
 * Two modes, selected by route params:
 * - room mode (`?room=<id>`): one room's photos → its plan via the provider (mock —
 *   the Gemini cloud path was removed in favor of on-device AR capture). Stored plans
 *   are shown without re-calling the provider.
 * - combined mode (`?view=combined`): merges AR-measured rooms into one plan —
 *   same-session rooms auto-align (shared tracking frame), rooms from other sessions
 *   join via their manually saved alignment. Pure geometry, deterministic, no AI and
 *   no network.
 *
 * The room-mode fetch runs inline in the mount effect (promise chain, no named
 * function call) because react-hooks/set-state-in-effect conservatively flags any
 * named function that captures a setState — even when every update happens after an
 * await.
 */
export function BlueprintScreen() {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const { room, view } = useLocalSearchParams<{
    room?: string;
    view?: 'combined';
  }>();
  const roomId = typeof room === 'string' ? room : '';
  const isCombined = view === 'combined';

  // Bumped whenever the screen regains focus so the combined view re-reads the
  // in-memory store after returning from the align editor (stack screens stay
  // mounted, so memos would otherwise keep their pre-navigation values).
  const [focusVersion, setFocusVersion] = useState(0);
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      setFocusVersion((v) => v + 1);
    });
    return unsubscribe;
  }, [navigation]);

  // Shown in the UI so mock results are never mistaken for real measurements.
  const provider = activeProvider();

  // --- combined mode: same-frame groups + manually aligned rooms ---------------
  // No provider call: rooms from one AR session are auto-aligned (shared tracking
  // frame); rooms from other sessions join the blueprint only after the user nudges
  // them into place via the align editor. Pure geometry, deterministic, no AI.
  // `focusVersion` is intentional: re-read the in-memory store on every focus
  // (react-hooks/exhaustive-deps cannot see module stores).
  const combined = useMemo(() => {
    if (!isCombined) return null;
    const bySession = new Map<string, string[]>();
    for (const summary of listRooms()) {
      if (!summary.hasPlan || summary.arSessionId === null) continue;
      const ids = bySession.get(summary.arSessionId) ?? [];
      ids.push(summary.id);
      bySession.set(summary.arSessionId, ids);
    }

    // Anchor: the largest same-frame group stays where it was (identity placement).
    let anchorIds: string[] = [];
    for (const ids of bySession.values()) {
      if (ids.length > anchorIds.length) anchorIds = ids;
    }

    const parts: { plan: FloorPlan; placement: RoomPlacement }[] = [];
    if (anchorIds.length > 0) {
      const anchorPlan = mergeGroupPlans(anchorIds);
      parts.push({
        plan: anchorPlan,
        placement: identityPlacement(anchorPlan),
      });
    }

    const otherGroups: CombinedRoomEntry[] = [];
    for (const [, ids] of bySession) {
      if (ids === anchorIds) continue;
      // A group joins the blueprint once any of its rooms has a stored placement.
      const stored = ids.map((id) => getPlacement(id)).find((p) => p !== null);
      const label = ids.map((id) => getRoomLabel(id) ?? id).join(' + ');
      if (stored !== undefined) {
        parts.push({ plan: mergeGroupPlans(ids), placement: stored });
        otherGroups.push({ id: ids[0]!, label, placed: true });
      } else {
        otherGroups.push({ id: ids[0]!, label, placed: false });
      }
    }

    return {
      mergedPlan: parts.length >= 2 ? mergePlacedPlans(parts) : null,
      otherGroups,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCombined, focusVersion]);

  const mergedPlan = combined?.mergedPlan ?? null;

  // --- room mode inputs (derived during render) ------------------------------
  const photos = useMemo(
    () => (isCombined ? [] : getPhotos(roomId)),
    [roomId, isCombined],
  );
  const missingPhotos =
    !isCombined && (!hasRoom(roomId) || photos.length === 0);

  // A stored plan (from an earlier generation) short-circuits the provider call.
  const storedPlan = useMemo(
    () => (roomId !== '' ? getPlan(roomId) : null),
    [roomId],
  );

  // True when this room's plan came from on-device AR tap-to-trace measurement.
  // Such a plan needs no photos, must not be regenerated by the mock provider, and
  // must never be labeled "mock" in the UI.
  const isArMeasured = useMemo(
    () => (roomId !== '' ? getArSession(roomId) !== null : false),
    [roomId],
  );

  // --- state ------------------------------------------------------------------
  const [status, setStatus] = useState<BlueprintStatus>(
    storedPlan !== null ? 'done' : 'working',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<FloorPlan | null>(storedPlan);
  // Bumped by retry to re-run the generation effect.
  const [generation, setGeneration] = useState(0);
  const inFlight = useRef(false);
  const didAutoRun = useRef(false);

  useEffect(() => {
    if (isCombined) return; // combined mode is a pure derivation, no provider call
    if (inFlight.current || missingPhotos) return;
    // First run with a stored plan: show it, skip the provider call entirely.
    if (!didAutoRun.current && storedPlan !== null) {
      didAutoRun.current = true;
      return;
    }
    didAutoRun.current = true;
    inFlight.current = true;
    generateFloorPlan(
      photos.map((photo) => ({
        base64: photo.base64,
        mimeType: photo.mimeType,
      })),
    )
      .then((result) => {
        saveRoomPlan(roomId, result);
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
  }, [photos, missingPhotos, isCombined, roomId, storedPlan, generation]);

  // Retry is an event: show the working state immediately and bump the generation.
  const handleRetry = useCallback(() => {
    if (missingPhotos || status === 'working') return;
    setStatus('working');
    setErrorMessage(null);
    setGeneration((current) => current + 1);
  }, [missingPhotos, status]);

  const handleBack = useCallback(() => {
    if (isCombined) router.push('/rooms');
    else router.back();
  }, [isCombined, router]);

  // --- export -----------------------------------------------------------------
  const displayedPlan: FloorPlan | null = isCombined ? mergedPlan : plan;

  const sharePlan = useCallback(
    async (format: ExportFormat) => {
      if (displayedPlan === null) return;
      const content =
        format === 'svg'
          ? planToSvgString(displayedPlan)
          : format === 'json'
            ? JSON.stringify(displayedPlan, null, 2)
            : planToDxfString(displayedPlan);
      try {
        await Share.share({
          message: content,
          title: `Blueprint (${format.toUpperCase()})`,
        });
      } catch {
        // Share sheet unavailable on this platform — nothing else to do.
      }
    },
    [displayedPlan],
  );

  const handleSaveToGallery = useCallback(async () => {
    if (displayedPlan === null) return;
    const label = isCombined ? 'combined' : (getRoomLabel(roomId) ?? 'room');
    try {
      await savePlanToGallery(displayedPlan, label);
      Alert.alert('Saved', 'Blueprint image saved to your photo library.');
    } catch (error) {
      Alert.alert(
        'Could not save to gallery',
        error instanceof Error ? error.message : 'Unknown error.',
      );
    }
  }, [displayedPlan, isCombined, roomId]);

  const handleExport = useCallback(() => {
    if (displayedPlan === null) return;
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
  }, [displayedPlan, sharePlan, handleSaveToGallery]);

  // --- render -----------------------------------------------------------------
  if (isCombined) {
    const otherGroups = combined?.otherGroups ?? [];
    return (
      <ThemedView style={styles.container}>
        {mergedPlan !== null ? (
          <>
            <View
              style={[
                styles.planArea,
                { backgroundColor: theme.backgroundElement },
              ]}
            >
              <BlueprintSvg plan={mergedPlan} />
            </View>
            <View style={styles.summary}>
              <ThemedText variant="small" themeColor="textSecondary">
                {mergedPlan.rooms.length} rooms in one blueprint — same-session
                rooms auto-aligned, others nudged into place. No AI.
              </ThemedText>
              <ThemedText variant="smallBold">
                {mergedPlan.walls.length} walls · {mergedPlan.rooms.length} room
                {mergedPlan.rooms.length === 1 ? '' : 's'} ·{' '}
                {mergedPlan.openings.length} openings
              </ThemedText>
            </View>
          </>
        ) : (
          <View style={styles.center}>
            <ThemedText variant="small">
              To combine rooms, measure at least two of them. Rooms from one AR
              session align automatically; rooms from different sessions can be
              nudged into place below.
            </ThemedText>
          </View>
        )}

        {otherGroups.length > 0 && (
          <View
            style={[
              styles.alignSection,
              { backgroundColor: theme.backgroundElement },
            ]}
          >
            <ThemedText variant="smallBold">
              Rooms from other AR sessions
            </ThemedText>
            {otherGroups.map((group) => (
              <View key={group.id} style={styles.alignRow}>
                <ThemedText variant="small" themeColor="textSecondary">
                  {group.label}
                  {group.placed ? ' — aligned' : ' — needs alignment'}
                </ThemedText>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push(`/align?room=${group.id}`)}
                  style={({ pressed }) => [
                    styles.chip,
                    { backgroundColor: theme.backgroundElement },
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.chipLabel, { color: theme.text }]}>
                    {group.placed ? 'Re-align' : 'Align'}
                  </Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={styles.actions}>
          {mergedPlan !== null && (
            <Pressable
              accessibilityRole="button"
              onPress={handleExport}
              style={({ pressed }) => [
                styles.primaryButton,
                { backgroundColor: theme.primary },
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.buttonLabel}>Export</Text>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={handleBack}
            style={({ pressed }) => [
              mergedPlan === null
                ? styles.primaryButton
                : styles.secondaryButton,
              {
                backgroundColor:
                  mergedPlan === null ? theme.primary : theme.backgroundElement,
              },
              pressed && styles.pressed,
            ]}
          >
            <Text
              style={[
                styles.buttonLabel,
                mergedPlan !== null && { color: theme.text },
              ]}
            >
              Rooms
            </Text>
          </Pressable>
        </View>
      </ThemedView>
    );
  }

  // Photos are only "missing" when there is also no stored plan to show — an
  // AR-measured room has a real plan but no photos by design.
  const blocked = missingPhotos && storedPlan === null;

  return (
    <ThemedView style={styles.container}>
      {blocked ? (
        <View style={styles.center}>
          <ThemedText variant="small">
            No photos found for this room. Go back and capture some.
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
            <Text style={styles.buttonLabel}>Retake photos</Text>
          </Pressable>
        </View>
      ) : status === 'working' ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" />
          <ThemedText variant="smallBold">
            {`Analyzing ${photos.length} photo${photos.length === 1 ? '' : 's'}…`}
          </ThemedText>
          <ThemedText variant="small" themeColor="textSecondary">
            This usually takes a few seconds.
          </ThemedText>
          {provider.id === 'mock' && (
            <ThemedText variant="small" themeColor="textSecondary">
              Mock mode — sample plan, not derived from your photos. Use the
              Measure room with AR flow for real measurements.
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
              Retake photos
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
          {/* Reference photos (AR capture) or captured photos — shown for the user's
              records; they never feed a plan in the no-external-API flow. */}
          {photos.length > 0 && (
            <PhotoStrip
              photos={photos}
              onRemove={() => undefined}
              removable={false}
            />
          )}
          {plan !== null && (
            <View style={styles.summary}>
              <ThemedText variant="small" themeColor="textSecondary">
                {isArMeasured
                  ? 'Measured on-device with AR tap-to-trace — real dimensions, no AI.'
                  : provider.id === 'mock'
                    ? 'Mock mode — sample plan, not derived from your photos.'
                    : 'Generated by the active provider.'}
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
            {/* Regenerate would replace a real AR measurement with a mock sample. */}
            {!isArMeasured && (
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
            )}
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
                {isArMeasured ? 'Re-measure with AR' : 'Retake photos'}
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
  alignSection: {
    gap: Spacing.two,
    borderRadius: 16,
    padding: Spacing.three,
  },
  alignRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
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
