import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { wolfForHole, wolfPickForHole, type RoundContext } from '../domain/engine';
import type { PlayerId } from '../domain/types';
import { MAX_CONTROL_SCALE, useAccessibilityControlScale } from '../hooks/useLargeText';
import { colors, fill, fonts, ink, line, radius } from '../theme/tokens';
import { Chip, GhostButton, StepperButton } from './primitives';

interface Cursor {
  player: number;
  hole: number;
}

/**
 * The whole card at once: players down, holes across, typed in the way you
 * read a paper card — one player's row at a time.
 *
 * The box shows what was written. When the max-score rule counts it as less,
 * the counted figure sits beneath it, so the card and the settlement can both
 * be trusted.
 */
export function CardGrid({
  ctx,
  onScore,
  onPickUp,
  renderBelow,
}: {
  ctx: RoundContext;
  onScore: (playerId: PlayerId, hole: number, value: number | null) => void;
  onPickUp: (playerId: PlayerId, hole: number) => void;
  /** What goes under the keypad for the hole the cursor is on, e.g. its Wolf pick. */
  renderBelow?: (hole: number) => React.ReactNode;
}) {
  const players = ctx.players;
  const holes = ctx.holes;
  const [cursor, setCursor] = useState<Cursor>({ player: 0, hole: 0 });
  // Set after 10+, while the stepper nudges a double-figure score.
  const [big, setBig] = useState<number | null>(null);
  // The grid is too dense to grow without limit, so its text stops at the control
  // scale and its columns grow by the same amount: a label never outgrows its column.
  const controlScale = useAccessibilityControlScale();
  const nameCol = { width: 40 * controlScale };
  const box = { width: 34 * controlScale, minHeight: 34 * controlScale };
  const headLabel = (label: string) => (
    <Text maxFontSizeMultiplier={MAX_CONTROL_SCALE} style={[styles.name, nameCol, styles.headText]}>
      {label}
    </Text>
  );
  // A header figure sits in the middle of a box the size of a score's, level with the row's label.
  const headFigure = (key: number, figure: number) => (
    <View key={key} style={[box, styles.headBox]}>
      <Text maxFontSizeMultiplier={MAX_CONTROL_SCALE} style={styles.headText}>
        {figure}
      </Text>
    </View>
  );

  const at = players[cursor.player];
  const written = (id: PlayerId, hole: number) => ctx.round.scores[id]?.[hole] ?? null;

  const advance = () => {
    setBig(null);
    setCursor((c) => {
      if (c.hole < holes.length - 1) return { ...c, hole: c.hole + 1 };
      if (c.player < players.length - 1) return { player: c.player + 1, hole: 0 };
      return c;
    });
  };

  const enter = (value: number) => {
    onScore(at.id, cursor.hole, value);
    advance();
  };

  const describe = (id: PlayerId, hole: number): string => {
    if (ctx.pickedUp(id, hole)) return 'picked up';
    const value = written(id, hole);
    if (value == null) return 'empty';
    const counted = ctx.gross(id, hole);
    return counted != null && counted !== value ? `${value}, counts ${counted}` : String(value);
  };

  const describeWolf = (hole: number): string => {
    const wolf = wolfForHole(ctx, hole);
    const pick = wolfPickForHole(ctx, hole);
    const name = wolf ? ctx.name(wolf) : 'No wolf';
    if (!pick) return `${name}, no pick`;
    return pick.partner ? `${name} with ${ctx.name(pick.partner)}` : `${name} alone`;
  };

  return (
    <View style={{ gap: 12 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ gap: 4 }}>
          <View style={styles.row}>
            {headLabel('HOLE')}
            {holes.map((h) => headFigure(h.number, h.number))}
          </View>
          <View style={styles.row}>
            {headLabel('PAR')}
            {holes.map((h) => headFigure(h.number, h.par))}
          </View>
          {players.map((player, p) => (
            <View key={player.id} style={styles.row}>
              <Text maxFontSizeMultiplier={MAX_CONTROL_SCALE} style={[styles.name, nameCol]} numberOfLines={1}>
                {player.initials}
              </Text>
              {holes.map((h, hole) => {
                const value = written(player.id, hole);
                const counted = ctx.gross(player.id, hole);
                const pickedUp = ctx.pickedUp(player.id, hole);
                const selected = cursor.player === p && cursor.hole === hole;
                return (
                  <Pressable
                    key={h.number}
                    accessibilityRole="button"
                    accessibilityLabel={`Hole ${h.number}, ${player.name}, ${describe(player.id, hole)}`}
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setBig(null);
                      setCursor({ player: p, hole });
                    }}
                    style={[box, styles.cell, selected ? styles.cellOn : null]}
                  >
                    <Text maxFontSizeMultiplier={MAX_CONTROL_SCALE} style={styles.cellText}>
                      {pickedUp ? 'PU' : (value ?? '')}
                    </Text>
                    {value != null && counted != null && counted !== value ? (
                      <Text maxFontSizeMultiplier={MAX_CONTROL_SCALE} style={styles.counted}>
                        {counted}
                      </Text>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          ))}
          {ctx.round.games.wolf.on ? (
            <View style={styles.row}>
              {headLabel('WOLF')}
              {holes.map((h, hole) => {
                const pick = wolfPickForHole(ctx, hole);
                return (
                  <Pressable
                    key={h.number}
                    accessibilityRole="button"
                    accessibilityLabel={`Wolf, hole ${h.number}, ${describeWolf(hole)}`}
                    accessibilityState={{ selected: cursor.hole === hole }}
                    onPress={() => {
                      setBig(null);
                      setCursor((c) => ({ ...c, hole }));
                    }}
                    style={[box, styles.cell, cursor.hole === hole ? styles.cellOn : null]}
                  >
                    <Text maxFontSizeMultiplier={MAX_CONTROL_SCALE} style={styles.wolfText}>
                      {pick ? (pick.partner ? ctx.initials(pick.partner) : 'LW') : ''}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}
        </View>
      </ScrollView>

      <Text style={styles.cursorText}>
        {at.name} · hole {holes[cursor.hole].number} · par {ctx.par(cursor.hole, at.id)}
      </Text>

      {big != null ? (
        <View style={styles.bigRow}>
          <StepperButton
            label={'−'}
            accessibilityLabel="One less"
            onPress={() => {
              const next = Math.max(10, big - 1);
              setBig(next);
              onScore(at.id, cursor.hole, next);
            }}
          />
          <Text maxFontSizeMultiplier={MAX_CONTROL_SCALE} style={styles.bigValue}>
            {big}
          </Text>
          <StepperButton
            label="+"
            accessibilityLabel="One more"
            onPress={() => {
              const next = Math.min(20, big + 1);
              setBig(next);
              onScore(at.id, cursor.hole, next);
            }}
          />
          <GhostButton label="Next box" onPress={advance} />
        </View>
      ) : null}

      <View style={styles.keypad}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <Pressable
            key={n}
            accessibilityRole="button"
            accessibilityLabel={`Enter ${n}`}
            onPress={() => enter(n)}
            style={({ pressed }) => [styles.key, pressed ? { opacity: 0.6 } : null]}
          >
            <Text maxFontSizeMultiplier={MAX_CONTROL_SCALE} style={styles.keyText}>
              {n}
            </Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Ten or more"
          onPress={() => {
            setBig(10);
            onScore(at.id, cursor.hole, 10);
          }}
          style={({ pressed }) => [styles.key, pressed ? { opacity: 0.6 } : null]}
        >
          <Text maxFontSizeMultiplier={MAX_CONTROL_SCALE} style={styles.keyText}>
            10+
          </Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Chip
          label="Pick up"
          onPress={() => {
            onPickUp(at.id, cursor.hole);
            advance();
          }}
        />
        <Chip label="Clear box" onPress={() => onScore(at.id, cursor.hole, null)} />
      </View>

      {renderBelow?.(cursor.hole)}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  name: { fontFamily: fonts.sansSemi, fontSize: 13, color: ink.full },
  headText: { fontFamily: fonts.mono, fontSize: 10, color: ink.quiet, textAlign: 'center' },
  headBox: { alignItems: 'center', justifyContent: 'center' },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: line.control,
    borderRadius: radius.sm,
    backgroundColor: colors.cardDeep,
  },
  cellOn: { borderColor: colors.accent, backgroundColor: colors.cardActive },
  cellText: { fontFamily: fonts.monoBold, fontSize: 14, color: ink.full },
  wolfText: { fontFamily: fonts.monoBold, fontSize: 11, color: colors.gold },
  counted: { fontFamily: fonts.mono, fontSize: 10, color: colors.clay },
  cursorText: { fontFamily: fonts.sans, fontSize: 13, color: ink.soft },
  bigRow: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  bigValue: { fontFamily: fonts.monoBold, fontSize: 18, color: ink.full, minWidth: 28, textAlign: 'center' },
  keypad: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  key: {
    width: 58,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: fill.control,
  },
  keyText: { fontFamily: fonts.monoBold, fontSize: 18, color: ink.full },
});
