import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { ModalHeader, Screen } from '../components/Screen';
import { Body, Card, Eyebrow, Mono, Switch } from '../components/primitives';
import { useStore } from '../store/AppStore';
import { colors, fonts, ink, line, radius } from '../theme/tokens';

export default function SettingsScreen() {
  const store = useStore();
  const router = useRouter();

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

      <View style={{ gap: 10 }}>
        <Eyebrow>Manage</Eyebrow>
        {[
          { label: 'Roster and group', href: '/roster' as const },
          { label: 'Courses', href: '/courses' as const },
          { label: 'Sides and rivals', href: '/sides' as const },
          { label: 'Round history', href: '/history' as const },
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
});
