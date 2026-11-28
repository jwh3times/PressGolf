import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useStore } from '../store/AppStore';
import { makeStyles } from '../theme/theme';
import { fonts } from '../theme/tokens';
import { Body, Card, GhostButton, PrimaryButton, Switch } from './primitives';

/** Why a tournament round shows no advice: Rule 4.3a, and what breaking it costs. */
const TOURNAMENT_RULE =
  'In a round under the Rules, the Rules of Golf don’t allow a device to suggest where to aim or which club to hit (Rule 4.3a). The first time costs two strokes, or the hole in match play; the second is disqualification.';

/** Who the switch is for and what it does, on or off. */
const HELP =
  'For any round under the Rules, a competition or one for your handicap: hides club suggestions and where to aim, on this phone only. Scores, games and money work the same.';

/** New round's reminder while the switch is off. */
const REMINDER = 'Playing under the Rules? Turn on Tournament round: Rule 4.3a doesn’t allow club or aim advice.';

/**
 * Whether a screen opened for `roundId` may say where to aim and which club.
 * Looking a course over outside a round, always; in a round, unless this
 * phone has made it a tournament round. `tournament` is null outside a round,
 * where there's no switch.
 */
export function useAdvice(roundId: string | undefined): { advice: boolean; tournament: boolean | null } {
  const store = useStore();
  const tournament = roundId ? (store.tournament[roundId]?.on ?? false) : null;
  return { advice: tournament !== true, tournament };
}

/**
 * The tournament-round switch (#410). Turning it on needs no asking. Turning it
 * off in a round explains the Rule first, in place rather than in an alert, so
 * it works on the web too. On New round, before there's a round, it turns off
 * at once, and a reminder shows while it's off.
 */
export function TournamentSwitch({
  on,
  onChange,
  inRound,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  /** False on New round, where the round hasn't started. */
  inRound: boolean;
}) {
  const styles = useStyles();
  const [asking, setAsking] = useState(false);
  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        <View style={{ flex: 1, minWidth: 160, gap: 2 }}>
          <Text style={styles.name}>Tournament round</Text>
          <Body style={styles.copy}>{HELP}</Body>
        </View>
        <Switch
          on={on}
          onToggle={() => {
            if (!on) onChange(true);
            else if (inRound) setAsking((now) => !now);
            else onChange(false);
          }}
          label="Tournament round"
        />
      </View>
      {asking && on ? (
        <View style={{ gap: 10 }}>
          <Body style={styles.copy}>{TOURNAMENT_RULE}</Body>
          <PrimaryButton
            label="Show advice in this round"
            onPress={() => {
              setAsking(false);
              onChange(false);
            }}
          />
          <GhostButton label="Keep it a tournament round" onPress={() => setAsking(false)} />
        </View>
      ) : null}
      {!inRound && !on ? <Body style={styles.copy}>{REMINDER}</Body> : null}
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
