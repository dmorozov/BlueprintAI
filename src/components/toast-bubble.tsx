import { useEffect, useMemo } from 'react';
import {
  Animated,
  Easing,
  Platform,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

type ToastBubbleProps = {
  /** Text to display; pass `null` to hide the bubble. */
  message: string | null;
};

/** Spring parameters for the entrance animation. */
const SPRING_IN = { friction: 7, tension: 80 } as const;

/** Duration of the fade-out animation in milliseconds. */
const FADE_OUT_MS = 200;

/** Distance the bubble slides up from while animating in, in logical pixels. */
const SLIDE_DISTANCE = 16;

/** Extra gap between the safe-area bottom and the bubble (logical pixels). */
const BASE_BOTTOM = Platform.select({ ios: 16, default: 8 }) ?? 8;

/**
 * A lightweight notification bubble ("toast") that springs in at the bottom of
 * the screen and fades out when hidden. Pure React Native — no native modules —
 * so it behaves identically on Android, iOS, and web.
 */
export function ToastBubble({ message }: ToastBubbleProps) {
  // On Android (edge-to-edge since API 35) the bubble must clear the navigation
  // bar, not just sit at a fixed offset from the physical bottom edge.
  const insets = useSafeAreaInsets();
  // Memoized rather than stored in a ref: the value must keep its identity
  // across renders so an in-flight animation is never restarted.
  const progress = useMemo(() => new Animated.Value(0), []);

  useEffect(() => {
    if (message !== null) {
      Animated.spring(progress, {
        ...SPRING_IN,
        toValue: 1,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0,
        duration: FADE_OUT_MS,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    }
  }, [message, progress]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [SLIDE_DISTANCE, 0],
  });
  const shadowStyle: ViewStyle | undefined =
    Platform.OS === 'android'
      ? styles.androidShadow
      : Platform.OS === 'ios'
        ? styles.iosShadow
        : undefined;

  return (
    <View
      pointerEvents="none"
      style={[styles.container, { bottom: insets.bottom + BASE_BOTTOM }]}
    >
      <Animated.View
        accessibilityRole="alert"
        style={[
          styles.bubble,
          shadowStyle,
          { opacity: progress, transform: [{ translateY }] },
        ]}
      >
        <Text style={styles.text}>{message ?? ''}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  bubble: {
    backgroundColor: 'rgba(17, 17, 19, 0.92)',
    borderRadius: 999,
    paddingHorizontal: 20,
    paddingVertical: 12,
    maxWidth: '85%',
  },
  androidShadow: {
    elevation: 6,
  },
  iosShadow: {
    shadowColor: '#000000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  text: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 600,
    textAlign: 'center',
  },
});
