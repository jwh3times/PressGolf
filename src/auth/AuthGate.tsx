import React, { useEffect } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { ActivityIndicator, View } from 'react-native';
import { SignInScreen } from '../components/SignInScreen';
import { colors } from '../theme/tokens';
import { useAuth } from './AuthProvider';

/**
 * Decides whether the app or the way in gets rendered.
 *
 * `disabled` means this build has no server at all, so there is nobody to sign
 * in as and the app runs local-only — the same as it always did. The splash is
 * held until that decision is made, so nobody sees a spinner before the
 * question has even been asked.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();

  useEffect(() => {
    if (status !== 'loading') void SplashScreen.hideAsync();
  }, [status]);

  if (status === 'loading') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.screen }}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (status === 'signed-out') return <SignInScreen />;

  return <>{children}</>;
}
