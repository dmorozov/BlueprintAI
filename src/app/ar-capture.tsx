import { ActivityIndicator, StyleSheet } from 'react-native';
import { lazy, Suspense } from 'react';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/**
 * The AR capture screen imports @reactvision/react-viro, whose module graph calls into
 * Viro's native modules at import time. In a build that lacks that native code (Expo Go
 * or a stale dev client) the chunk's evaluation fails — and depending on how Metro
 * reports it, the dynamic import may reject OR resolve to an empty/undefined module.
 * A rejected or broken lazy element makes React throw "Element type is invalid", which
 * escapes error boundaries — so the loader validates what it received and, on any
 * failure, resolves to a plain fallback component instead. Viro must never be imported
 * eagerly: expo-router evaluates every route's static module graph when the bundle
 * loads, so an eager import would take down the whole app at startup.
 */
function ArUnavailable() {
  return (
    <ThemedView style={styles.center}>
      <ThemedText variant="small">
        AR measurement is not available in this app build — ViroReact needs the
        native development build. Rebuild it with `npx expo run:android` (or
        your EAS dev client); Expo Go does not include AR support.
      </ThemedText>
    </ThemedView>
  );
}

const ArCaptureScreen = lazy(async () => {
  try {
    const mod = await import('@/screens/ar-capture-screen');
    const screen = mod?.ArCaptureScreen;
    if (typeof screen !== 'function') {
      // Chunk evaluated to an empty/undefined module (Viro native code missing).
      throw new Error('AR capture screen failed to load.');
    }
    return { default: screen };
  } catch {
    // Resolve to the fallback so React always receives a valid component.
    return { default: ArUnavailable };
  }
});

function Loading() {
  return (
    <ThemedView style={styles.center}>
      <ActivityIndicator size="large" />
    </ThemedView>
  );
}

export default function ArCapture() {
  return (
    <Suspense fallback={<Loading />}>
      <ArCaptureScreen />
    </Suspense>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
});
