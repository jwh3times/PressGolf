import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { ModalHeader, Screen } from '../components/Screen';
import {
  Avatar,
  Body,
  Card,
  Display,
  EmptyState,
  Eyebrow,
  GameDot,
  GhostButton,
  Money,
  Mono,
  PrimaryButton,
} from '../components/primitives';
import { money, signedMoney } from '../domain/engine';
import type { FieldGameResult, PlayerId } from '../domain/types';
import { useLargeText } from '../hooks/useLargeText';
import { useStore } from '../store/AppStore';
import { hostOuting, isSupabaseConfigured } from '../sync/supabase';
import { colors, fonts, ink, line, radius } from '../theme/tokens';

/**
 * The whole day at a glance: the pots, the field, and every group.
 *
 * The thing this screen has to be honest about is how much is still undecided.
 * With tee times ten minutes apart, most of the card is unresolved for most of
 * the morning, and a leaderboard that hides that is worse than no leaderboard.
 */
export default function OutingScreen() {
  const [joinCode, setJoinCode] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const store = useStore();
  const router = useRouter();
  const largeText = useLargeText();
  const { outing, outingCourse, outingGroup, outingSettlement, outingRounds } = store;

  if (!outing || !outingCourse || !outingGroup || !outingSettlement) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="Outing" onClose={() => router.back()} closeLabel="Back" />
        <EmptyState
          title="No outing on"
          body="An outing is a day with more than one group out — a field, pots across everybody, and each foursome playing its own games."
          action={
            <PrimaryButton
              label="Set one up"
              onPress={() => router.replace('/new-outing')}
              style={{ alignSelf: 'stretch' }}
            />
          }
        />
      </Screen>
    );
  }

  const player = (id: PlayerId) => outingGroup.players.find((p) => p.id === id);
  const holeCount = outingCourse.holes.length;
  const potTotal = outingSettlement.fieldGames.reduce((sum, g) => sum + g.pot, 0);

  const standings = outing.field
    .map((id) => ({ id, net: outingSettlement.net[id] ?? 0 }))
    .sort((a, b) => b.net - a.net);

  const finish = () =>
    Alert.alert(
      'Close the outing?',
      'Every group stops here and the day is posted to the season ledger. Pots that nobody claimed stay unclaimed.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Close it',
          onPress: () => {
            store.completeOuting(outing.id);
            router.replace('/');
          },
        },
      ],
    );

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader
        eyebrow={`${outing.field.length} out · ${outingRounds.length} groups`}
        title={outing.name}
        onClose={() => router.back()}
        closeLabel="Back"
      />

      <LinearGradient
        colors={[colors.gradientFrom, colors.gradientTo]}
        start={{ x: 0.18, y: 0 }}
        end={{ x: 0.82, y: 1 }}
        style={styles.hero}
      >
        <View style={[styles.heroTop, largeText ? styles.stackRow : null]}>
          <Text style={styles.heroLabel}>In the pots</Text>
          <Mono size={11} style={{ color: ink.muted }}>
            FIELD THRU {outingSettlement.fieldThru}/{holeCount}
          </Mono>
        </View>
        <Display size={32}>{money(potTotal)}</Display>
        <Text style={styles.heroSub}>
          {outingSettlement.fieldGames.length === 0
            ? 'No field pots switched on'
            : outingSettlement.fieldGames
                .map((g) => `${g.name} · ${g.entrants.length} in`)
                .join('  ·  ')}
        </Text>
        <GhostButton label="Set up the pots" onPress={() => router.push('/field-games')} />
      </LinearGradient>

      {isSupabaseConfigured() ? (
        <View style={{ gap: 8 }}>
          <Eyebrow>Scoring on more than one phone</Eyebrow>
          {joinCode ? (
            <View style={styles.codeBox}>
              <Mono size={26} weight="bold" style={styles.code}>
                {joinCode}
              </Mono>
              <Text style={styles.codeHint}>
                Read that out to whoever else is scoring. They tap Join an outing in Settings and
                type it in. Everybody&apos;s scores land on the same card.
              </Text>
            </View>
          ) : (
            <GhostButton
              label={sharing ? 'Getting a code…' : 'Share this outing'}
              onPress={() => {
                if (sharing) return;
                setSharing(true);
                void hostOuting(outing.id)
                  .then((result) => setJoinCode(result.joinCode))
                  .catch((error: unknown) =>
                    Alert.alert(
                      'Could not share this outing',
                      error instanceof Error ? error.message : 'Try again in a moment.',
                    ),
                  )
                  .finally(() => setSharing(false));
              }}
            />
          )}
        </View>
      ) : null}

      {outingSettlement.fieldGames.map((game) => (
        <FieldPot key={game.key} game={game} holeCount={holeCount} />
      ))}

      <View style={{ gap: 10 }}>
        <View style={[styles.sectionHead, largeText ? styles.stackRow : null]}>
          <Eyebrow>Groups</Eyebrow>
          <Pressable accessibilityRole="button" onPress={() => router.push('/groups')} hitSlop={8}>
            <Mono size={11} style={{ color: ink.quiet }}>
              REARRANGE ›
            </Mono>
          </Pressable>
        </View>
        {outingRounds.map((round) => {
          const summary = outingSettlement.groups.find((g) => g.roundId === round.id);
          const isMine = round.id === store.activeRoundId;
          return (
            <Pressable
              key={round.id}
              accessibilityRole="button"
              onPress={() => {
                store.setActiveRound(round.id);
                router.push('/score');
              }}
              style={[
                styles.groupRow,
                isMine ? styles.groupRowMine : null,
                largeText ? styles.stackRow : null,
              ]}
            >
              <View style={[styles.groupMain, largeText ? styles.fullWidth : null]}>
                <View style={styles.groupTitleRow}>
                  <Text style={styles.groupName}>{round.name}</Text>
                  {round.teeTime ? (
                    <Mono size={10} style={{ color: ink.quiet }}>
                      {round.teeTime}
                    </Mono>
                  ) : null}
                  {isMine ? (
                    <View style={styles.youTag}>
                      <Text style={styles.youText}>YOURS</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.avatarRow}>
                  {round.playerIds.map((id) => {
                    const p = player(id);
                    return p ? <Avatar key={id} initials={p.initials} color={p.color} size={24} /> : null;
                  })}
                </View>
              </View>
              <View style={[styles.groupSummary, largeText ? styles.groupSummaryLarge : null]}>
                <Mono size={11} style={{ color: ink.soft }}>
                  THRU {summary?.thru ?? 0}
                </Mono>
                <Mono size={10} style={{ color: ink.quiet }}>
                  {summary?.games.length ?? 0} game{(summary?.games.length ?? 0) === 1 ? '' : 's'}
                </Mono>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: 8 }}>
        <Eyebrow>Where everybody stands</Eyebrow>
        <Body style={{ color: ink.quiet, fontSize: 11.5, lineHeight: 16 }}>
          Buy-ins are already out of everyone’s pocket, so most of the field sits negative until
          the pots pay.
        </Body>
        {standings.map((entry, i) => {
          const p = player(entry.id);
          if (!p) return null;
          return (
            <View
              key={entry.id}
              style={[styles.standingRow, largeText ? styles.standingRowLarge : null]}
            >
              <View style={[styles.standingIdentity, largeText ? styles.fullWidth : null]}>
                <Mono size={11} style={{ color: ink.quiet, width: 18 }}>
                  {i + 1}
                </Mono>
                <Avatar initials={p.initials} color={p.color} size={26} />
                <Text style={styles.standingName} numberOfLines={largeText ? undefined : 1}>
                  {p.name}
                </Text>
              </View>
              <Money cents={entry.net} label={signedMoney(entry.net)} />
            </View>
          );
        })}
      </View>

      <PrimaryButton label="Close the outing" onPress={finish} />
    </Screen>
  );
}

/** One pot's state: what is in it, what has been won, what is still out. */
function FieldPot({ game, holeCount }: { game: FieldGameResult; holeCount: number }) {
  const store = useStore();
  const largeText = useLargeText();
  const players = store.outingGroup?.players ?? [];
  const won = Object.entries(game.payouts).sort((a, b) => b[1] - a[1]);
  const settledHoles = game.holes.filter((h) => h.complete).length;

  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <View style={[styles.potHead, largeText ? styles.stackRow : null]}>
        <GameDot color={game.color} />
        <Text style={[styles.potName, largeText ? styles.fullWidth : null]}>{game.name}</Text>
        <Mono size={11} style={{ color: ink.soft }}>
          {money(game.pot)}
        </Mono>
      </View>

      <View style={styles.potBody}>
        <Text style={styles.potMeta}>
          {game.entrants.length} in at {money(game.buyIn)} · {settledHoles}/{holeCount} holes
          settled
          {game.unclaimedPot > 0 ? ` · ${money(game.unclaimedPot)} still riding` : ''}
        </Text>

        {game.blocked ? (
          <Text style={[styles.potMeta, { color: colors.clay }]}>{game.blockedReason}</Text>
        ) : null}

        {won.length > 0 ? (
          <View style={{ gap: 7, marginTop: 4 }}>
            {won.slice(0, 5).map(([id, amount]) => {
              const p = players.find((x) => x.id === id);
              if (!p) return null;
              return (
                <View
                  key={id}
                  style={[styles.potWinnerRow, largeText ? styles.stackRow : null]}
                >
                  <View style={[styles.potWinnerIdentity, largeText ? styles.fullWidth : null]}>
                    <Avatar initials={p.initials} color={p.color} size={24} />
                    <Text style={styles.potWinner} numberOfLines={largeText ? undefined : 1}>
                      {p.name}
                    </Text>
                  </View>
                  <Money cents={amount} label={money(amount)} size={13} />
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.potMeta}>Nothing won yet.</Text>
        )}

        {game.pendingHoles > 0 ? (
          <View style={styles.pendingBar}>
            <Text style={styles.pendingText}>
              {game.pendingHoles} hole{game.pendingHoles === 1 ? '' : 's'} waiting on groups still
              out on the course
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  stackRow: { flexDirection: 'column', alignItems: 'flex-start' },
  fullWidth: { flex: 0, width: '100%' },
  codeBox: {
    backgroundColor: colors.cardDeep,
    borderWidth: 1,
    borderColor: colors.accentLine,
    borderRadius: radius.panel,
    padding: 16,
    gap: 8,
    alignItems: 'center',
  },
  code: { color: colors.accent, letterSpacing: 8 },
  codeHint: {
    fontFamily: fonts.sans,
    fontSize: 12,
    color: ink.soft,
    lineHeight: 17,
    textAlign: 'center',
  },
  hero: {
    borderWidth: 1,
    borderColor: colors.accentSoft,
    borderRadius: radius.hero,
    padding: 18,
    gap: 12,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heroLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: colors.accent,
  },
  heroSub: { fontFamily: fonts.sans, fontSize: 11.5, color: ink.soft, lineHeight: 16 },
  sectionHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  potHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(242,239,230,.03)',
  },
  potName: { flex: 1, fontFamily: fonts.sansSemi, fontSize: 14, color: ink.full },
  potBody: { padding: 14, gap: 8 },
  potMeta: { fontFamily: fonts.sans, fontSize: 11.5, color: ink.muted, lineHeight: 16 },
  potWinner: { flex: 1, minWidth: 0, fontFamily: fonts.sans, fontSize: 13, color: ink.body },
  potWinnerRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  potWinnerIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 9 },
  pendingBar: {
    marginTop: 4,
    borderTopWidth: 1,
    borderTopColor: line.hair,
    paddingTop: 9,
  },
  pendingText: { fontFamily: fonts.sans, fontSize: 11, color: ink.quiet, lineHeight: 15 },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.cardDeep,
    borderWidth: 1,
    borderColor: line.card,
    borderRadius: radius.card,
    padding: 13,
  },
  groupRowMine: { borderColor: colors.accentSoft, backgroundColor: colors.cardActive },
  groupMain: { flex: 1, minWidth: 0, gap: 6 },
  groupTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' },
  avatarRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  groupSummary: { alignItems: 'flex-end', gap: 3 },
  groupSummaryLarge: { alignItems: 'flex-start' },
  groupName: { fontFamily: fonts.sansSemi, fontSize: 14, color: ink.full },
  youTag: {
    backgroundColor: 'rgba(139,224,174,.15)',
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 5,
  },
  youText: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.85, color: colors.accent },
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: line.soft,
  },
  standingRowLarge: { flexDirection: 'column', alignItems: 'stretch' },
  standingIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  standingName: { flex: 1, minWidth: 0, fontFamily: fonts.sans, fontSize: 13.5, color: ink.full },
});
