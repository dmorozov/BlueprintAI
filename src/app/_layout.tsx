import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme, type StyleProp, type ViewStyle } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// Keep the native splash visible until the JS bundle has rendered its first frame.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    // Required root for react-native-gesture-handler (used by the align editor).
    <GestureHandlerRootView style={rootStyle}>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Stack>
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="rooms" options={{ title: 'Rooms' }} />
          <Stack.Screen
            name="ar-capture"
            options={{ title: 'Measure with AR' }}
          />
          <Stack.Screen name="capture" options={{ title: 'Capture' }} />
          <Stack.Screen
            name="photo-assist"
            options={{ title: 'Measure with photos' }}
          />
          <Stack.Screen name="blueprint" options={{ title: 'Blueprint' }} />
          <Stack.Screen name="align" options={{ title: 'Align room' }} />
        </Stack>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

const rootStyle: StyleProp<ViewStyle> = { flex: 1 };
