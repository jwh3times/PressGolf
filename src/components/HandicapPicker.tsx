import React from 'react';
import { Text, View } from 'react-native';
import type { HouseRules, StrokesMode } from '../domain/types';
import { fonts, ink } from '../theme/tokens';
import { Stepper } from './primitives';
import { RulePicker } from './RulePicker';

const MODES: { value: StrokesMode; label: string; hint: string }[] = [
  { value: 'full', label: 'Full handicaps', hint: 'Everyone gets their whole playing handicap. A plus handicap gives strokes back.' },
  { value: 'off_low', label: 'Off the low man', hint: 'The lowest handicap plays off scratch and everyone else gets the difference.' },
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
  onChange: (patch: Partial<Pick<HouseRules, 'strokes' | 'allowance'>>) => void;
  title?: string;
  /** When set, the rule is shown but belongs to someone else — this says who. */
  lockedReason?: string;
}) {
  return (
    <RulePicker
      title={title}
      choices={MODES}
      value={strokes}
      onChange={(mode) => onChange({ strokes: mode })}
      lockedReason={lockedReason}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Text style={{ fontFamily: fonts.sans, fontSize: 13, color: ink.soft, flexShrink: 1 }}>
          Allowance, the share of each handicap played
        </Text>
        <Stepper
          size={30}
          value={`${allowance}%`}
          decrementLabel="Lower the allowance"
          incrementLabel="Raise the allowance"
          disabled={lockedReason != null}
          onDecrement={() => onChange({ allowance: Math.max(0, allowance - 5) })}
          onIncrement={() => onChange({ allowance: Math.min(100, allowance + 5) })}
        />
      </View>
    </RulePicker>
  );
}
