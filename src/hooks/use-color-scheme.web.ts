import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

/** Store with no subscribers; only used for its snapshot behavior. */
const emptySubscribe = (): (() => void) => () => {};

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web.
 * `useSyncExternalStore` reads the server snapshot (`false`) until after hydration, so the
 * first client render matches the server output without a post-mount state update.
 */
export function useColorScheme() {
  const colorScheme = useRNColorScheme();
  const hasHydrated = useSyncExternalStore(emptySubscribe, () => true, () => false);

  return hasHydrated ? colorScheme : 'light';
}
