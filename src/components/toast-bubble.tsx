import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';

type ToastBubbleProps = {
  /** Text to display; pass `null` to hide the bubble. */
  message: string | null;
};

/**
 * A lightweight notification bubble ("toast") that springs in at the bottom of
 * the screen and fades out when hidden. Pure React Native — no native modules —
 * so it behaves identically on Android, iOS, and web.
 */
export function ToastBubble({ message }: ToastBubbleProps) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (message !== null) {
      Animated.spring(progress, {
        toValue: 1,
        friction: 7,
        tension: 80,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(progress, {
        toValue: 0,
        duration: 200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }).start();
    }
  }, [message, progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });
  const shadow =
    Platform.OS === 'android' ? styles.androidShadow : Platform.OS === 'ios' ? styles.iosShadow : undefined;

  return (
    <View pointerEvents="none" style={styles.container}>
      <Animated.View
        accessibilityRole="alert"
        style={[styles.bubble, shadow, { opacity: progress, transform: [{ translateY }] }]}
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
    bottom: Platform.select({ ios: 48, default: 32 }),
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
