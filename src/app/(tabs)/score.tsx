import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import {
  Avatar,
  Chip,
  Display,
  EmptyState,
  Eyebrow,
  GhostButton,
  Mono,
  PrimaryButton,
  StepperButton,
} from '../../components/primitives';
import { MANUAL_JUNK, RoundContext, matchStatus, money, wolfForHole, wolfPickForHole } from '../../domain/engine';
import type { JunkKind, PlayerId } from '../../domain/types';
import { useLargeText } from '../../hooks/useLargeText';
import { useStore } from '../../store/AppStore';
import { colors, fill, fonts, ink, line, radius } from '../../theme/tokens';

export default function ScoreScreen() {
  const store = useStore();
  const router = useRouter();
  const largeText = useLargeText();
  const { round, course, group, settlement } = store;

  const ctx = useMemo(
    () => (round && course && group ? new RoundContext(round, course, group.players) : null),
    [round, course, group],
  );

  const [hole, setHole] = useState(0);

  // Open on the hole the group is actually standing on, not hole 1. This cannot
  // be a lazy useState initialiser: on first render the store is still loading
  // from disk, so there is no round to read yet. Jump once per round instead,
  // and leave the hole alone after that so browsing back is not undone.
  const jumpedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ctx || !round || jumpedFor.current === round.id) return;
    jumpedFor.current = round.id;
    setHole(firstUnplayedHole(ctx));
  }, [ctx, round]);

  if (!round || !course || !group || !ctx || !settlement) {
    return (
      <Screen>
        <EmptyState
          title="Nothing to score"
          body="Start a round first — then this is where the whole afternoon happens."
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

  const holeCount = ctx.holeCount;
  const current = Math.min(hole, holeCount - 1);
  const holeInfo = course.holes[current];
  const roster = ctx.players;
  const youId = group.youId;

  const skinsGame = settlement.games.find((g) => g.key === 'skins');
  const carry = skinsGame?.carry ?? 1;

  return (
    <Screen contentStyle={{ gap: 14 }}>
      <View style={styles.holeNav}>
        <RoundButton label="‹" onPress={() => setHole(Math.max(0, current - 1))} />
        <View style={{ alignItems: 'center' }}>
          <Display size={27}>Hole {holeInfo.number}</Display>
          {!largeText ? (
            <Mono size={10.5} style={styles.holeMeta}>
              PAR {holeInfo.par}
              {holeInfo.yards ? ` · ${holeInfo.yards}Y` : ''} · SI {holeInfo.strokeIndex}
            </Mono>
          ) : null}
        </View>
        <RoundButton label="›" onPress={() => setHole(Math.min(holeCount - 1, current + 1))} />
      </View>
      {largeText ? (
        <Mono size={10.5} style={styles.holeMetaLarge}>
          PAR {holeInfo.par}
          {holeInfo.yards ? ` · ${holeInfo.yards}Y` : ''} · SI {holeInfo.strokeIndex}
        </Mono>
      ) : null}

      <View style={{ flexDirection: 'row', gap: 3 }}>
        {Array.from({ length: holeCount }, (_, i) => (
          <Pressable
            key={i}
            accessibilityRole="button"
            accessibilityLabel={`Go to hole ${i + 1}`}
            onPress={() => setHole(i)}
            hitSlop={{ top: 12, bottom: 12 }}
            style={{
              flex: 1,
              height: 5,
              borderRadius: 999,
              backgroundColor:
                i === current ? colors.accent : ctx.played(i) ? 'rgba(139,224,174,.32)' : line.control,
            }}
          />
        ))}
      </View>

      {roster.map((player) => {
        const gross = ctx.gross(player.id, current);
        const net = ctx.net(player.id, current);
        const strokes = ctx.strokes(player.id, current);
        const rel = gross == null ? null : gross - holeInfo.par;
        return (
          <View
            key={player.id}
            style={[styles.scoreRow, { borderColor: gross != null ? line.strong : line.hair }]}
          >
            <View style={[styles.scoreMain, largeText ? styles.stackRow : null]}>
              <View style={[styles.playerIdentity, largeText ? styles.fullWidth : null]}>
                <Avatar initials={player.initials} color={player.color} size={32} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={styles.playerTitleRow}>
                    <Text style={styles.playerName} numberOfLines={largeText ? undefined : 1}>
                      {player.name}
                    </Text>
                    {strokes > 0 ? (
                      <View style={styles.pop}>
                        <Text style={styles.popText}>{strokes > 1 ? `POP ×${strokes}` : 'POP'}</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.playerSub}>
                    {gross == null
                      ? 'no score yet'
                      : `net ${net} · ${rel === 0 ? 'par' : rel! > 0 ? `+${rel}` : rel}`}
                  </Text>
                </View>
              </View>
              <View style={styles.scoreControls}>
                <StepperButton
                  label={'−'}
                  size={34}
                  onPress={() => store.bumpScore(player.id, current, -1)}
                />
                <Text
                  maxFontSizeMultiplier={1.35}
                  style={[
                    styles.scoreValue,
                    {
                      color:
                        gross == null
                          ? ink.quiet
                          : rel! < 0
                            ? colors.accent
                            : rel! > 1
                              ? colors.clay
                              : ink.full,
                    },
                  ]}
                >
                  {gross == null ? '–' : gross}
                </Text>
                <StepperButton
                  label="+"
                  size={34}
                  onPress={() => {
                    void Haptics.selectionAsync().catch(() => {});
                    store.bumpScore(player.id, current, 1);
                  }}
                />
              </View>
            </View>

            <View style={styles.chipRow}>
              {gross != null && gross < holeInfo.par ? (
                <Chip
                  label={gross <= holeInfo.par - 2 ? 'EAGLE' : 'BIRDIE'}
                  active
                  color={colors.accent}
                  disabled
                />
              ) : null}
              {MANUAL_JUNK.map(({ kind, label }) => (
                <Chip
                  key={kind}
                  label={label}
                  active={ctx.hasJunk(current, player.id, kind)}
                  onPress={() => store.toggleJunk(current, player.id, kind as JunkKind)}
                />
              ))}
              {gross != null ? (
                <Chip label="CLEAR" onPress={() => store.setScore(player.id, current, null)} />
              ) : null}
            </View>
          </View>
        );
      })}

      {round.games.wolf.on ? (
        <WolfPicker hole={current} />
      ) : null}

      <LinearGradient
        colors={[colors.gradientFrom, colors.gradientTo]}
        start={{ x: 0.12, y: 0 }}
        end={{ x: 0.88, y: 1 }}
        style={styles.holeCard}
      >
        <View style={[styles.holeCardTop, largeText ? styles.stackRow : null]}>
          <Text style={styles.holeCardLabel}>What this hole did</Text>
          <Mono size={10.5} style={{ color: ink.soft }}>
            {carry > 1 ? `${carry - 1} skin${carry > 2 ? 's' : ''} riding` : 'skins clean'}
          </Mono>
        </View>
        {buildHoleEvents(ctx, current).map((event, i) => (
          <View key={i} style={[styles.eventRow, largeText ? styles.stackRow : null]}>
            <View style={[styles.eventDot, { backgroundColor: event.color }]} />
            <Text style={[styles.eventText, largeText ? styles.fullWidth : null]}>{event.text}</Text>
            <Text
              style={[
                styles.eventAmount,
                event.tone === 'won' ? { color: colors.accent, fontFamily: fonts.monoBold } : null,
              ]}
            >
              {event.amount}
            </Text>
          </View>
        ))}
      </LinearGradient>

      {round.games.nassau.on && youId ? (
        <PressPanel youId={youId} hole={current} />
      ) : null}

      <GhostButton label="See the damage so far →" onPress={() => router.push('/settle')} />
    </Screen>
  );
}

/** Per-hole partner selection — the flow Wolf needs and the prototype never had. */
function WolfPicker({ hole }: { hole: number }) {
  const store = useStore();
  const largeText = useLargeText();
  const round = store.round!;
  const group = store.group!;
  const ctx = new RoundContext(round, store.course!, group.players);
  const wolfId = wolfForHole(ctx, hole);
  if (!wolfId) return null;
  const wolf = group.players.find((p) => p.id === wolfId);
  const pick = wolfPickForHole(ctx, hole);
  const field = ctx.ids.filter((id) => id !== wolfId);
  const multiplier = Math.max(1, round.options.wolfLoneMultiplier);

  return (
    <View style={styles.wolfCard}>
      <View style={[styles.wolfHeader, largeText ? styles.stackRow : null]}>
        <Eyebrow>Wolf · hole {hole + 1}</Eyebrow>
        {pick ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => store.setWolfPick(hole, wolfId, null)}
            hitSlop={8}
          >
            <Mono size={10} style={{ color: ink.soft }}>
              RESET
            </Mono>
          </Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        {wolf ? <Avatar initials={wolf.initials} color={wolf.color} size={30} /> : null}
        <Text style={styles.wolfName}>{wolf?.name ?? 'Wolf'} has the honour</Text>
      </View>
      <Text style={styles.wolfHint}>
        {pick == null
          ? 'Take a partner after the tee shots, or go alone for the multiple.'
          : pick.partner
            ? `Partnered with ${ctx.name(pick.partner)} — two against the rest.`
            : `Alone against the field at ${multiplier}× the stake.`}
      </Text>
      <View style={styles.chipRow}>
        {field.map((id) => {
          const p = group.players.find((x) => x.id === id);
          if (!p) return null;
          return (
            <Chip
              key={id}
              label={p.initials}
              color={p.color}
              active={pick?.partner === id}
              onPress={() => store.setWolfPick(hole, wolfId, id)}
            />
          );
        })}
        <Chip
          label={`LONE WOLF ${multiplier}×`}
          color={colors.gold}
          active={pick != null && pick.partner == null}
          onPress={() => store.setWolfPick(hole, wolfId, null)}
        />
      </View>
    </View>
  );
}

/**
 * Press rows.
 *
 * The prototype only let "you" press and read the current nine while the press
 * itself ran to 18. Here a press runs to the end of the nine it was fired on,
 * which is the bet people actually make, and the status shown is the same match
 * the press would attach to.
 */
function PressPanel({ youId, hole }: { youId: PlayerId; hole: number }) {
  const store = useStore();
  const largeText = useLargeText();
  const round = store.round!;
  const group = store.group!;
  const ctx = new RoundContext(round, store.course!, group.players);
  const [from, to] = ctx.nineFor(hole);
  const stake = round.games.nassau.stake;
  const opponents = ctx.ids.filter((id) => id !== youId);

  return (
    <View style={{ gap: 8 }}>
      <Eyebrow>Your matches · press while you’re down</Eyebrow>
      {opponents.map((opponentId) => {
        const status = matchStatus(ctx, youId, opponentId, from, to);
        const opponent = group.players.find((p) => p.id === opponentId);
        if (!opponent) return null;
        const running = round.presses.filter(
          (p) =>
            (p.by === youId && p.against === opponentId) ||
            (p.by === opponentId && p.against === youId),
        );
        const down = status.up < 0;
        const exposure = stake + running.reduce((sum, p) => sum + p.stake, 0);

        return (
          <View key={opponentId} style={[styles.pressRow, largeText ? styles.stackRow : null]}>
            <Avatar initials={opponent.initials} color={opponent.color} size={30} />
            <View style={[styles.pressCopy, largeText ? styles.fullWidth : null]}>
              <Text style={styles.pressStatus}>
                {status.up === 0
                  ? `All square with ${opponent.name}`
                  : status.up > 0
                    ? `${status.up} up on ${opponent.name}`
                    : `${Math.abs(status.up)} down to ${opponent.name}`}
              </Text>
              <Text style={styles.pressDetail}>
                {running.length
                  ? `${running.length} press${running.length > 1 ? 'es' : ''} running · ${money(exposure)} exposure`
                  : `${ctx.backRange && from === ctx.backRange[0] ? 'Back' : 'Front'} nine · ${money(stake)}`}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !down }}
              onPress={
                down
                  ? () => {
                      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(
                        () => {},
                      );
                      store.addPress(youId, opponentId, hole, to, stake);
                    }
                  : undefined
              }
              style={[styles.pressButton, down ? styles.pressButtonLive : styles.pressButtonIdle]}
            >
              <Text
                style={[
                  styles.pressButtonText,
                  { color: down ? colors.screen : ink.quiet },
                ]}
              >
                {down ? 'Press' : '—'}
              </Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

interface HoleEvent {
  text: string;
  amount: string;
  color: string;
  tone: 'won' | 'pending';
}

/** The live "what this hole did" strip. Reads the same numbers the settlement will. */
function buildHoleEvents(ctx: RoundContext, hole: number): HoleEvent[] {
  const round = ctx.round;
  if (!ctx.played(hole)) {
    return [
      {
        text: `Enter all ${ctx.ids.length} scores to settle this hole.`,
        amount: '',
        color: ink.quiet,
        tone: 'pending',
      },
    ];
  }

  const events: HoleEvent[] = [];
  const others = ctx.ids.length - 1;
  const nets = ctx.ids.map((id) => ({ id, net: ctx.net(id, hole)! }));
  const low = Math.min(...nets.map((n) => n.net));
  const winners = nets.filter((n) => n.net === low);

  if (round.games.skins.on) {
    events.push({
      text:
        winners.length === 1
          ? `${ctx.name(winners[0].id)} takes the skin with net ${low}`
          : `Skin halved — ${winners.length} at net ${low}, it rides`,
      amount: winners.length === 1 ? money(round.games.skins.stake * others) : 'carry',
      color: colors.gold,
      tone: winners.length === 1 ? 'won' : 'pending',
    });
  }

  if (round.games.junk.on) {
    for (const id of ctx.ids) {
      const gross = ctx.gross(id, hole)!;
      const diff = gross - ctx.par(hole);
      if (diff >= 0) continue;
      const label = diff <= -3 ? 'albatross' : diff === -2 ? 'eagle' : 'birdie';
      const multiplier = diff <= -3 ? 3 : diff === -2 ? 2 : 1;
      events.push({
        text: `${ctx.name(id)} ${label} — collects from the other ${others}`,
        amount: money(round.games.junk.stake * multiplier * others),
        color: colors.clay,
        tone: 'won',
      });
    }
  }

  if (round.games.nassau.on) {
    events.push({
      text:
        winners.length === 1
          ? `Nassau: ${ctx.initials(winners[0].id)} wins the hole in all ${others} of their matches`
          : 'Nassau: hole halved — no match moves',
      amount: 'live',
      color: colors.accent,
      tone: 'pending',
    });
  }

  if (round.games.wolf.on) {
    const pick = wolfPickForHole(ctx, hole);
    events.push({
      text: pick
        ? pick.partner
          ? `Wolf: ${ctx.initials(pick.wolf)} + ${ctx.initials(pick.partner)} against the rest`
          : `Wolf: ${ctx.initials(pick.wolf)} went alone`
        : 'Wolf: no pick recorded — this hole pays nothing',
      amount: pick ? money(round.games.wolf.stake) : '—',
      color: '#E8A0C8',
      tone: pick ? 'won' : 'pending',
    });
  }

  return events;
}

/** The hole the group is on: first one missing a score, or the last if they're done. */
function firstUnplayedHole(ctx: RoundContext): number {
  for (let h = 0; h < ctx.holeCount; h++) if (!ctx.played(h)) return h;
  return Math.max(0, ctx.holeCount - 1);
}

function RoundButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label === '‹' ? 'Previous hole' : 'Next hole'}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.roundButton, { opacity: pressed ? 0.6 : 1 }]}
    >
      <Text
        maxFontSizeMultiplier={1.25}
        style={{ fontFamily: fonts.sans, fontSize: 17, color: ink.full, lineHeight: 20 }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stackRow: { flexDirection: 'column', alignItems: 'flex-start' },
  fullWidth: { flex: 0, width: '100%' },
  holeNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  holeMeta: { letterSpacing: 1.4, color: ink.soft, marginTop: 5 },
  holeMetaLarge: {
    letterSpacing: 1.4,
    color: ink.soft,
    marginTop: 5,
    textAlign: 'center',
    alignSelf: 'stretch',
  },
  roundButton: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: fill.subtle,
    borderWidth: 1,
    borderColor: line.bright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scoreRow: {
    backgroundColor: colors.cardDeep,
    borderWidth: 1,
    borderRadius: radius.panel,
    paddingHorizontal: 13,
    paddingTop: 13,
    paddingBottom: 12,
  },
  scoreMain: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  playerIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 11 },
  playerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  scoreControls: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  playerName: { fontFamily: fonts.sansSemi, fontSize: 14.5, color: ink.full },
  playerSub: { fontFamily: fonts.sans, fontSize: 11, color: ink.soft, marginTop: 2 },
  pop: { backgroundColor: 'rgba(232,196,106,.15)', borderRadius: 4, paddingVertical: 2, paddingHorizontal: 5 },
  popText: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.85, color: colors.gold },
  scoreValue: { fontFamily: fonts.monoBold, fontSize: 21, minWidth: 30, textAlign: 'center' },
  chipRow: { flexDirection: 'row', gap: 6, marginTop: 10, flexWrap: 'wrap' },
  holeCard: {
    borderWidth: 1,
    borderColor: colors.accentLine,
    borderRadius: radius.format,
    padding: 15,
    gap: 11,
  },
  holeCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  holeCardLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: colors.accent,
  },
  eventDot: { width: 7, height: 7, borderRadius: 999 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  eventText: { flex: 1, minWidth: 0, fontFamily: fonts.sans, fontSize: 12.5, color: ink.strong },
  eventAmount: { fontFamily: fonts.mono, fontSize: 12, color: ink.soft },
  wolfCard: {
    backgroundColor: colors.cardDeep,
    borderWidth: 1,
    borderColor: 'rgba(232,160,200,.28)',
    borderRadius: radius.format,
    padding: 15,
    gap: 9,
  },
  wolfHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  wolfName: { fontFamily: fonts.sansSemi, fontSize: 14, color: ink.full },
  wolfHint: { fontFamily: fonts.sans, fontSize: 11.5, color: ink.muted, lineHeight: 16 },
  pressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: line.card,
    borderRadius: 13,
    paddingVertical: 11,
    paddingHorizontal: 12,
  },
  pressCopy: { flex: 1, minWidth: 0 },
  pressStatus: { fontFamily: fonts.sans, fontSize: 13.5, color: ink.full },
  pressDetail: { fontFamily: fonts.sans, fontSize: 11, color: ink.soft, marginTop: 2 },
  pressButton: { borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14 },
  pressButtonLive: { backgroundColor: colors.clay },
  pressButtonIdle: { borderWidth: 1, borderColor: line.bright },
  pressButtonText: { fontFamily: fonts.sansBold, fontSize: 12 },
});
