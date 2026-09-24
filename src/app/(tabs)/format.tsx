import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import {
  Avatar,
  Body,
  Card,
  Display,
  EmptyState,
  Eyebrow,
  GhostButton,
  Mono,
  PrimaryButton,
  Stepper,
  Switch,
} from '../../components/primitives';
import { maxExposure } from '../../domain/engine';
import { money } from '../../domain/engine/context';
import { FORMATS } from '../../domain/formats';
import { GAME_KEYS, type GameKey } from '../../domain/types';
import { useLargeText } from '../../hooks/useLargeText';
import { useStore } from '../../store/AppStore';
import { colors, fill, fonts, ink, line, radius } from '../../theme/tokens';

export default function FormatScreen() {
  const store = useStore();
  const router = useRouter();
  const largeText = useLargeText();
  const { round, course, group } = store;

  if (!round || !course || !group) {
    return (
      <Screen>
        <View style={{ gap: 6 }}>
          <Eyebrow>Before the first tee</Eyebrow>
          <Display>What are we playing?</Display>
        </View>
        <EmptyState
          title="No round to configure"
          body="Start a round and every format below becomes live."
          action={
            <PrimaryButton
              label="Start a round"
              onPress={() => router.push('/new-round')}
              style={{ alignSelf: 'stretch' }}
            />
          }
        />
      </Screen>
    );
  }

  const roster = group.players.filter((p) => round.playerIds.includes(p.id));
  const exposure = maxExposure(round, course, group.players);
  /** Stake steps scale with the bet so a $100 match isn't 100 taps from $1. */
  const step = (cents: number) => (cents >= 5000 ? 1000 : cents >= 2000 ? 500 : 100);

  return (
    <Screen>
      <View>
        <Eyebrow>Before the first tee</Eyebrow>
        <Display style={{ marginTop: 3 }}>What are we playing?</Display>
        <Body style={{ color: ink.soft, marginTop: 6, lineHeight: 19 }}>
          Stack as many as the group can stomach. Every game settles on its own line.
        </Body>
      </View>

      {GAME_KEYS.map((key) => {
        const meta = FORMATS[key];
        const config = round.games[key];
        const on = config.on;
        return (
          <View
            key={key}
            style={[
              styles.formatCard,
              {
                backgroundColor: on ? colors.cardActive : colors.cardDeep,
                borderColor: on ? colors.accentSoft : line.card,
              },
            ]}
          >
            <View style={[styles.formatHeader, largeText ? styles.stackRow : null]}>
              <View style={[styles.flexCopy, largeText ? styles.fullWidth : null]}>
                <View style={styles.formatTitleRow}>
                  <Text style={styles.formatName}>{meta.name}</Text>
                  <View style={styles.tag}>
                    <Text style={styles.tagText}>{meta.tag}</Text>
                  </View>
                </View>
                <Text style={styles.blurb}>{meta.blurb}</Text>
              </View>
              <Switch on={on} onToggle={() => store.toggleGame(key)} label={meta.name} />
            </View>

            {on ? (
              <View style={[styles.stakeRow, largeText ? styles.stackRow : null]}>
                <Text style={[styles.stakeLabel, largeText ? styles.fullWidth : null]}>
                  {meta.stakeLabel}
                </Text>
                <View>
                  <Stepper
                    value={money(config.stake)}
                    onDecrement={() => store.setStake(key, Math.max(0, config.stake - step(config.stake)))}
                    onIncrement={() => store.setStake(key, config.stake + step(config.stake))}
                  />
                </View>
              </View>
            ) : null}

            {on && meta.requires ? (
              <FormatRequirement
                gameKey={key}
                requirement={meta.requires}
                onOpenSides={() => router.push('/sides')}
                onOpenScore={() => router.push('/score')}
              />
            ) : null}
          </View>
        );
      })}

      <Card style={{ padding: 16, gap: 4 }}>
        <View style={[styles.popsHeader, largeText ? styles.stackRow : null]}>
          <Eyebrow>Pops</Eyebrow>
          <Text style={styles.popsMeta}>strokes off the low man</Text>
        </View>
        {roster.map((player) => {
          const pops = round.pops[player.id] ?? 0;
          return (
            <View key={player.id} style={[styles.popsRow, largeText ? styles.stackRow : null]}>
              <View style={[styles.popsIdentity, largeText ? styles.fullWidth : null]}>
                <Avatar initials={player.initials} color={player.color} size={30} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.popsName}>{player.name}</Text>
                  <Text style={styles.popsHint}>{popsHint(pops, course.holes.length)}</Text>
                </View>
              </View>
              <Stepper
                size={30}
                minWidth={26}
                value={String(pops)}
                onDecrement={() => store.setPops(player.id, pops - 1)}
                onIncrement={() => store.setPops(player.id, pops + 1)}
              />
            </View>
          );
        })}
        <GhostButton
          dashed
          label="Edit the roster"
          onPress={() => router.push('/roster')}
          style={{ marginTop: 10 }}
        />
      </Card>

      <PrimaryButton
        label={`Lock it in · ${money(exposure)} max exposure`}
        onPress={() => router.push('/score')}
      />
      <Text style={styles.exposureNote}>
        Worst case for one player if every remaining hole goes against them, Vegas quoted at ten
        points a hole.
      </Text>
    </Screen>
  );
}

