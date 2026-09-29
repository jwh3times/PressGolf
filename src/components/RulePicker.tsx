import React from 'react';
import { Text, View } from 'react-native';
import { colors, fonts, ink } from '../theme/tokens';
import { Chip, Eyebrow } from './primitives';

/**
 * A house rule chosen from a row of chips, with a line saying what the choice
 * means. Set for a round, as a group's default, or once for an outing; where
 * someone else owns it, it is shown locked with the reason instead.
 */
export function RulePicker<T extends string>({
  title,
  choices,
  value,
  onChange,
  lockedReason,
  children,
}: {
  title: string;
  choices: { value: T; label: string; hint: string }[];
  value: T;
  onChange: (value: T) => void;
  /** When set, the rule is shown but belongs to someone else — this says who. */
  lockedReason?: string;
  /** Further controls for the same rule, shown under the chips. */
  children?: React.ReactNode;
}) {
  const hint = choices.find((c) => c.value === value)?.hint;
  return (
    <View style={{ gap: 8 }}>
      <Eyebrow>{title}</Eyebrow>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {choices.map((choice) => (
          <Chip
            key={choice.value}
            label={choice.label}
            active={value === choice.value}
            color={colors.accent}
            disabled={lockedReason != null}
            onPress={() => onChange(choice.value)}
          />
        ))}
      </View>
      {children}
      <Text style={{ fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: ink.soft }}>
        {lockedReason ?? hint}
      </Text>
    </View>
  );
}
