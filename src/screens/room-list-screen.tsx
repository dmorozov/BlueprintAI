import { useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatAreaM2 } from '@/lib/blueprint-schema';
import { deleteRoom, listRooms, type RoomSummary } from '@/lib/session-store';

/**
 * Room list: every captured room with its photo count and plan status. Tapping a card
 * opens its blueprint (when generated) or the capture screen; per-card actions add more
 * photos or delete the room. "New room" starts AR tap-to-trace measurement; the
 * combine button merges all AR-measured rooms — same-session rooms auto-align,
 * cross-session rooms via their saved manual alignment (align editor).
 */
export function RoomListScreen() {
  const theme = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  // Edge-to-edge (Android API 35+): the last card must scroll clear of the nav bar.
  const insets = useSafeAreaInsets();
  // Bumped after store mutations and on every focus so the list re-reads the
  // in-memory session store (e.g. after returning from AR capture, which creates
  // new rooms). Stack screens stay mounted, so memos need this explicit refresh.
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

  // Any two rooms with a plan in their own frame can be combined: same-AR-session
  // rooms auto-align (shared tracking frame), everything else — including each
  // photo-assist room, which gets its own frame id — is nudged into place.
  const combinableCount = useMemo(
    () =>
      rooms.filter((room) => room.hasPlan && room.arSessionId !== null).length,
    [rooms],
  );
  const canCombine = combinableCount >= 2;

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // The AR screen creates its own room session, so no pre-creation here.
  const handleNewRoom = useCallback(() => {
    router.push('/ar-capture');
  }, [router]);

  const handleOpen = useCallback(
    (room: RoomSummary) => {
      router.push(
        room.hasPlan
          ? `/blueprint?room=${room.id}`
          : `/capture?room=${room.id}`,
      );
    },
    [router],
  );

  const handleAddPhotos = useCallback(
    (room: RoomSummary) => {
      router.push(`/capture?room=${room.id}`);
    },
    [router],
  );

  const handleDelete = useCallback(
    (room: RoomSummary) => {
      Alert.alert(
        'Delete room?',
        `This removes "${room.label}", its photos, and its generated plan.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: () => {
              deleteRoom(room.id);
              refresh();
            },
          },
        ],
      );
    },
    [refresh],
  );

  const handleCombine = useCallback(() => {
    router.push('/blueprint?view=combined');
  }, [router]);

  return (
    <ThemedView style={styles.container}>
      <View style={styles.topActions}>
        <Pressable
          accessibilityRole="button"
          onPress={handleNewRoom}
          style={({ pressed }) => [
            styles.primaryButton,
            { backgroundColor: theme.primary },
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.buttonLabel}>New room</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!canCombine}
          onPress={handleCombine}
          style={({ pressed }) => [
            styles.secondaryButton,
            { backgroundColor: theme.backgroundElement },
            !canCombine && styles.disabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={[styles.buttonLabel, { color: theme.text }]}>
            {canCombine
              ? `Combine ${combinableCount} room plans`
              : 'Combine needs 2+ rooms with plans'}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={[
          styles.list,
          { paddingBottom: Spacing.four + insets.bottom },
        ]}
      >
        {rooms.length === 0 && (
          <ThemedText variant="small" themeColor="textSecondary">
            No rooms yet — create one to get started.
          </ThemedText>
        )}
        {rooms.map((room) => (
          <View
            key={room.id}
            style={[styles.card, { backgroundColor: theme.backgroundElement }]}
          >
            <Pressable
              accessibilityRole="button"
              onPress={() => handleOpen(room)}
              style={styles.cardBody}
            >
              <ThemedText variant="smallBold">{room.label}</ThemedText>
              <ThemedText variant="small" themeColor="textSecondary">
                {room.photoCount} photo{room.photoCount === 1 ? '' : 's'} ·{' '}
                {room.hasPlan
                  ? room.planSource === 'ar-tap'
                    ? 'Measured in AR'
                    : room.planSource === 'photo-assist'
                      ? 'From photos — check it'
                      : 'plan ready'
                  : 'no plan yet'}
                {room.hasPlan && formatAreaM2(room.areaM2) !== null && (
                  <> · {formatAreaM2(room.areaM2)}</>
                )}
              </ThemedText>
            </Pressable>
            <View style={styles.cardActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => handleAddPhotos(room)}
                style={({ pressed }) => [
                  styles.chip,
                  { backgroundColor: theme.backgroundSelected },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipLabel, { color: theme.text }]}>
                  Add photos
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Delete ${room.label}`}
                onPress={() => handleDelete(room)}
                style={({ pressed }) => [
                  styles.chip,
                  { backgroundColor: theme.backgroundSelected },
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipLabel, { color: theme.text }]}>×</Text>
              </Pressable>
            </View>
          </View>
        ))}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  topActions: {
    gap: Spacing.two,
    padding: Spacing.three,
  },
  primaryButton: {
    borderRadius: 999,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  secondaryButton: {
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    alignItems: 'center',
  },
  buttonLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 700,
  },
  list: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.four,
  },
  card: {
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardBody: {
    flex: 1,
    padding: Spacing.three,
    gap: Spacing.half,
  },
  cardActions: {
    gap: Spacing.one,
    paddingRight: Spacing.two,
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
  disabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.8,
  },
});
