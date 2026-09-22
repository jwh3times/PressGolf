import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { resendConfirmation } from '../sync/supabase';
import { MIN_PASSWORD_LENGTH, authErrorMessage, emailProblem, passwordProblem } from '../auth/validate';
import { Screen } from './Screen';
import { Body, Display, Eyebrow, Mono, PrimaryButton } from './primitives';
import { Field } from './Field';
import { colors, fonts, ink } from '../theme/tokens';

type Mode = 'sign-in' | 'sign-up';

/**
 * The way in.
 *
 * Shown instead of the app until this phone has an account, and never shown
 * again once it has — the session is persisted, and a phone that has signed in
 * before is let straight through even with no signal. See AuthProvider.
 */
export function SignInScreen() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Set once an address is known to exist but not yet be confirmed, which is
  // the only state where offering to send the email again makes sense.
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);

  const swapMode = () => {
    setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in');
    setError(null);
    setNotice(null);
  };

  const resend = async () => {
    if (!unconfirmed) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await resendConfirmation(unconfirmed);
      setNotice('Sent again. It can take a minute to arrive.');
    } catch (e) {
      setError(e instanceof Error ? authErrorMessage(e.message) : 'Could not send that again.');
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    const problem = emailProblem(email) ?? passwordProblem(password);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (mode === 'sign-up') {
        const { needsConfirmation } = await signUp(email, password);
        if (needsConfirmation) {
          setUnconfirmed(email);
          setNotice(
            'Account created. Tap the link in the email we sent, then come back here and sign in.',
          );
          setMode('sign-in');
        }
      } else {
        await signIn(email, password);
      }
      // On success the session lands and the gate swaps this screen out; there
      // is nothing to navigate to.
    } catch (e) {
      const message =
        e instanceof Error ? authErrorMessage(e.message) : 'Something went wrong. Try again.';
      // Signing in before following the link is the likeliest way to end up
      // here, and the one case where sending it again is the actual fix.
      if (/email confirmed/i.test(message)) setUnconfirmed(email);
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.screen }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen floatingTabBar={false} contentStyle={styles.content}>
        <View style={{ gap: 8 }}>
          <Eyebrow>Press</Eyebrow>
          <Display size={34}>
            {mode === 'sign-in' ? 'Sign in' : 'Create an account'}
          </Display>
          <Body style={{ color: ink.soft, lineHeight: 19 }}>
            {mode === 'sign-in'
              ? 'Your account is what puts your name against a score when the group is scoring on four phones at once.'
              : 'One account per person. It is what attributes an edit to you when several phones are scoring the same card.'}
          </Body>
        </View>

        <View style={{ gap: 14 }}>
          <Field
            label="Email"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
          />
          <Field
            label="Password"
            placeholder={mode === 'sign-up' ? `At least ${MIN_PASSWORD_LENGTH} characters` : ''}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            textContentType={mode === 'sign-up' ? 'newPassword' : 'password'}
            returnKeyType="go"
            onSubmitEditing={() => {
              if (!busy) void submit();
            }}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {busy ? (
          <View style={{ alignItems: 'center', paddingVertical: 16 }}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <PrimaryButton
            label={mode === 'sign-in' ? 'Sign in' : 'Create account'}
            onPress={() => {
              void submit();
            }}
          />
        )}

        {unconfirmed && !busy ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void resend();
            }}
            hitSlop={8}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignItems: 'center' })}
          >
            <Text style={styles.swap}>Send the confirmation email again</Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={swapMode}
          hitSlop={8}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, alignItems: 'center' })}
        >
          <Text style={styles.swap}>
            {mode === 'sign-in' ? 'No account yet? Create one' : 'Already have an account? Sign in'}
          </Text>
        </Pressable>

        <View style={{ gap: 6 }}>
          <Eyebrow>Once you are in</Eyebrow>
          <Mono size={11} style={{ color: ink.quiet, lineHeight: 17 }}>
            You stay signed in. The app opens straight onto your card after this, with or without
            signal — scoring, settling and the season ledger all run on the phone.
          </Mono>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { gap: 24, justifyContent: 'center', flexGrow: 1 },
  error: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.clay, lineHeight: 17 },
  notice: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.accent, lineHeight: 17 },
  swap: { fontFamily: fonts.sansSemi, fontSize: 13, color: ink.muted },
});
