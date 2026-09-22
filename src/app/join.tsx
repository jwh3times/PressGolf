import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Field } from '../components/Field';
import { ModalHeader, Screen } from '../components/Screen';
import { Body, Card, Eyebrow, Mono, PrimaryButton } from '../components/primitives';
import { isSupabaseConfigured, joinOuting } from '../sync/supabase';
import { useStore } from '../store/AppStore';
import { colors, fonts, ink, radius } from '../theme/tokens';

/**
 * Joining somebody else's outing with a six-character code.
 *
 * The code is the shared secret that decides which outing you land in; the
 * account behind it is what puts your name on the edits once you are there.
 * You are already signed in by the time this screen can be reached.
 */
export default function JoinScreen() {
  const store = useStore();
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const configured = isSupabaseConfigured();

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const me = store.group?.players.find((p) => p.id === store.group?.youId) ?? null;
      const result = await joinOuting(code, me?.id ?? null, me?.name ?? null);
      // The organiser's device owns the outing document; this pulls the copy
      // that was published and hands it to the store.
      router.replace(`/outing?joined=${encodeURIComponent(result.outingId)}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not join that outing.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader eyebrow="Multiplayer" title="Join an outing" onClose={() => router.back()} />

      {!configured ? (
        <Card style={{ padding: 16, gap: 10 }}>
          <Body style={{ color: colors.gold, lineHeight: 19 }}>
            This build has no server configured, so everything stays on this phone.
          </Body>
          <Mono size={11} style={{ color: ink.ghost, lineHeight: 17 }}>
            Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY, and run
            supabase/schema.sql once in your project. The README has the steps.
          </Mono>
        </Card>
      ) : (
        <>
          <Body style={{ color: ink.soft, lineHeight: 19 }}>
            Whoever set the day up has a six-character code. Type it in and your scores go into the
            same card as everybody else’s.
          </Body>

          <Field
            label="Join code"
            placeholder="ABC123"
            value={code}
            onChangeText={(text) => setCode(text.toUpperCase().slice(0, 6))}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            style={styles.codeInput}
          />

          {error ? <Text style={styles.error}>{error}</Text> : null}

          {busy ? (
            <View style={{ alignItems: 'center', paddingVertical: 12 }}>
              <ActivityIndicator color={colors.accent} />
            </View>
          ) : (
            <PrimaryButton
              label="Join"
              disabled={code.length < 6}
              onPress={() => {
                void submit();
              }}
            />
          )}
        </>
      )}

      <View style={{ gap: 6 }}>
        <Eyebrow>How it behaves out there</Eyebrow>
        <Mono size={11} style={{ color: ink.ghost, lineHeight: 17 }}>
          Scores save on your phone first and sync when there is signal. Lose the radio on the back
          nine and nothing stops — the edits queue up and go out when you walk back into range.
        </Mono>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  codeInput: {
    fontFamily: fonts.monoBold,
    fontSize: 24,
    letterSpacing: 6,
    textAlign: 'center',
    paddingVertical: 18,
    borderRadius: radius.panel,
  },
  error: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.clay, lineHeight: 17 },
});
