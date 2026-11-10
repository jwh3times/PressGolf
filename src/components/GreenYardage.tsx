import React, { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { goodEnoughToMark, MARK_ACCURACY_M, yardsToGreen } from '../domain/geo';
import { hitOf, markLabel, MARK_GOOD_WITHIN_M, MARK_WAIT_MS, sameHit } from '../domain/marks';
import type { Club, Green, LatLng, Mark, MarkHit } from '../domain/types';
import { useLiveLocation, type Fix } from '../hooks/useLiveLocation';
import { makeStyles, useTheme } from '../theme/theme';
import { MIN_TAP_TARGET, radius } from '../theme/tokens';
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

/** Marking the bag owner's ball on this hole (#295). Left out where no ball is being played, as on a card typed in. */
export interface BallMarking {
  /** The bag, in its own order: the club picker lists it as it is. */
  clubs: Club[];
  /** The last mark on this hole, which the card confirms. */
  mark: Mark | null;
  onMark: (fix: Fix, hit: MarkHit) => void;
  /** Changes what was hit from `mark`. */
  onChange: (hit: MarkHit) => void;
  /** Takes `mark` away. */
  onUndo: () => void;
}

/**
 * Distance to the green on the Score screen (#8). Nothing runs until asked: a
 * tap gives a minute of live yardage, then the last reading stays until the
 * next tap. A hole with no green saved offers to mark it, standing on it. In a
 * live round the owner can mark their ball too (#295).
 */
export function GreenYardage({
  holeNumber,
  green,
  onMark,
  onPosition,
  ball,
}: {
  holeNumber: number;
  green: Green | null;
  onMark: (green: Green) => void;
  /** Each new fix, for what else on the screen follows where you are. */
  onPosition?: (position: LatLng) => void;
  ball?: BallMarking;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { state, start, fixNow, fixWithin } = useLiveLocation();
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
      accessibilityLabel={
        marking
          ? `Marking hole ${holeNumber}’s green`
          : green
            ? `Re-mark hole ${holeNumber}’s green`
            : `Mark this green, hole ${holeNumber}`
      }
      disabled={marking}
      onPress={confirmMark}
    />
  );

  const frame = (reading: React.ReactNode) => (
    <View style={styles.card}>
      <View style={styles.row}>{reading}</View>
      {ball ? (
        <BallMark ball={ball} holeNumber={holeNumber} fixWithin={() => fixWithin(MARK_GOOD_WITHIN_M, MARK_WAIT_MS)} />
      ) : null}
    </View>
  );

  if (!green) {
    return frame(
      <>
        <Body style={styles.note}>No green saved for this hole. Standing on it?</Body>
        {markChip}
      </>,
    );
  }

  if (state.status === 'denied' || state.status === 'failed') {
    return frame(
      <>
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
      </>,
    );
  }

  if (state.status === 'located') {
    const yards = yardsToGreen(state.fix.position, green);
    const accuracy = metres(state.fix.accuracy);
    const edges = [yards.front != null ? `${yards.front} FRONT` : null, yards.back != null ? `${yards.back} BACK` : null]
      .filter(Boolean)
      .join(' · ');
    return frame(
      <>
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
      </>,
    );
  }

  return frame(
    <>
      {state.status === 'finding' ? (
        <Mono size={11} style={styles.finding}>
          FINDING YOU…
        </Mono>
      ) : (
        <Chip label="⌖ YARDS TO GREEN" active color={colors.accent} onPress={() => void start()} />
      )}
      {markChip}
    </>,
  );
}

type Step = { step: 'idle' } | { step: 'finding' } | { step: 'picking'; fix: Fix } | { step: 'changing'; mark: Mark };

/**
 * Mark ball: a close fix, then what's about to be hit from it. The picker lists
 * the bag as it is with nothing chosen, so it never suggests a club in a
 * counted round. Afterwards the card says what was marked, and a tap on that
 * changes it or takes it back.
 */
function BallMark({
  ball,
  holeNumber,
  fixWithin,
}: {
  ball: BallMarking;
  holeNumber: number;
  fixWithin: () => Promise<Fix | null>;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [step, setStep] = useState<Step>({ step: 'idle' });

  const find = async () => {
    setStep({ step: 'finding' });
    try {
      const fix = await fixWithin();
      setStep(fix ? { step: 'picking', fix } : { step: 'idle' });
    } catch (error) {
      setStep({ step: 'idle' });
      Alert.alert('Couldn’t get your location', error instanceof Error ? error.message : 'Try again in a moment.');
    }
  };

  if (step.step === 'picking' || step.step === 'changing') {
    const current = step.step === 'changing' ? hitOf(step.mark) : null;
    const choose = (hit: MarkHit) => {
      if (step.step === 'picking') ball.onMark(step.fix, hit);
      else ball.onChange(hit);
      setStep({ step: 'idle' });
    };
    const rough = step.step === 'picking' ? roughness(step.fix.accuracy) : null;
    const options: { hit: MarkHit; label: string; name: string }[] = [
      ...ball.clubs.map((club) => ({ hit: { kind: 'full', clubId: club.id } as MarkHit, label: club.name, name: club.name })),
      { hit: { kind: 'partial' }, label: 'NOT A FULL SWING', name: 'Not a full swing' },
      { hit: { kind: 'green' }, label: 'ON THE GREEN', name: 'On the green' },
    ];
    return (
      <View style={styles.picker}>
        <Body style={styles.question}>What are you hitting?</Body>
        {rough ? <Body style={styles.note}>{rough}</Body> : null}
        <View style={styles.chips}>
          {options.map((option) => (
            <Chip
              key={option.hit.kind === 'full' ? option.hit.clubId : option.hit.kind}
              label={option.label}
              accessibilityLabel={option.name}
              active={current != null && sameHit(current, option.hit)}
              color={colors.accent}
              onPress={() => choose(option.hit)}
            />
          ))}
        </View>
        <View style={styles.chips}>
          {step.step === 'changing' ? (
            <>
              <Chip
                label="UNDO"
                accessibilityLabel="Undo the mark"
                onPress={() => {
                  ball.onUndo();
                  setStep({ step: 'idle' });
                }}
              />
              <Chip label="KEEP" accessibilityLabel="Keep the mark as it is" onPress={() => setStep({ step: 'idle' })} />
            </>
          ) : (
            <Chip label="CANCEL" accessibilityLabel="Cancel the mark" onPress={() => setStep({ step: 'idle' })} />
          )}
        </View>
      </View>
    );
  }

  const { mark } = ball;
  const marked = mark ? `Marked: ${markLabel(mark, ball.clubs)}` : null;
  const finding = step.step === 'finding';
  return (
    <View style={styles.row}>
      {mark ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={marked ?? undefined}
          accessibilityHint="Change what was hit, or undo the mark"
          onPress={() => setStep({ step: 'changing', mark })}
          style={({ pressed }) => [styles.marked, pressed && { opacity: 0.6 }]}
        >
          <Body style={{ color: colors.accent }}>{marked}</Body>
        </Pressable>
      ) : (
        <View style={styles.marked} />
      )}
      <Chip
        label={finding ? 'FINDING…' : 'MARK BALL'}
        accessibilityLabel={finding ? 'Finding where your ball is' : `Mark ball, hole ${holeNumber}`}
        color={colors.accent}
        disabled={finding}
        onPress={() => void find()}
      />
    </View>
  );
}

/** What to say about a fix too rough to settle on; null for a close one. */
function roughness(accuracy: number | null): string | null {
  if (accuracy == null) return 'This phone didn’t say how accurate GPS is here.';
  return accuracy > MARK_GOOD_WITHIN_M ? `GPS is only good to ${Math.round(accuracy)} m here.` : null;
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
      gap: 12,
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
    marked: { flex: 1, minWidth: 160, minHeight: MIN_TAP_TARGET, justifyContent: 'center' },
    picker: { gap: 10, borderTopWidth: 1, borderTopColor: line.hair, paddingTop: 12 },
    question: { color: ink.full },
    chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 6, rowGap: CHIP_ROW_GAP },
  }),
);
