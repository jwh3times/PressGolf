import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { goodEnoughToMark, MARK_ACCURACY_M, yardsToGreen } from '../domain/geo';
import type { Green, LatLng } from '../domain/types';
import { useLiveLocation, type Fix } from '../hooks/useLiveLocation';
import { makeStyles, useTheme } from '../theme/theme';
import { radius } from '../theme/tokens';
import { Body, CHIP_ROW_GAP, Chip, Display, Mono } from './primitives';

const metres = (accuracy: number | null) => (accuracy == null ? null : Math.round(accuracy));

function spoken(fix: Fix, green: Green): string {
  const yards = yardsToGreen(fix.position, green);
  const parts = [`${yards.middle} yards to the middle of the green`];
  if (yards.front != null) parts.push(`${yards.front} to the front`);
  if (yards.back != null) parts.push(`${yards.back} to the back`);
  const accuracy = metres(fix.accuracy);
  if (accuracy != null) parts.push(`GPS good to ${accuracy} metres`);
  return parts.join(', ');
}

/**
 * Distance to the green on the Score screen (#8). Nothing runs until asked: a
 * tap gives a minute of live yardage, then the last reading stays until the
 * next tap. A hole with no green saved offers to mark it, standing on it.
 */
export function GreenYardage({
  holeNumber,
  green,
  onMark,
  onPosition,
}: {
  holeNumber: number;
  green: Green | null;
  onMark: (green: Green) => void;
  /** Each new fix, for what else on the screen follows where you are. */
  onPosition?: (position: LatLng) => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { state, start, fixNow } = useLiveLocation();
  const [marking, setMarking] = useState(false);
  const located = state.status === 'located' ? state.fix.position : null;

  const report = useRef(onPosition);
  useEffect(() => {
    report.current = onPosition;
  });
  useEffect(() => {
    if (located) report.current?.(located);
  }, [located]);

  const mark = async () => {
    setMarking(true);
    try {
      const fix = await fixNow();
      if (!fix) return;
      if (!goodEnoughToMark(fix.accuracy)) {
        const accuracy = metres(fix.accuracy);
        Alert.alert(
          'GPS isn’t sure enough yet',
          `${accuracy == null ? 'This phone didn’t say how accurate it is' : `It’s only good to ${accuracy} m here`}, and marking a green needs ${MARK_ACCURACY_M} m or better. Give it a moment in the open and try again.`,
        );
        return;
      }
      onMark({ number: holeNumber, middle: fix.position, front: null, back: null, source: 'marked' });
      void start();
    } catch (error) {
      Alert.alert('Couldn’t get your location', error instanceof Error ? error.message : 'Try again in a moment.');
    } finally {
      setMarking(false);
    }
  };

  const confirmMark = () =>
    Alert.alert(
      green ? `Mark hole ${holeNumber}’s green again?` : `Mark hole ${holeNumber}’s green?`,
      `Stand in the middle of the green, then tap Mark.${green?.front || green?.back ? ' This keeps only the middle: the front and back are cleared.' : ''}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Mark', onPress: () => void mark() },
      ],
    );

  const markChip = (
    <Chip
      label={marking ? 'MARKING…' : green ? 'RE-MARK' : 'MARK THIS GREEN'}
      accessibilityLabel={green ? `Mark hole ${holeNumber}’s green again` : `Mark hole ${holeNumber}’s green`}
      disabled={marking}
      onPress={confirmMark}
    />
  );

  if (!green) {
    return (
      <View style={[styles.card, styles.row]}>
        <Body style={styles.note}>No green saved for this hole. Standing on it?</Body>
        {markChip}
      </View>
    );
  }

  if (state.status === 'denied' || state.status === 'failed') {
    return (
      <View style={[styles.card, styles.row]}>
        <Body style={styles.note}>
          {state.status === 'denied'
            ? 'Press can’t see your location. Allow it in Settings to get yardages.'
            : state.message}
        </Body>
        {state.status === 'denied' ? (
          <Chip label="OPEN SETTINGS" color={colors.accent} onPress={() => void Linking.openSettings()} />
        ) : (
          <Chip label="TRY AGAIN" color={colors.accent} onPress={() => void start()} />
        )}
      </View>
    );
  }

  if (state.status === 'located') {
    const yards = yardsToGreen(state.fix.position, green);
    const accuracy = metres(state.fix.accuracy);
    const edges = [yards.front != null ? `${yards.front} FRONT` : null, yards.back != null ? `${yards.back} BACK` : null]
      .filter(Boolean)
      .join(' · ');
    return (
      <View style={[styles.card, styles.row]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={spoken(state.fix, green)}
          accessibilityHint={state.live ? undefined : 'Updates the yardage for another minute'}
          onPress={() => void start()}
          style={styles.reading}
        >
          <View style={styles.figure}>
            <Display size={34}>{yards.middle}</Display>
            <Mono size={10.5} style={styles.unit}>
              TO THE MIDDLE
            </Mono>
          </View>
          {edges ? (
            <Mono size={11} style={styles.edges}>
              {edges}
            </Mono>
          ) : null}
          <Mono size={10.5} style={state.live ? styles.live : styles.stale}>
            {[state.live ? 'LIVE' : null, accuracy != null ? `±${accuracy} M` : null, state.live ? null : 'TAP TO UPDATE']
              .filter(Boolean)
              .join(' · ')}
          </Mono>
        </Pressable>
        {markChip}
        {/* OpenStreetMap's licence asks for credit wherever its data shows, with the licence a tap away. */}
        {green.source === 'osm' ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Green from OpenStreetMap. Opens its copyright and licence page"
            hitSlop={{ top: 14, bottom: 14 }}
            onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright')}
            style={styles.credit}
          >
            <Mono size={10} style={styles.stale}>
              GREEN © OPENSTREETMAP
            </Mono>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={[styles.card, styles.row]}>
      {state.status === 'finding' ? (
        <Mono size={11} style={styles.finding}>
          FINDING YOU…
        </Mono>
      ) : (
        <Chip label="⌖ YARDS TO GREEN" active color={colors.accent} onPress={() => void start()} />
      )}
      {markChip}
    </View>
  );
}

const useStyles = makeStyles(({ colors, ink, line }) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.cardDeep,
      borderWidth: 1,
      borderColor: line.card,
      borderRadius: radius.card,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      columnGap: 12,
      rowGap: CHIP_ROW_GAP,
    },
    note: { flex: 1, minWidth: 160, color: ink.soft, lineHeight: 18 },
    reading: { flex: 1, minWidth: 160, gap: 2 },
    figure: { flexDirection: 'row', alignItems: 'baseline', gap: 8 },
    unit: { color: ink.soft, letterSpacing: 1.2 },
    edges: { color: ink.body },
    live: { color: colors.accent, letterSpacing: 1.2 },
    stale: { color: ink.soft, letterSpacing: 1.2 },
    finding: { color: ink.soft, letterSpacing: 1.2, paddingVertical: 14 },
    credit: { width: '100%', minHeight: 20, justifyContent: 'center' },
  }),
);
