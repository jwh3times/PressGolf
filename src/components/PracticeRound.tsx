import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useStore } from '../store/AppStore';
import { makeStyles } from '../theme/theme';
import { fonts } from '../theme/tokens';
import { Body, Card, GhostButton, PrimaryButton, Switch } from './primitives';

/** Why aiming advice waits for a practice round: Rule 4.3a, and what breaking it costs. */
const PRACTICE_RULE =
  'In a round that counts, the Rules of Golf don’t allow a device to suggest where to aim or which club to hit (Rule 4.3a). The first time costs two strokes, or the hole in match play; the second is disqualification.';

/**
 * Whether a screen opened for `roundId` may say where to aim. Looking a course
 * over outside a round, always; in a round, only once this phone has marked
 * it practice. `practice` is null outside a round, where there's no switch.
 */
export function useAdvice(roundId: string | undefined): { advice: boolean; practice: boolean | null } {
  const store = useStore();
  const practice = roundId ? (store.practice[roundId]?.on ?? false) : null;
  return { advice: practice !== false, practice };
}

/**
 * The practice-round switch (#136). Turning it on explains the Rule and asks
 * first, in place rather than in an alert, so it works on the web too.
 * Turning it off needs no asking.
 */
export function PracticeSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const styles = useStyles();
  const [asking, setAsking] = useState(false);
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
          <Text style={styles.name}>Practice round</Text>
          <Body style={styles.copy}>
            {on
              ? 'Aiming advice is on for this round, on this phone.'
              : 'Shows where to aim on each hole, on this phone only. Scores, games and money work the same.'}
          </Body>
        </View>
        <Switch
          on={on}
          onToggle={() => {
            if (on) onChange(false);
            else setAsking((now) => !now);
          }}
          label="Practice round"
        />
      </View>
      {asking && !on ? (
        <View style={{ gap: 10 }}>
          <Body style={styles.copy}>{PRACTICE_RULE}</Body>
          <PrimaryButton
            label="Make it a practice round"
            onPress={() => {
              setAsking(false);
              onChange(true);
            }}
          />
          <GhostButton label="Keep it a counted round" onPress={() => setAsking(false)} />
        </View>
      ) : null}
    </Card>
  );
}

const useStyles = makeStyles(({ ink }) =>
  StyleSheet.create({
    card: { padding: 14, gap: 12 },
    row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: 12, rowGap: 8 },
    name: { fontFamily: fonts.sansSemi, fontSize: 14, color: ink.full },
    copy: { color: ink.soft, lineHeight: 19 },
  }),
);
