import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BlueprintSvg } from '@/components/blueprint-svg';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { activeProvider, generateFloorPlan } from '@/lib/ai-provider';
import type { FloorPlan } from '@/lib/blueprint-schema';
import { getPhotos, hasRoom } from '@/lib/session-store';

type BlueprintStatus = 'working' | 'error' | 'done';

/**
 * Blueprint screen: takes the room's captured photos, sends them to the AI provider,
 * and renders the resulting floor plan as SVG. Supports retrying the generation and
 * going back to retake photos.
 *
 * The fetch runs inline in the mount effect (promise chain, no named function call)
 * because react-hooks/set-state-in-effect conservatively flags any named function that
 * captures a setState — even when every update happens after an await.
 */
export function BlueprintScreen() {
  const theme = useTheme();
  const router = useRouter();
  const { room } = useLocalSearchParams<{ room: string }>();
  const roomId = typeof room === 'string' ? room : '';

  const photos = useMemo(() => getPhotos(roomId), [roomId]);
  // Derived during render (not effect state): nothing to generate without photos.
  const missingPhotos = !hasRoom(roomId) || photos.length === 0;
  // Shown in the UI so mock results are never mistaken for real AI output.
  const provider = activeProvider();

  const [status, setStatus] = useState<BlueprintStatus>('working');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<FloorPlan | null>(null);
  // Bumped by retry to re-run the generation effect.
  const [generation, setGeneration] = useState(0);
  const inFlight = useRef(false);

  useEffect(() => {
    if (inFlight.current || missingPhotos) return;
    inFlight.current = true;
    generateFloorPlan(
      photos.map((photo) => ({
        base64: photo.base64,
        mimeType: photo.mimeType,
      })),
    )
      .then((result) => {
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
  }, [photos, missingPhotos, generation]);

  // Retry is an event: show the working state immediately and bump the generation.
  const handleRetry = useCallback(() => {
    if (missingPhotos || status === 'working') return;
    setStatus('working');
    setErrorMessage(null);
    setGeneration((current) => current + 1);
  }, [missingPhotos, status]);

  const handleRetake = useCallback(() => {
    router.back();
  }, [router]);

  return (
    <ThemedView style={styles.container}>
      {missingPhotos ? (
        <View style={styles.center}>
          <ThemedText variant="small">
            No photos found for this room. Go back and capture some.
          </ThemedText>
          <Pressable
            accessibilityRole="button"
            onPress={handleRetake}
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
            Analyzing {photos.length} photo{photos.length === 1 ? '' : 's'}…
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
                  ? 'Mock mode — sample plan, not derived from your photos.'
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
    justifyContent: 'center',
    gap: Spacing.three,
    paddingBottom: Spacing.two,
  },
  primaryButton: {
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  secondaryButton: {
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 700,
  },
  pressed: {
    opacity: 0.8,
  },
});
