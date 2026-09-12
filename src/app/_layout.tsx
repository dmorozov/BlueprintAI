import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

// Keep the native splash visible until the JS bundle has rendered its first frame.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="rooms" options={{ title: 'Rooms' }} />
        <Stack.Screen name="capture" options={{ title: 'Capture' }} />
        <Stack.Screen name="blueprint" options={{ title: 'Blueprint' }} />
      </Stack>
    </ThemeProvider>
  );
}
