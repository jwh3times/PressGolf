import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { ModalHeader, Screen } from '../components/Screen';
import { Avatar, Body, Card, Eyebrow, Money, Mono } from '../components/primitives';
import { settleRound } from '../domain/engine';
import { signedMoney } from '../domain/engine/context';
import { buildSeason } from '../domain/season';
import { useStore } from '../store/AppStore';
import { colors, fonts, ink, line, radius } from '../theme/tokens';

export default function HistoryScreen() {
  const store = useStore();
  const router = useRouter();
  const group = store.group;

  const rounds = useMemo(() => {
    if (!group) return [];
    return store.rounds
      .filter((r) => r.groupId === group.id)
      .slice()
      .sort((a, b) => b.startedAt - a.startedAt);
  }, [group, store.rounds]);

  const season = useMemo(
    () => (group ? buildSeason(group, store.rounds, store.courses) : null),
    [group, store.rounds, store.courses],
  );

  if (!group) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="History" onClose={() => router.back()} closeLabel="Back" />
      </Screen>
    );
  }

  const confirmDelete = (roundId: string, label: string) =>
    Alert.alert(`Delete ${label}?`, 'It comes out of the season ledger for good.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => store.deleteRound(roundId) },
    ]);

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader
        eyebrow={group.name}
        title="History"
        onClose={() => router.back()}
        closeLabel="Back"
      />

      {season && season.roundsCounted > 0 ? (
        <View style={{ gap: 8 }}>
          <Eyebrow>Season totals · {season.roundsCounted} settled</Eyebrow>
          {season.entries.map((entry) => {
            const player = group.players.find((p) => p.id === entry.playerId);
            if (!player) return null;
            return (
              <View key={entry.playerId} style={styles.seasonRow}>
                <Avatar initials={player.initials} color={player.color} size={28} />
                <Text style={styles.name} numberOfLines={1}>
                  {player.name}
                </Text>
                <Mono size={10.5} style={{ color: ink.quiet }}>
                  {entry.roundsPlayed} rd
                </Mono>
                <Money cents={entry.net} label={signedMoney(entry.net)} size={13} />
              </View>
            );
          })}
        </View>
      ) : null}

      <View style={{ gap: 10 }}>
        <Eyebrow>Rounds</Eyebrow>
        {rounds.length === 0 ? (
          <Card style={{ padding: 16 }}>
            <Body style={{ color: ink.soft }}>Nothing played yet.</Body>
          </Card>
        ) : (
          rounds.map((round) => {
            const course = store.courses.find((c) => c.id === round.courseId);
            const settlement = course ? settleRound(round, course, group.players) : null;
            const you = group.youId ? settlement?.net[group.youId] ?? 0 : 0;
            const date = new Date(round.startedAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            });
            const label = `${course?.name ?? 'Unknown course'} · ${date}`;
            return (
              <Pressable
                key={round.id}
                accessibilityRole="button"
                onPress={() => {
                  if (round.status === 'active') {
                    store.setActiveRound(round.id);
                    router.replace('/score');
                    return;
                  }
                  Alert.alert(label, 'Reopen this round to correct a score?', [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => confirmDelete(round.id, label),
                    },
                    {
                      text: 'Reopen',
                      onPress: () => {
                        store.reopenRound(round.id);
                        router.replace('/score');
                      },
                    },
                  ]);
                }}
                style={styles.row}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {course?.name ?? 'Unknown course'}
                    </Text>
                    {round.status === 'active' ? (
                      <View style={styles.liveTag}>
                        <Text style={styles.liveText}>LIVE</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.meta}>
                    {date} · {round.playerIds.length} players · thru {settlement?.thru ?? 0}
                  </Text>
                </View>
                {group.youId ? <Money cents={you} label={signedMoney(you)} size={13} /> : null}
              </Pressable>
            );
          })
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: line.soft,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.cardDeep,
    borderWidth: 1,
    borderColor: line.card,
    borderRadius: radius.card,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  name: { flex: 1, minWidth: 0, fontFamily: fonts.sansSemi, fontSize: 14, color: ink.full },
  meta: { fontFamily: fonts.sans, fontSize: 11.5, color: ink.soft, marginTop: 2 },
  liveTag: {
    backgroundColor: 'rgba(139,224,174,.15)',
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 5,
  },
  liveText: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.85, color: colors.accent },
});
