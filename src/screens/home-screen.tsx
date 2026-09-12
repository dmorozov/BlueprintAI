import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ToastBubble } from '@/components/toast-bubble';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

const TOAST_DURATION_MS = 2000;

export function HomeScreen() {
  const theme = useTheme();
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
          React Native · Expo · TypeScript
        </ThemedText>

        <Pressable
          accessibilityRole="button"
          onPress={() => showToast('Test clicked!')}
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
          <Text style={styles.buttonLabel}>Test</Text>
        </Pressable>
      </SafeAreaView>

      <ToastBubble message={toastMessage} />
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
    marginBottom: Spacing.six,
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
