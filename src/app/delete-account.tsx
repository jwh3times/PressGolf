import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { Field } from '../components/Field';
import { ModalHeader, Screen } from '../components/Screen';
import { Body, Eyebrow, GhostButton } from '../components/primitives';
import { useStore } from '../store/AppStore';
import { alpha } from '../theme/color';
import { makeStyles, useTheme } from '../theme/theme';
import { fonts, MIN_TAP_TARGET, radius } from '../theme/tokens';

/**
 * The last stop before an account is deleted.
 *
 * A screen rather than an Alert: there is too much to say, it needs a password
 * field, and Alert doesn't work on the web build. Nothing happens until the
 * password is typed and the button pressed. On success the store signs out, and
 * the gate replaces all of this with the way in.
 */
export default function DeleteAccountScreen() {
  const styles = useStyles();
  const { colors, ink } = useTheme();
  const store = useStore();
  const auth = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await store.deleteAccount(password);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not delete your account. Try again.';
      setError(message);
      // The alert below reaches the web. iOS has no live regions, and TalkBack can
      // miss one that's only just appeared, so the phones are told outright too.
      AccessibilityInfo.announceForAccessibility(message);
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.screen }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen floatingTabBar={false}>
        {/* The request can't be called back once sent, so this button waits for its answer. */}
        <ModalHeader
          eyebrow="Account"
          title="Delete account"
          onClose={() => {
            if (!busy) router.back();
          }}
        />

        <Body style={{ color: ink.soft, lineHeight: 19 }}>
          This deletes {auth.email ?? 'your account'} and everything it owns from the server, straight
          away. There is no grace period, and it can’t be undone.
        </Body>

        <View style={styles.section}>
          <Eyebrow>What goes</Eyebrow>
          <Body style={styles.item}>Your groups, rosters and rounds.</Body>
          <Body style={styles.item}>Your courses, with their greens, maps and hole notes.</Body>
          <Body style={styles.item}>Your clubs and usual score.</Body>
          <Body style={styles.item}>
            Outings you organised, for everyone, including scores guests typed. Guests keep what’s
            already on their phones.
          </Body>
        </View>

        <View style={styles.section}>
          <Eyebrow>What stays</Eyebrow>
          <Body style={styles.item}>Scores you typed into someone else’s card stay with them.</Body>
        </View>

        <View style={styles.section}>
          <Eyebrow>Your phones</Eyebrow>
          <Body style={styles.item}>
            This phone goes back to first run: your rounds, bag and practice rounds on it are erased,
            and you’re signed out. The demo data stays.
          </Body>
          <Body style={styles.item}>
            Other phones signed in to this account lose access, but keep what’s on them until the app
            is removed or its data is erased.
          </Body>
        </View>

        <Field
          label="Password"
          hint="Enter your password to confirm."
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="done"
          editable={!busy}
        />

        {error ? (
          <Text accessibilityRole="alert" accessibilityLiveRegion="assertive" style={styles.error}>
            {error}
          </Text>
        ) : null}

        {busy ? (
          <View style={{ alignItems: 'center', paddingVertical: 16 }}>
            <ActivityIndicator accessibilityLabel="Deleting your account" color={colors.accent} />
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !password }}
              disabled={!password}
              onPress={() => {
                void confirm();
              }}
              style={[styles.destroy, !password ? { opacity: 0.35 } : null]}
            >
              <Text style={styles.destroyText}>Delete my account</Text>
            </Pressable>
            <GhostButton label="Keep my account" onPress={() => router.back()} />
          </View>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles(({ colors, ink }) =>
  StyleSheet.create({
    section: { gap: 6 },
    item: { color: ink.body, lineHeight: 19 },
    error: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.clay, lineHeight: 17 },
    destroy: {
      borderWidth: 1,
      borderColor: alpha(colors.clay, 0.4),
      borderRadius: radius.card,
      minHeight: MIN_TAP_TARGET,
      paddingVertical: 13,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    destroyText: { fontFamily: fonts.sansSemi, fontSize: 13.5, color: colors.clay, textAlign: 'center' },
  }),
);
