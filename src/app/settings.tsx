import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { ModalHeader, Screen } from '../components/Screen';
import { Body, Card, Eyebrow, Mono, Switch } from '../components/primitives';
import { useStore } from '../store/AppStore';
import { colors, fonts, ink, line, radius } from '../theme/tokens';

const SYNC_LABEL: Record<string, string> = {
  off: 'Not backing up',
  syncing: 'Backing up\u2026',
  synced: 'Backed up',
  pending: 'Changes not sent yet',
  error: 'Could not back up',
};

export default function SettingsScreen() {
  const store = useStore();
  const router = useRouter();
  const auth = useAuth();

  const confirmSignOut = () =>
    Alert.alert(
      'Sign out?',
      'Your rounds stay on this phone. You will need your password to sign back in, and signing in again needs signal.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void auth.signOut() },
      ],
    );

  const toggleDemo = () => {
    const goingLive = store.demoMode;
    if (!goingLive) {
      store.setDemoMode(true);
      return;
    }
    Alert.alert(
      'Switch to your own data?',
      'Demo data stays where it is — it is stored separately and comes back whenever you switch demo mode on again. Your real groups and rounds are untouched by it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Switch', onPress: () => store.setDemoMode(false) },
      ],
    );
  };

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader eyebrow="Press" title="Settings" onClose={() => router.back()} />

      <View style={{ gap: 10 }}>
        <Eyebrow>Data</Eyebrow>
        <Card style={styles.row}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.name}>Demo data</Text>
            <Text style={styles.hint}>
              {store.demoMode
                ? 'Showing the Saturday Dogs at Pine Hollow — a live round and a season behind it.'
                : 'Showing your own groups and rounds. Nothing is made up.'}
            </Text>
          </View>
          <Switch on={store.demoMode} onToggle={toggleDemo} label="Demo data" />
        </Card>

        {store.demoMode ? (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              Alert.alert('Reset demo data?', 'Puts the example group back the way it started.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Reset', onPress: () => store.resetDemoData() },
              ])
            }
            style={styles.action}
          >
            <Text style={styles.actionText}>Reset demo data</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              Alert.alert(
                'Erase everything?',
                'Deletes every group, course and round you have entered. This cannot be undone.',
                [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Erase', style: 'destructive', onPress: () => store.eraseLiveData() },
                ],
              )
            }
            style={[styles.action, { borderColor: 'rgba(232,154,127,.4)' }]}
          >
            <Text style={[styles.actionText, { color: colors.clay }]}>Erase my data</Text>
          </Pressable>
        )}
      </View>

      {/* With more than one group on the phone there has to be a way to move
          between them — a society Saturday and a regular fourball are different
          rosters, different ledgers and different days. */}
      {store.groups.length > 1 ? (
        <View style={{ gap: 10 }}>
          <Eyebrow>Group</Eyebrow>
          {store.groups.map((g) => {
            const on = g.id === store.group?.id;
            const liveOuting = store.outings.find(
              (o) => o.groupId === g.id && o.status === 'active',
            );
            return (
              <Pressable
                key={g.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={g.name}
                onPress={() => store.setActiveGroup(g.id)}
                style={[styles.groupRow, on ? styles.groupRowOn : null]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name}>{g.name}</Text>
                  <Text style={styles.hint}>
                    {g.players.length} player{g.players.length === 1 ? '' : 's'}
                    {liveOuting ? ` · ${liveOuting.name} on now` : ''}
                  </Text>
                </View>
                <View style={[styles.check, on ? styles.checkOn : null]}>
                  {on ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <Eyebrow>Manage</Eyebrow>
        {[
          { label: 'Roster and group', href: '/roster' as const },
          { label: 'Courses', href: '/courses' as const },
          { label: 'Sides and rivals', href: '/sides' as const },
          { label: 'Round history', href: '/history' as const },
          { label: 'Set up an outing', href: '/new-outing' as const },
          { label: 'Join an outing by code', href: '/join' as const },
        ].map((item) => (
          <Pressable
            key={item.href}
            accessibilityRole="button"
            onPress={() => router.push(item.href)}
            style={styles.link}
          >
            <Text style={styles.linkText}>{item.label}</Text>
            <Mono size={11} style={{ color: ink.trace }}>
              ›
            </Mono>
          </Pressable>
        ))}
      </View>

      {auth.status === 'signed-in' ? (
        <View style={{ gap: 10 }}>
          <Eyebrow>Account</Eyebrow>
          <Card style={{ padding: 16, gap: 8 }}>
            <Text style={styles.name}>{auth.email ?? 'Signed in'}</Text>
            <Mono size={10.5} style={{ color: ink.ghost, lineHeight: 16 }}>
              {auth.unverified
                ? 'Signed in on this phone. Not re-checked with the server yet — that happens the next time you have signal.'
                : 'Edits you make in a shared outing are attributed to this account.'}
            </Mono>
          </Card>
          <Card style={{ padding: 16, gap: 8 }}>
            <Text style={styles.name}>{SYNC_LABEL[store.sync.status]}</Text>
            <Mono size={10.5} style={{ color: ink.ghost, lineHeight: 16 }}>
              {store.sync.status === 'error'
                ? `${store.sync.message ?? 'Could not reach the server.'} Your rounds are safe on this phone and will go up when it can.`
                : store.demoMode
                  ? 'Demo data is never sent anywhere. Switch to your own data to back it up.'
                  : 'Scores save on this phone first. The server is a copy, so nothing waits on signal.'}
            </Mono>
          </Card>

          <Pressable
            accessibilityRole="button"
            onPress={confirmSignOut}
            style={[styles.action, { borderColor: 'rgba(232,154,127,.4)' }]}
          >
            <Text style={[styles.actionText, { color: colors.clay }]}>Sign out</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <Eyebrow>About</Eyebrow>
        <Card style={{ padding: 16, gap: 8 }}>
          <Body style={{ color: ink.soft, lineHeight: 19 }}>
            Press settles nine formats off one card: Nassau with presses, skins with carryovers,
            junk, Stableford, four-ball, Wolf, Vegas, match play and stroke play. Everything is
            computed in whole cents and netted down to the fewest hand-offs.
          </Body>
          <Mono size={10.5} style={{ color: ink.ghost }}>
            v{Constants.expoConfig?.version ?? '1.0.0'} · {store.demoMode ? 'demo' : 'live'} dataset
          </Mono>
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  name: { fontFamily: fonts.sansSemi, fontSize: 14, color: ink.full },
  hint: { fontFamily: fonts.sans, fontSize: 11.5, color: ink.muted, marginTop: 3, lineHeight: 16 },
  action: {
    borderWidth: 1,
    borderColor: line.button,
    borderRadius: radius.card,
    paddingVertical: 13,
    alignItems: 'center',
  },
  actionText: { fontFamily: fonts.sansSemi, fontSize: 13.5, color: ink.body },
  link: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.cardDeep,
    borderWidth: 1,
    borderColor: line.card,
    borderRadius: radius.card,
    paddingVertical: 14,
    paddingHorizontal: 15,
  },
  linkText: { flex: 1, fontFamily: fonts.sans, fontSize: 14, color: ink.full },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.cardDeep,
    borderWidth: 1,
    borderColor: line.card,
    borderRadius: radius.card,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  groupRowOn: { borderColor: colors.accentSoft, backgroundColor: colors.cardActive },
  check: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: line.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { fontSize: 12, color: colors.screen, fontFamily: fonts.sansBold },
});
