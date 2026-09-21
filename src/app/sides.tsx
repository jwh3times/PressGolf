import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ModalHeader, Screen } from '../components/Screen';
import {
  Avatar,
  Body,
  Card,
  EmptyState,
  Eyebrow,
  GhostButton,
  Stepper,
  Switch,
} from '../components/primitives';
import { allPairings, RoundContext } from '../domain/engine';
import { defaultTeams } from '../domain/factory';
import type { Pairing, PlayerId, Team } from '../domain/types';
import { useStore } from '../store/AppStore';
import { colors, fonts, ink, line, radius } from '../theme/tokens';

/**
 * Sides, rivals and the knobs the team formats need.
 *
 * Four-ball and Vegas share one set of sides on purpose: groups who split 2v2
 * play both games with the same partners, and two separate pickers would be
 * two chances to set them inconsistently.
 */
export default function SidesScreen() {
  const store = useStore();
  const router = useRouter();
  const { round, course, group } = store;

  if (!round || !course || !group) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="Sides" onClose={() => router.back()} />
        <EmptyState title="No round" body="Start a round before setting the sides." />
      </Screen>
    );
  }

  const ctx = new RoundContext(round, course, group.players);
  const options = round.options;
  const teams = options.teams ?? [];
  const assigned = new Set(teams.flat());
  const unassigned = ctx.ids.filter((id) => !assigned.has(id));

  const initials = (id: PlayerId) => ctx.initials(id);
  const player = (id: PlayerId) => group.players.find((p) => p.id === id);

  /**
   * Moves a player onto a side, pulling them off whichever one they were on.
   * A side that already has two people swaps the second one out to unassigned,
   * so the picker never silently builds a three-man "pair".
   */
  const assign = (playerId: PlayerId, teamIndex: number) => {
    const next: Team[] = teams.map((t) => [...t] as Team);
    while (next.length <= teamIndex) next.push([] as unknown as Team);
    for (let i = 0; i < next.length; i++) {
      next[i] = next[i].filter((id) => id !== playerId) as Team;
    }
    const target = [...next[teamIndex], playerId].slice(-2) as Team;
    next[teamIndex] = target;
    store.setOptions({ teams: next.filter((t) => t.length > 0) as Team[] });
  };

  const togglePairing = (pair: Pairing) => {
    const current = options.matchPairings ?? [];
    const exists = current.some(
      ([a, b]) => (a === pair[0] && b === pair[1]) || (a === pair[1] && b === pair[0]),
    );
    store.setOptions({
      matchPairings: exists
        ? current.filter(
            ([a, b]) => !((a === pair[0] && b === pair[1]) || (a === pair[1] && b === pair[0])),
          )
        : [...current, pair],
    });
  };

  const teamSlots = Math.max(2, teams.length);

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader eyebrow="Teams and rivals" title="Sides" onClose={() => router.back()} />

      <View style={{ gap: 10 }}>
        <Eyebrow>Sides · four-ball and Vegas</Eyebrow>
        <Body style={{ color: ink.soft, lineHeight: 18 }}>
          Tap a player under the side you want them on. Two to a side.
        </Body>

        {Array.from({ length: teamSlots }, (_, teamIndex) => {
          const team = teams[teamIndex] ?? [];
          return (
            <Card key={teamIndex} style={{ padding: 14, gap: 11 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.sideLabel}>Side {teamIndex + 1}</Text>
                <View style={{ flex: 1 }} />
                <Text style={styles.sideCount}>
                  {team.length}/2
                </Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {ctx.ids.map((id) => {
                  const p = player(id);
                  if (!p) return null;
                  const on = team.includes(id);
                  return (
                    <Pressable
                      key={id}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      onPress={() => assign(id, teamIndex)}
                      style={[
                        styles.slot,
                        on ? { borderColor: p.color, backgroundColor: `${p.color}18` } : null,
                      ]}
                    >
                      <Avatar initials={p.initials} color={p.color} size={26} />
                      <Text style={[styles.slotName, on ? { color: ink.full } : null]}>
                        {p.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </Card>
          );
        })}

        {unassigned.length ? (
          <Text style={styles.warn}>
            {unassigned.map(initials).join(', ')} not on a side — they sit out four-ball and Vegas.
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', gap: 8 }}>
          <GhostButton
            label="Pair by tee order"
            onPress={() => store.setOptions({ teams: defaultTeams(round.playerIds) })}
            style={{ flex: 1 }}
          />
          <GhostButton
            label="Clear"
            onPress={() => store.setOptions({ teams: [] })}
            style={{ flex: 1 }}
          />
        </View>
      </View>

      <View style={{ gap: 10 }}>
        <Eyebrow>Rivals · match play</Eyebrow>
        <Body style={{ color: ink.soft, lineHeight: 18 }}>
          Pick specific matches, or leave all of them off and everybody plays everybody.
        </Body>
        {allPairings(ctx).map((pair) => {
          const chosen = (options.matchPairings ?? []).some(
            ([a, b]) => (a === pair[0] && b === pair[1]) || (a === pair[1] && b === pair[0]),
          );
          const a = player(pair[0]);
          const b = player(pair[1]);
          if (!a || !b) return null;
          return (
            <Pressable
              key={`${pair[0]}-${pair[1]}`}
              accessibilityRole="button"
              accessibilityState={{ selected: chosen }}
              onPress={() => togglePairing(pair)}
              style={[styles.pairRow, chosen ? { borderColor: colors.accentSoft } : null]}
            >
              <Avatar initials={a.initials} color={a.color} size={26} />
              <Text style={styles.vs}>v</Text>
              <Avatar initials={b.initials} color={b.color} size={26} />
              <Text style={styles.pairNames} numberOfLines={1}>
                {a.name} v {b.name}
              </Text>
              <View style={[styles.check, chosen ? styles.checkOn : null]}>
                {chosen ? <Text style={styles.checkMark}>✓</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: 10 }}>
        <Eyebrow>Wolf</Eyebrow>
        <Card style={styles.optionRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.optionName}>Lone wolf multiplier</Text>
            <Text style={styles.optionHint}>
              What going alone is worth against each opponent, win or lose.
            </Text>
          </View>
          <Stepper
            size={30}
            minWidth={30}
            value={`${options.wolfLoneMultiplier}×`}
            onDecrement={() =>
              store.setOptions({ wolfLoneMultiplier: Math.max(1, options.wolfLoneMultiplier - 1) })
            }
            onIncrement={() =>
              store.setOptions({ wolfLoneMultiplier: Math.min(5, options.wolfLoneMultiplier + 1) })
            }
          />
        </Card>
      </View>

      <View style={{ gap: 10 }}>
        <Eyebrow>Vegas</Eyebrow>
        <Card style={styles.optionRow}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.optionName}>Flip on a birdie</Text>
            <Text style={styles.optionHint}>
              A birdie or better reverses the other side’s number — 46 becomes 64.
            </Text>
          </View>
          <Switch
            on={options.vegasFlipOnBirdie}
            onToggle={() => store.setOptions({ vegasFlipOnBirdie: !options.vegasFlipOnBirdie })}
            label="Flip on a birdie"
          />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  sideLabel: { fontFamily: fonts.sansBold, fontSize: 14, color: ink.full },
  sideCount: { fontFamily: fonts.mono, fontSize: 11, color: ink.ghost },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: line.control,
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 8,
  },
  slotName: { fontFamily: fonts.sans, fontSize: 12.5, color: ink.muted },
  warn: { fontFamily: fonts.sans, fontSize: 11.5, color: colors.clay, lineHeight: 16 },
  pairRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.cardDeep,
    borderWidth: 1,
    borderColor: line.card,
    borderRadius: radius.card,
    paddingVertical: 11,
    paddingHorizontal: 13,
  },
  vs: { fontFamily: fonts.sans, fontSize: 11, color: ink.ghost },
  pairNames: { flex: 1, minWidth: 0, fontFamily: fonts.sans, fontSize: 13, color: ink.body },
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
  optionRow: { padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  optionName: { fontFamily: fonts.sansSemi, fontSize: 14, color: ink.full },
  optionHint: { fontFamily: fonts.sans, fontSize: 11.5, color: ink.muted, marginTop: 3, lineHeight: 16 },
});
