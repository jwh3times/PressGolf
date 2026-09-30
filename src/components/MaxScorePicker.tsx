import React from 'react';
import type { MaxScoreRule } from '../domain/types';
import { RulePicker } from './RulePicker';

const RULES: { value: MaxScoreRule; label: string; hint: string }[] = [
  { value: 'off', label: 'Off', hint: 'Every score counts as written. A pick-up sits out the hole.' },
  { value: 'double_bogey', label: 'Double bogey', hint: 'Nobody takes more than par + 2. A pick-up counts as that.' },
  {
    value: 'net_double_bogey',
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
  return <RulePicker title={title} choices={RULES} value={value} onChange={onChange} lockedReason={lockedReason} />;
}
