import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Field } from '../components/Field';
import { ModalHeader, Screen } from '../components/Screen';
import { Body, Card, Chip, CHIP_ROW_GAP, EmptyState, Eyebrow, GhostButton, Mono, PrimaryButton } from '../components/primitives';
import { clubsToAdd, MAX_CARRY, MAX_CLUB_NAME, MAX_CLUBS, outOfOrder, parseCarry, starterBag, USUAL_SCORES, usualScoreFor } from '../domain/bag';
import { marksNaming } from '../domain/marks';
import { SHOTS_FOR_CARRY, trackedShots, type ClubShots } from '../domain/tracked-shots';
import type { Club } from '../domain/types';
import { useStore } from '../store/AppStore';
import { makeStyles, useTheme } from '../theme/theme';
import { fonts, MIN_TAP_TARGET, radius } from '../theme/tokens';

/**
 * The bag (#125): each club and how far it carries, typed in by the player,
 * and how they usually score, which club suggestions in a practice round use
 * (#146). Distances you wrote down yourself before the round are allowed in a
 * counted one, so this is plain information; nothing here suggests a club.
 * Neither is a club's tracked carry (#297): it comes only from rounds that have
 * closed, and changes the bag only when the player taps Use.
 */
export default function BagScreen() {
  const styles = useStyles();
  const { ink } = useTheme();
  const store = useStore();
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [other, setOther] = useState('');

  const passes = new Map(outOfOrder(store.clubs).map((w) => [w.id, w.passes]));
  const usual = usualScoreFor(store.usualScore, store.groups);
  const full = store.clubs.length >= MAX_CLUBS;
  const { marks, rounds, courses, clubs } = store;
  const tracked = useMemo(() => trackedShots({ marks, rounds, courses, clubs }), [marks, rounds, courses, clubs]);
  // A club's tracked shots go with it (#295), so taking one with any asks first, saying how many.
  const remove = (club: Club) => {
    const shots = marksNaming(store.marks, club.id);
    if (shots === 0) {
      store.removeClub(club.id);
      return;
    }
    Alert.alert(`Remove ${club.name}?`, `Its ${shots} tracked shot${shots === 1 ? ' goes' : 's go'} with it.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => store.removeClub(club.id) },
    ]);
  };
  const addOther = () => {
    if (!other.trim()) return;
    store.addClub(other);
    setOther('');
  };

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader eyebrow="Settings" title="My bag" onClose={() => router.back()} />

      <Body style={{ color: ink.soft, lineHeight: 19 }}>
        {`How far each club carries in the air on a full swing, in yards. Distances you wrote down yourself before the round are allowed in a counted one. Once a club has ${SHOTS_FOR_CARRY} tracked shots from rounds that have closed, its tracked carry shows beside it.`}
      </Body>

      <View style={{ gap: 8 }}>
        <Eyebrow>Usual score</Eyebrow>
        <View accessibilityRole="radiogroup" accessibilityLabel="Usual score" style={styles.chips}>
          {USUAL_SCORES.map(({ score, label }) => (
            <Chip
              key={score}
              radio
              label={label.toUpperCase()}
              accessibilityLabel={label}
              active={usual.score === score}
              onPress={() => store.setUsualScore(score)}
            />
          ))}
        </View>
        <Body style={{ color: ink.soft, lineHeight: 19 }}>
          {`Over 18 holes${usual.from === 'guess' ? ' (a starting guess)' : usual.from === 'handicap' ? ' (from your handicap)' : ''}. Club suggestions in a practice round spread your shots the way published figures say they spread for golfers who score like this.`}
        </Body>
      </View>

      {store.clubs.length === 0 ? (
        <EmptyState
          title="No clubs yet"
          body="Start from a set of thirteen and type in your carries, or add clubs one at a time."
          action={<PrimaryButton label="Start with a full set" onPress={() => store.fillBag(starterBag())} />}
        />
      ) : (
        <View style={{ gap: 8 }}>
          <Eyebrow>{`${store.clubs.length} club${store.clubs.length === 1 ? '' : 's'}`}</Eyebrow>
          {store.clubs.map((club) => (
            <ClubRow
              key={club.id}
              club={club}
              passes={passes.get(club.id) ?? null}
              tracked={tracked[club.id] ?? null}
              onCarry={(carry) => store.setCarry(club.id, carry)}
              onUseTracked={() => store.takeTrackedCarry(club.id)}
              onRemove={() => remove(club)}
            />
          ))}
        </View>
      )}

      {full ? (
        <Mono size={10.5} style={{ color: ink.quiet }}>
          {MAX_CLUBS} clubs is as many as a bag holds here.
        </Mono>
      ) : adding ? (
        <Card style={styles.adder}>
          <Text style={styles.name}>Add a club</Text>
          <View style={styles.chips}>
            {clubsToAdd(store.clubs).map((name) => (
              <Chip key={name} label={name} accessibilityLabel={`Add ${name}`} onPress={() => store.addClub(name)} />
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
            <View style={{ flex: 1 }}>
              <Field
                label="Another club"
                placeholder="60° wedge"
                value={other}
                maxLength={MAX_CLUB_NAME}
                onChangeText={setOther}
                onSubmitEditing={addOther}
                returnKeyType="done"
              />
            </View>
            <PrimaryButton
              label="Add"
              onPress={addOther}
              disabled={other.trim().length === 0}
              style={{ paddingVertical: 13, paddingHorizontal: 18, borderRadius: radius.md }}
            />
          </View>
          <GhostButton label="Done adding" onPress={() => setAdding(false)} />
        </Card>
      ) : (
        <GhostButton dashed label="Add a club" onPress={() => setAdding(true)} />
      )}
    </Screen>
  );
}

/** One club: its name, its carry as typed, its tracked carry once it has one, and a way out of the bag. Typed text is held here, so "1" on the way to 150 survives. */
function ClubRow({
  club,
  passes,
  tracked,
  onCarry,
  onUseTracked,
  onRemove,
}: {
  club: Club;
  passes: string | null;
  tracked: ClubShots | null;
  onCarry: (carry: number | null) => void;
  onUseTracked: () => void;
  onRemove: () => void;
}) {
  const styles = useStyles();
  const { colors, ink, scheme } = useTheme();
  const [text, setText] = useState(club.carry == null ? '' : String(club.carry));
  const typed = text.trim() !== '' && parseCarry(text) == null;
  const carry = tracked?.trackedCarry ?? null;
  const note = typed ? `A carry is 1 to ${MAX_CARRY} yards.` : passes ? `Carries further than your ${passes}.` : null;

  return (
    <View style={styles.row}>
      <View style={styles.line}>
        <Text style={[styles.name, { flex: 1, minWidth: 0 }]}>{club.name}</Text>
        <View style={styles.carry}>
          <TextInput
            accessibilityLabel={`${club.name} carry, in yards`}
            value={text}
            placeholder="—"
            placeholderTextColor={ink.quiet}
            keyboardType="number-pad"
            maxLength={3}
            selectTextOnFocus
            selectionColor={colors.accent}
            keyboardAppearance={scheme}
            onChangeText={(next) => {
              setText(next);
              onCarry(parseCarry(next));
            }}
            style={styles.input}
          />
          <Mono size={11} style={{ color: ink.quiet }}>
            yd
          </Mono>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${club.name}`}
          onPress={onRemove}
          hitSlop={4}
          style={({ pressed }) => [styles.remove, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.removeMark}>×</Text>
        </Pressable>
      </View>
      {note ? <Text style={[styles.note, { color: colors.clay }]}>{note}</Text> : null}
      {carry != null ? (
        <View style={styles.tracked}>
          <Text style={styles.trackedNote}>
            {`Tracked ${carry} yd, from ${tracked!.counting} tracked shots`}
          </Text>
          {carry !== club.carry ? (
            <Chip
              label="USE"
              accessibilityLabel={`Use ${carry} yards for ${club.name}`}
              onPress={() => {
                setText(String(carry));
                onUseTracked();
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors, ink, line }) =>
  StyleSheet.create({
    row: {
      backgroundColor: colors.cardDeep,
      borderWidth: 1,
      borderColor: line.card,
      borderRadius: radius.card,
      paddingVertical: 6,
      paddingLeft: 14,
      paddingRight: 4,
    },
    line: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    name: { fontFamily: fonts.sansSemi, fontSize: 14, color: ink.full },
    carry: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    input: {
      width: 68,
      minHeight: MIN_TAP_TARGET,
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: line.control,
      borderRadius: 9,
      paddingVertical: 7,
      paddingHorizontal: 8,
      fontFamily: fonts.mono,
      fontSize: 15,
      color: ink.full,
      textAlign: 'center',
    },
    remove: { width: MIN_TAP_TARGET, height: MIN_TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
    removeMark: { fontFamily: fonts.sans, fontSize: 20, color: ink.muted },
    tracked: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, paddingRight: 10, paddingBottom: 4 },
    trackedNote: { flexShrink: 1, fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, color: ink.soft },
    note: { fontFamily: fonts.sans, fontSize: 11.5, lineHeight: 16, paddingBottom: 6, paddingRight: 10 },
    adder: { padding: 14, gap: 12 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 6, rowGap: CHIP_ROW_GAP },
  }),
);
