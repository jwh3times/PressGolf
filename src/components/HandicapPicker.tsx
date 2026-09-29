import React from 'react';
import { Text, View } from 'react-native';
import type { StrokesMode } from '../domain/types';
import { colors, fonts, ink } from '../theme/tokens';
import { Chip, Eyebrow, Stepper } from './primitives';

const MODES: { mode: StrokesMode; label: string; hint: string }[] = [
  { mode: 'full', label: 'Full handicaps', hint: 'Everyone gets their whole playing handicap. A plus handicap gives strokes back.' },
  { mode: 'off_low', label: 'Off the low man', hint: 'The lowest handicap plays off scratch and everyone else gets the difference.' },
];

/** How pops come from handicaps. Used for a round, a group's default, and an outing. */
export function HandicapPicker({
  strokes,
  allowance,
  onChange,
  title = 'Handicaps',
  lockedReason,
}: {
  strokes: StrokesMode;
  allowance: number;
  onChange: (patch: { strokes?: StrokesMode; allowance?: number }) => void;
  title?: string;
  /** When set, the rule is shown but belongs to someone else — this says who. */
  lockedReason?: string;
}) {
  const locked = lockedReason != null;
  const hint = MODES.find((m) => m.mode === strokes)?.hint;
  return (
    <View style={{ gap: 8 }}>
      <Eyebrow>{title}</Eyebrow>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {MODES.map(({ mode, label }) => (
          <Chip
            key={mode}
            label={label}
            active={strokes === mode}
            color={colors.accent}
            disabled={locked}
            onPress={() => onChange({ strokes: mode })}
          />
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: ink.soft, flexShrink: 1 }}>
          Allowance, the share of each handicap played
        </Text>
        <Stepper
          size={30}
          value={`${allowance}%`}
          decrementLabel="Lower the allowance"
          incrementLabel="Raise the allowance"
          disabled={locked}
          onDecrement={() => onChange({ allowance: Math.max(0, allowance - 5) })}
          onIncrement={() => onChange({ allowance: Math.min(100, allowance + 5) })}
        />
      </View>
      <Text style={{ fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: ink.soft }}>
        {lockedReason ?? hint}
      </Text>
    </View>
  );
}
