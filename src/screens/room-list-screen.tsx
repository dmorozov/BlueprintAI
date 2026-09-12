import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import {
  createRoom,
  deleteRoom,
  listRooms,
  type RoomSummary,
} from '@/lib/session-store';

/**
 * Room list: every captured room with its photo count and plan status. Tapping a card
 * opens its blueprint (when generated) or the capture screen; per-card actions add more
 * photos or delete the room. The combined-blueprint button assembles all rooms with
 * photos into one layout.
 */
export function RoomListScreen() {
  const theme = useTheme();
  const router = useRouter();
  // Bumped after store mutations to recompute the list.
  const [version, setVersion] = useState(0);
  // `version` is intentional: it forces a re-read of the in-memory session store after
  // mutations (react-hooks/exhaustive-deps cannot see module stores).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rooms = useMemo(() => listRooms(), [version]);

  const roomsWithPhotos = rooms.filter((room) => room.photoCount > 0).length;
  const canCombine = roomsWithPhotos >= 2;

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const handleNewRoom = useCallback(() => {
    const id = createRoom();
    router.push(`/capture?room=${id}`);
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
              ? `Generate combined blueprint (${roomsWithPhotos} rooms)`
              : 'Combined blueprint needs at least 2 rooms with photos'}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
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
                {room.hasPlan ? 'plan ready' : 'no plan yet'}
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
