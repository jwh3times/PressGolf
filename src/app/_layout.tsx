import {
  InstrumentSans_400Regular,
  InstrumentSans_500Medium,
  InstrumentSans_600SemiBold,
  InstrumentSans_700Bold,
} from '@expo-google-fonts/instrument-sans';
import { InstrumentSerif_400Regular } from '@expo-google-fonts/instrument-serif';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
  JetBrainsMono_700Bold,
} from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthGate } from '../auth/AuthGate';
import { AuthProvider } from '../auth/AuthProvider';
import { AppStoreProvider } from '../store/AppStore';
import { colors } from '../theme/tokens';

// Must run before the first render, not inside the component, or the native
// splash is already gone by the time the effect fires. The splash is the
// loading state: it stays up until the fonts have settled and the gate knows
// whether it is showing the app or the way in, so there is neither a flash of
// system-face text nor a spinner before the sign-in screen. AuthGate hides it.
SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 300, fade: true });

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    InstrumentSerif_400Regular,
    InstrumentSans_400Regular,
    InstrumentSans_500Medium,
    InstrumentSans_600SemiBold,
    InstrumentSans_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });

  // A font that fails to download should not brick the app — the layout still
  // works on the system face, it just loses the typographic character.
  const ready = fontsLoaded || fontError != null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.screen }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {ready ? (
          <AuthProvider>
            <AuthGate>
              <AppStoreProvider>
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: colors.screen },
                    animation: 'slide_from_right',
                  }}
                >
                  <Stack.Screen name="(tabs)" />
                  <Stack.Screen name="settings" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="roster" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="courses" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="course/[id]" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="new-round" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="new-outing" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="outing" options={{ animation: 'slide_from_right' }} />
                  <Stack.Screen name="field-games" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="groups" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="join" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="sides" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
                  <Stack.Screen name="history" options={{ animation: 'slide_from_right' }} />
                </Stack>
              </AppStoreProvider>
            </AuthGate>
          </AuthProvider>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.screen }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
