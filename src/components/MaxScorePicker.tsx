import React from 'react';
import { Text, View } from 'react-native';
import type { MaxScoreRule } from '../domain/types';
import { colors, fonts, ink } from '../theme/tokens';
import { Chip, Eyebrow } from './primitives';

const RULES: { rule: MaxScoreRule; label: string; hint: string }[] = [
  { rule: 'off', label: 'Off', hint: 'Every score counts as written. A pick-up sits out the hole.' },
  { rule: 'double_bogey', label: 'Double bogey', hint: 'Nobody takes more than par + 2. A pick-up counts as that.' },
  {
    rule: 'net_double_bogey',
    label: 'Net double bogey',
    hint: 'The handicap rule: par + 2 + your pops on the hole. A pick-up counts as that.',
  },
];

/** The most anyone can take on a hole. Used for a round, a group's default, and an outing. */
export function MaxScorePicker({
  value,
  onChange,
  title = 'Max score',
  lockedReason,
}: {
  value: MaxScoreRule;
  onChange: (rule: MaxScoreRule) => void;
  title?: string;
  /** When set, the rule is shown but belongs to someone else — this says who. */
  lockedReason?: string;
}) {
  const hint = RULES.find((r) => r.rule === value)?.hint;
  return (
    <View style={{ gap: 8 }}>
      <Eyebrow>{title}</Eyebrow>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {RULES.map(({ rule, label }) => (
          <Chip
            key={rule}
            label={label}
            active={value === rule}
            color={colors.accent}
            disabled={lockedReason != null}
            onPress={() => onChange(rule)}
          />
        ))}
      </View>
      <Text style={{ fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: ink.soft }}>
        {lockedReason ?? hint}
      </Text>
    </View>
  );
}