/** Tells the group what a format still needs before it can pay out. */
function FormatRequirement({
  gameKey,
  requirement,
  onOpenSides,
  onOpenScore,
}: {
  gameKey: GameKey;
  requirement: 'teams' | 'pairings' | 'wolfPicks';
  onOpenSides: () => void;
  onOpenScore: () => void;
}) {
  const store = useStore();
  const round = store.round!;
  const group = store.group!;
  const initials = (id: string) => group.players.find((p) => p.id === id)?.initials ?? '??';

  if (requirement === 'wolfPicks') {
    const made = round.wolfPicks.length;
    return (
      <Pressable accessibilityRole="button" onPress={onOpenScore} style={styles.requirement}>
        <Mono size={10} style={styles.requirementLabel}>
          PARTNERS
        </Mono>
        <Text style={styles.requirementText}>
          {made === 0
            ? 'Pick the Wolf’s partner on each hole, from the Score screen.'
            : `${made} hole${made === 1 ? '' : 's'} picked · tap to keep going`}
        </Text>
      </Pressable>
    );
  }

  if (requirement === 'pairings') {
    const chosen = round.options.matchPairings ?? [];
    return (
      <Pressable accessibilityRole="button" onPress={onOpenSides} style={styles.requirement}>
        <Mono size={10} style={styles.requirementLabel}>
          RIVALS
        </Mono>
        <Text style={styles.requirementText}>
          {chosen.length === 0
            ? 'Everyone against everyone. Tap to choose specific rivals.'
            : chosen.map(([a, b]) => `${initials(a)} v ${initials(b)}`).join(' · ')}
        </Text>
      </Pressable>
    );
  }

  const teams = round.options.teams ?? [];
  return (
    <Pressable accessibilityRole="button" onPress={onOpenSides} style={styles.requirement}>
      <Mono size={10} style={styles.requirementLabel}>
        SIDES
      </Mono>
      <Text
        style={[
          styles.requirementText,
          teams.length < 2 ? { color: colors.clay } : null,
        ]}
      >
        {teams.length < 2
          ? `${FORMATS[gameKey].name} can’t pay until the sides are set. Tap to set them.`
          : teams.map((t) => t.map(initials).join(' + ')).join('  v  ')}
      </Text>
    </Pressable>
  );
}

function popsHint(pops: number, holeCount: number): string {
  if (pops === 0) return 'scratch in this group';
  if (pops >= holeCount) {
    const extra = pops - holeCount;
    if (extra === 0) return 'a stroke on every hole';
    return `a stroke everywhere, two on SI 1–${extra}`;
  }
  return `strokes on SI 1–${pops}`;
}

const styles = StyleSheet.create({
  stackRow: { flexDirection: 'column', alignItems: 'flex-start' },
  flexCopy: { flex: 1, minWidth: 0 },
  fullWidth: { flex: 0, width: '100%' },
  formatCard: { borderWidth: 1, borderRadius: radius.format, padding: 15 },
  formatHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  formatTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  formatName: { fontFamily: fonts.sansBold, fontSize: 15.5, color: ink.full },
  tag: { backgroundColor: fill.control, borderRadius: radius.sm, paddingVertical: 3, paddingHorizontal: 6 },
  tagText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: ink.muted,
  },
  blurb: { fontFamily: fonts.sans, fontSize: 12, color: ink.muted, marginTop: 5, lineHeight: 17 },
  stakeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginTop: 14,
    paddingTop: 13,
    borderTopWidth: 1,
    borderTopColor: line.bright,
  },
  stakeLabel: { flex: 1, minWidth: 0, fontFamily: fonts.sans, fontSize: 11.5, color: ink.muted },
  requirement: {
    marginTop: 12,
    paddingTop: 11,
    borderTopWidth: 1,
    borderTopColor: line.hair,
    gap: 4,
  },
  requirementLabel: { letterSpacing: 1.2, color: ink.soft },
  requirementText: { fontFamily: fonts.sans, fontSize: 12, color: ink.body, lineHeight: 17 },
  popsHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  popsMeta: { fontFamily: fonts.sans, fontSize: 11, color: ink.quiet },
  popsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 9,
    borderTopWidth: 1,
    borderTopColor: line.hair,
  },
  popsIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 11 },
  popsName: { fontFamily: fonts.sans, fontSize: 14, color: ink.full },
  popsHint: { fontFamily: fonts.sans, fontSize: 11, color: ink.quiet, marginTop: 1 },
  exposureNote: {
    fontFamily: fonts.sans,
    fontSize: 11,
    color: ink.quiet,
    lineHeight: 16,
    textAlign: 'center',
    marginTop: -10,
  },
});
