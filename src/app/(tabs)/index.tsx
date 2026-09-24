import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LivePulse } from '../../components/LivePulse';
import { Screen } from '../../components/Screen';
import {
  Avatar,
  Body,
  Card,
  Display,
  Divider,
  EmptyState,
  Eyebrow,
  GameDot,
  GhostButton,
  Money,
  Mono,
  PrimaryButton,
} from '../../components/primitives';
import { potTotal } from '../../domain/engine';
import { money, signedMoney } from '../../domain/engine/context';
import { buildSeason, seasonSubtitle } from '../../domain/season';
import { useLargeText } from '../../hooks/useLargeText';
import { useStore } from '../../store/AppStore';
import { colors, fonts, ink, line, radius } from '../../theme/tokens';

export default function HomeScreen() {
  const store = useStore();
  const router = useRouter();
  const largeText = useLargeText();
  const { group, round, course, settlement } = store;

  const season = useMemo(
    () => (group ? buildSeason(group, store.rounds, store.courses) : null),
    [group, store.rounds, store.courses],
  );

  // Any day still running that this group is out on.
  const activeOuting = useMemo(
    () => store.outings.find((o) => o.status === 'active' && o.groupId === group?.id) ?? null,
    [store.outings, group],
  );

  const outingPot = useMemo(() => {
    if (!activeOuting) return 0;
    return Object.values(activeOuting.fieldGames).reduce(
      (sum, g) => sum + (g.on ? g.buyIn * g.entrants.length : 0),
      0,
    );
  }, [activeOuting]);

  if (!store.ready) return <Screen><Body>Loading…</Body></Screen>;

  if (!group) {
    return (
      <Screen>
        <View style={{ gap: 6 }}>
          <Eyebrow>Press</Eyebrow>
          <Display size={33}>No group yet</Display>
        </View>
        <EmptyState
          title="Start with your group"
          body="Add the regulars, set their pops, and Press will do the arguing for you."
          action={<PrimaryButton label="Create a group" onPress={() => router.push('/roster')} style={{ alignSelf: 'stretch' }} />}
        />
        <GhostButton label="Settings" onPress={() => router.push('/settings')} />
      </Screen>
    );
  }

  const players = group.players;

  return (
    <Screen>
      <View style={[styles.headerRow, largeText ? styles.stackRow : null]}>
        <View style={[styles.flexCopy, largeText ? styles.fullWidth : null]}>
          <Eyebrow>Your group</Eyebrow>
          <Display size={33} style={{ marginTop: 3 }}>
            {group.name}
          </Display>
          {group.subtitle ? (
            <Text style={styles.subtitle}>{group.subtitle}</Text>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings')}
          hitSlop={8}
          style={styles.gear}
        >
          <Text maxFontSizeMultiplier={1.25} style={{ fontSize: 14, color: ink.muted }}>⚙</Text>
        </Pressable>
      </View>

      {/* A day with more than one group out gets its own entry point — the
          round card below still shows whichever group this phone is in. */}
      {activeOuting ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            store.setActiveOuting(activeOuting.id);
            router.push('/outing');
          }}
          style={[styles.outingRow, largeText ? styles.stackRow : null]}
        >
          <View style={[styles.flexCopy, largeText ? styles.fullWidth : null]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <LivePulse size={6} color={colors.gold} />
              <Text style={styles.outingLabel}>Outing on</Text>
            </View>
            <Text style={styles.outingName} numberOfLines={largeText ? undefined : 1}>
              {activeOuting.name}
            </Text>
            <Text style={styles.outingMeta}>
              {activeOuting.field.length} out · {activeOuting.roundIds.length} groups ·{' '}
              {money(outingPot)} in the pots
            </Text>
          </View>
          <Mono size={11} style={{ color: ink.quiet }}>
            ›
          </Mono>
        </Pressable>
      ) : null}

      {round && course && settlement ? (
        <LiveRoundCard
          thru={settlement.thru}
          pot={potTotal(settlement)}
          gameCount={settlement.games.length}
          onEnterScores={() => router.push('/score')}
          standings={players
            .filter((p) => round.playerIds.includes(p.id))
            .map((p) => ({
              id: p.id,
              initials: p.initials,
              color: p.color,
              net: settlement.net[p.id] ?? 0,
            }))}
          largeText={largeText}
        />
      ) : (
        <EmptyState
          title="No round going"
          body={
            players.length < 2
              ? 'Add at least two players before you can tee it up.'
              : 'Set the format, pick a course, and start entering scores.'
          }
          action={
            <View style={{ alignSelf: 'stretch', gap: 8 }}>
              <PrimaryButton
                label={players.length < 2 ? 'Add players' : 'Start a round'}
                onPress={() => router.push(players.length < 2 ? '/roster' : '/new-round')}
              />
              {players.length >= 2 ? (
                <GhostButton
                  label="More than one group? Set up an outing"
                  onPress={() => router.push('/new-outing')}
                />
              ) : null}
            </View>
          }
        />
      )}

      {round && settlement ? (
        <View style={{ gap: 10 }}>
          <Eyebrow>Today’s games</Eyebrow>
          {settlement.games.length === 0 ? (
            <Card style={styles.noGames}>
              <Body style={{ color: ink.soft }}>Nothing switched on. Every hole is just golf.</Body>
            </Card>
          ) : (
            settlement.games.map((game) => (
              <View key={game.key} style={[styles.gameRow, largeText ? styles.stackRow : null]}>
                <GameDot color={game.color} />
                <View style={[styles.flexCopy, largeText ? styles.fullWidth : null]}>
                  <Text style={styles.gameName}>{game.name}</Text>
                  <Text style={styles.gameDetail}>
                    {game.blocked ? game.blockedReason : game.detail}
                  </Text>
                </View>
                <Mono size={12} style={{ color: ink.body }}>
                  {money(round.games[game.key].stake)}
                </Mono>
              </View>
            ))
          )}
          <GhostButton dashed label="Edit the format" onPress={() => router.push('/format')} />
        </View>
      ) : null}

      {season ? (
        <View style={{ gap: 6 }}>
          <View style={[styles.seasonHeader, largeText ? styles.stackRow : null]}>
            <Eyebrow>Season ledger</Eyebrow>
            <Pressable accessibilityRole="button" onPress={() => router.push('/history')} hitSlop={8}>
              <Text style={styles.seasonMeta}>{seasonSubtitle(season)} ›</Text>
            </Pressable>
          </View>
          {season.roundsCounted === 0 ? (
            <Card style={styles.noGames}>
              <Body style={{ color: ink.soft }}>
                Nothing settled yet. Finish a round and it lands here.
              </Body>
            </Card>
          ) : (
            season.entries.map((entry, index) => {
              const player = players.find((p) => p.id === entry.playerId);
              if (!player) return null;
              const width = season.peak ? Math.min(60, (Math.abs(entry.net) / season.peak) * 60) : 0;
              return (
                <View
                  key={entry.playerId}
                  style={[styles.seasonRow, largeText ? styles.seasonRowLarge : null]}
                >
                  <View style={[styles.seasonIdentity, largeText ? styles.fullWidth : null]}>
                    <Mono size={11} style={{ color: ink.quiet, width: 14 }}>
                      {index + 1}
                    </Mono>
                    <Avatar initials={player.initials} color={player.color} size={26} />
                    <Text style={styles.seasonName} numberOfLines={largeText ? undefined : 1}>
                      {player.name}
                    </Text>
                  </View>
                  <View style={[styles.barTrack, largeText ? styles.barTrackLarge : null]}>
                    <View
                      style={{
                        width,
                        height: 5,
                        borderRadius: 999,
                        opacity: 0.75,
                        backgroundColor: entry.net >= 0 ? colors.accent : colors.clay,
                      }}
                    />
                  </View>
                  <Money cents={entry.net} label={signedMoney(entry.net)} />
                </View>
              );
            })
          )}
        </View>
      ) : null}
    </Screen>
  );
}

