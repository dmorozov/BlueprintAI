import { Image } from 'expo-image';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { ProcessedPhoto } from '@/lib/image-pipeline';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

interface PhotoStripProps {
  photos: ProcessedPhoto[];
  onRemove: (key: string) => void;
  /** Disables the remove buttons (e.g. while a capture is being processed). */
  disabled?: boolean;
}

const THUMBNAIL_SIZE = 72;

/** Horizontal strip of captured photo thumbnails with per-photo removal. */
export function PhotoStrip({
  photos,
  onRemove,
  disabled = false,
}: PhotoStripProps) {
  const theme = useTheme();

  if (photos.length === 0) return null;

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {photos.map((photo) => (
          <View key={photo.key} style={styles.item}>
            <Image
              source={{ uri: photo.uri }}
              style={styles.thumbnail}
              contentFit="cover"
              transition={150}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove photo ${photo.key}`}
              disabled={disabled}
              onPress={() => onRemove(photo.key)}
              style={({ pressed }) => [
                styles.removeButton,
                { backgroundColor: theme.backgroundElement },
                (pressed || disabled) && styles.pressed,
              ]}
            >
              <Text style={[styles.removeLabel, { color: theme.text }]}>×</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'transparent',
  },
  row: {
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  item: {
    position: 'relative',
  },
  thumbnail: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
    borderRadius: 12,
  },
  removeButton: {
    position: 'absolute',
    top: -8,
    right: -8,
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeLabel: {
    fontSize: 16,
    fontWeight: 700,
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.6,
  },
});
