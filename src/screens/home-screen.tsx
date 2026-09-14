import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { isPhotoAssistConfigured } from '@/lib/photo-assist-client';
import { listRooms } from '@/lib/session-store';

export function HomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();

  // Photo assist (plan Phase 2) is feature-flagged: it only appears when the operator
  // has configured a self-hosted MoGe service via EXPO_PUBLIC_PHOTO_ASSIST_URL.
  const photoAssistAvailable = isPhotoAssistConfigured();

  // Summary of existing work so returning users see where they left off instead of a
  // static hint (re-read on focus: stack screens stay mounted, and AR capture creates
  // rooms behind this screen).
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      setVersion((v) => v + 1);
    });
    return unsubscribe;
  }, [navigation]);
  // `version` is intentional: it forces a re-read of the in-memory session store after
  // mutations (react-hooks/exhaustive-deps cannot see module stores).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rooms = useMemo(() => listRooms(), [version]);
  const withPlans = rooms.filter((room) => room.hasPlan).length;

  const handleCreateBlueprint = useCallback(() => {
    router.push('/ar-capture');
  }, [router]);

  const handlePhotoAssist = useCallback(() => {
    router.push('/photo-assist');
  }, [router]);

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText variant="title" style={styles.title}>
          BlueprintAI
        </ThemedText>
        <ThemedText
          variant="small"
          themeColor="textSecondary"
          style={styles.tagline}
        >
          Turn your rooms into measured floor plans.
        </ThemedText>

        {rooms.length > 0 ? (
          <ThemedText
            variant="small"
            themeColor="textSecondary"
            style={styles.hint}
          >
            {rooms.length} room{rooms.length === 1 ? '' : 's'} · {withPlans}{' '}
            with plan{withPlans === 1 ? '' : 's'} — continue in Rooms.
          </ThemedText>
        ) : (
          <ThemedText
            variant="small"
            themeColor="textSecondary"
            style={styles.hint}
          >
            Walk the room in AR and tap each wall corner — real measurements, no
            cloud AI.
          </ThemedText>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={handleCreateBlueprint}
          style={({ pressed }) => [
            {
              backgroundColor: theme.primary,
              borderRadius: 999,
              paddingHorizontal: Spacing.five,
              paddingVertical: Spacing.three,
            },
            pressed && styles.buttonPressed,
          ]}
        >
          <Text style={styles.buttonLabel}>Measure room with AR</Text>
        </Pressable>

        {photoAssistAvailable && (
          <Pressable
            accessibilityRole="button"
            onPress={handlePhotoAssist}
            style={({ pressed }) => [
              {
                backgroundColor: theme.backgroundElement,
                borderRadius: 999,
                paddingHorizontal: Spacing.four,
                paddingVertical: Spacing.two,
              },
              pressed && styles.buttonPressed,
            ]}
          >
            <Text
              style={[styles.buttonLabel, { color: theme.text, fontSize: 14 }]}
            >
              Measure with photos
            </Text>
          </Pressable>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/capture')}
          style={({ pressed }) => [
            {
              backgroundColor: theme.backgroundElement,
              borderRadius: 999,
              paddingHorizontal: Spacing.four,
              paddingVertical: Spacing.two,
            },
            pressed && styles.buttonPressed,
          ]}
        >
          <Text
            style={[styles.buttonLabel, { color: theme.text, fontSize: 14 }]}
          >
            Sample plan from photos (testing)
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/rooms')}
          style={({ pressed }) => [
            {
              backgroundColor: theme.backgroundElement,
              borderRadius: 999,
              paddingHorizontal: Spacing.four,
              paddingVertical: Spacing.two,
            },
            pressed && styles.buttonPressed,
          ]}
        >
          <Text
            style={[styles.buttonLabel, { color: theme.text, fontSize: 14 }]}
          >
            Rooms
          </Text>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: Spacing.two,
    paddingHorizontal: Spacing.four,
  },
  title: {
    textAlign: 'center',
  },
  tagline: {
    marginBottom: Spacing.three,
  },
  hint: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 700,
  },
});