function LiveRoundCard({
  thru,
  pot,
  gameCount,
  standings,
  onEnterScores,
  largeText,
}: {
  thru: number;
  pot: number;
  gameCount: number;
  standings: { id: string; initials: string; color: string; net: number }[];
  onEnterScores: () => void;
  largeText: boolean;
}) {
  return (
    <LinearGradient
      colors={[colors.gradientFrom, colors.gradientTo]}
      // 160deg in CSS runs top-left to bottom-right; these points match it.
      start={{ x: 0.18, y: 0 }}
      end={{ x: 0.82, y: 1 }}
      style={styles.live}
    >
      <View style={[styles.liveTop, largeText ? styles.stackRow : null]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <LivePulse />
          <Text style={styles.liveLabel}>Round live</Text>
        </View>
        <Mono size={11} style={{ color: ink.muted }}>
          THRU {thru}
        </Mono>
      </View>

      <View style={[styles.liveMiddle, largeText ? styles.liveMiddleLarge : null]}>
        <View>
          <Display size={32}>{money(pot)}</Display>
          <Text style={styles.liveSub}>
            swinging across {gameCount} game{gameCount === 1 ? '' : 's'}
          </Text>
        </View>
        <PrimaryButton
          label="Enter scores"
          onPress={onEnterScores}
          style={largeText ? styles.liveButtonLarge : styles.liveButton}
        />
      </View>

      <Divider />

      <View style={[styles.standings, largeText ? styles.standingsLarge : null]}>
        {standings.map((p) => (
          <View key={p.id} style={[styles.standing, largeText ? styles.standingLarge : null]}>
            <Avatar initials={p.initials} color={p.color} size={34} />
            <Money cents={p.net} label={signedMoney(p.net)} />
          </View>
        ))}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  stackRow: { flexDirection: 'column', alignItems: 'flex-start' },
  flexCopy: { flex: 1, minWidth: 0 },
  fullWidth: { flex: 0, width: '100%' },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  subtitle: { fontFamily: fonts.sans, fontSize: 12, color: ink.soft, marginTop: 4 },
  gear: {
    width: 38,
    height: 38,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: line.avatar,
    alignItems: 'center',
    justifyContent: 'center',
  },
  live: {
    borderWidth: 1,
    borderColor: colors.accentSoft,
    borderRadius: radius.hero,
    padding: 18,
    gap: 15,
  },
  liveTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  liveLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: colors.accent,
  },
  liveMiddle: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  liveMiddleLarge: { flexDirection: 'column', alignItems: 'stretch' },
  liveButton: { borderRadius: 999, paddingVertical: 12, paddingHorizontal: 20 },
  liveButtonLarge: { borderRadius: 999, paddingVertical: 12, paddingHorizontal: 20, alignSelf: 'stretch' },
  liveSub: { fontFamily: fonts.sans, fontSize: 11, color: ink.soft, marginTop: 4 },
  standing: { flex: 1, alignItems: 'center', gap: 7 },
  standings: { flexDirection: 'row', gap: 8 },
  standingsLarge: { flexWrap: 'wrap' },
  standingLarge: { flexBasis: '45%' },
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: line.card,
    borderRadius: radius.card,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  gameName: { fontFamily: fonts.sansSemi, fontSize: 14, color: ink.full },
  gameDetail: { fontFamily: fonts.sans, fontSize: 11.5, color: ink.soft, marginTop: 2 },
  noGames: { padding: 16 },
  seasonHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  seasonMeta: { fontFamily: fonts.sans, fontSize: 11, color: ink.quiet },
  outingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.cardDeep,
    borderWidth: 1,
    borderColor: 'rgba(232,196,106,.28)',
    borderRadius: radius.card,
    paddingVertical: 13,
    paddingHorizontal: 15,
  },
  outingLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: colors.gold,
  },
  outingName: { fontFamily: fonts.sansSemi, fontSize: 15, color: ink.full, marginTop: 4 },
  outingMeta: { fontFamily: fonts.sans, fontSize: 11.5, color: ink.soft, marginTop: 2 },
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: line.soft,
  },
  seasonRowLarge: { flexDirection: 'column', alignItems: 'stretch' },
  seasonIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 11 },
  seasonName: { flex: 1, minWidth: 0, fontFamily: fonts.sans, fontSize: 13.5, color: ink.full },
  barTrack: { width: 74, alignItems: 'center', justifyContent: 'center' },
  barTrackLarge: { display: 'none' },
});
