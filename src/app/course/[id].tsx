import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { Field } from '../../components/Field';
import { ModalHeader, Screen } from '../../components/Screen';
import { Body, Card, Chip, Eyebrow, GhostButton, Mono, StepperButton } from '../../components/primitives';
import type { Hole, Tee } from '../../domain/types';
import { useStore } from '../../store/AppStore';
import { colors, fonts, ink, line, radius } from '../../theme/tokens';

export default function CourseEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const router = useRouter();
  const course = store.courses.find((c) => c.id === id);
  const [selectedTeeId, setSelectedTeeId] = useState<string | null>(null);

  if (!course) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="Course not found" onClose={() => router.back()} closeLabel="Back" />
      </Screen>
    );
  }

  const tee = course.tees.find((t) => t.id === selectedTeeId) ?? course.tees[0];
  const totalPar = tee.holes.reduce((sum, h) => sum + h.par, 0);
  const indexes = tee.holes.map((h) => h.strokeIndex);
  const duplicateIndexes = indexes.length !== new Set(indexes).size;
  const setHole = (index: number, patch: Partial<Hole>) => store.updateHole(course.id, tee.id, index, patch);

  const addTee = () => {
    const created = store.addTee(course.id, tee.id, `${tee.name} copy`);
    if (created) setSelectedTeeId(created.id);
  };

  const deleteTee = () =>
    Alert.alert(`Delete the ${tee.name} tee?`, 'Its card, slope and rating go with it.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          if (store.deleteTee(course.id, tee.id)) {
            setSelectedTeeId(null);
            return;
          }
          Alert.alert(
            'Can’t delete this tee',
            'A saved round was played from it, and that round needs its card to keep settling the same way.',
          );
        },
      },
    ]);

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader
        eyebrow={`${tee.holes.length} holes · par ${totalPar}`}
        title={course.name}
        onClose={() => router.back()}
        closeLabel="Back"
      />

      <Field
        label="Course name"
        value={course.name}
        onChangeText={(text) => store.updateCourse(course.id, { name: text })}
      />

      <View style={{ gap: 10 }}>
        <Eyebrow>Tees</Eyebrow>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {course.tees.map((t) => (
            <Chip
              key={t.id}
              label={t.name}
              accessibilityLabel={`${t.name} tee`}
              active={t.id === tee.id}
              color={colors.accent}
              onPress={() => setSelectedTeeId(t.id)}
            />
          ))}
        </View>
        {/* Keyed by tee, so switching tees resets the half-typed rating. */}
        <TeeDetails key={tee.id} courseId={course.id} tee={tee} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <GhostButton label={`New tee from ${tee.name}`} onPress={addTee} />
          {course.tees.length > 1 ? (
            <GhostButton label={`Delete the ${tee.name} tee`} onPress={deleteTee} />
          ) : null}
        </View>
      </View>

      {duplicateIndexes ? (
        <Card style={styles.warning}>
          <Body style={{ color: colors.clay, lineHeight: 18 }}>
            Two holes on the {tee.name} tee share a stroke index. Pops will land on the wrong holes
            until every index from 1 to {tee.holes.length} is used exactly once.
          </Body>
        </Card>
      ) : null}

      <View style={{ gap: 8 }}>
        <View style={styles.legend}>
          <Eyebrow>Hole</Eyebrow>
          <Text style={styles.legendText}>PAR</Text>
          <Text style={styles.legendText}>SI</Text>
          <Text style={[styles.legendText, { width: 62 }]}>YARDS</Text>
        </View>

        {tee.holes.map((hole, index) => (
          <View key={hole.number} style={styles.holeRow}>
            <Mono size={13} weight="bold" style={{ width: 24, color: ink.full }}>
              {hole.number}
            </Mono>

            <View style={styles.parGroup}>
              <StepperButton
                label={'−'}
                accessibilityLabel={`Lower par on hole ${hole.number}`}
                size={28}
                onPress={() => setHole(index, { par: Math.max(3, hole.par - 1) })}
              />
              <Text style={styles.parValue}>{hole.par}</Text>
              <StepperButton
                label="+"
                accessibilityLabel={`Raise par on hole ${hole.number}`}
                size={28}
                onPress={() => setHole(index, { par: Math.min(6, hole.par + 1) })}
              />
            </View>

            <TextInput
              accessibilityLabel={`Stroke index for hole ${hole.number}`}
              value={String(hole.strokeIndex)}
              keyboardType="number-pad"
              selectTextOnFocus
              selectionColor={colors.accent}
              onChangeText={(text) => {
                const value = Number(text.replace(/[^0-9]/g, ''));
                if (!Number.isFinite(value)) return;
                setHole(index, { strokeIndex: Math.max(1, Math.min(tee.holes.length, value || 1)) });
              }}
              style={[styles.input, { width: 46 }]}
            />

            <TextInput
              accessibilityLabel={`Yards for hole ${hole.number}`}
              value={hole.yards ? String(hole.yards) : ''}
              placeholder="—"
              placeholderTextColor={ink.quiet}
              keyboardType="number-pad"
              selectTextOnFocus
              selectionColor={colors.accent}
              onChangeText={(text) => {
                const value = Number(text.replace(/[^0-9]/g, ''));
                setHole(index, { yards: Number.isFinite(value) ? value : 0 });
              }}
              style={[styles.input, { width: 62 }]}
            />
          </View>
        ))}
      </View>
    </Screen>
  );
}

/** Slope runs 55–155 (the database holds it to that); anything else is not a slope yet. */
function parseSlope(text: string): number | null {
  const value = Number(text.replace(/[^0-9]/g, ''));
  return text.trim() !== '' && value >= 55 && value <= 155 ? value : null;
}

/** A course rating is strokes to one decimal: about 60–80 for 18 holes, 30–40 for 9. */
function parseRating(text: string): number | null {
  const value = Number(text.replace(/[^0-9.]/g, ''));
  return text.trim() !== '' && Number.isFinite(value) && value >= 20 && value <= 90
    ? Math.round(value * 10) / 10
    : null;
}

/** A tee's name, slope and rating. Typed text is held here so a half-typed "69." survives. */
function TeeDetails({ courseId, tee }: { courseId: string; tee: Tee }) {
  const store = useStore();
  const [slopeText, setSlopeText] = useState(tee.slope == null ? '' : String(tee.slope));
  const [ratingText, setRatingText] = useState(tee.rating == null ? '' : String(tee.rating));

  return (
    <View style={{ gap: 10 }}>
      <Field
        label="Tee name"
        accessibilityLabel="Tee name"
        value={tee.name}
        onChangeText={(text) => store.updateTee(courseId, tee.id, { name: text })}
      />
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Field
            label="Slope"
            accessibilityLabel="Slope"
            placeholder="113"
            keyboardType="number-pad"
            value={slopeText}
            hint="55–155, from the scorecard."
            onChangeText={(text) => {
              setSlopeText(text);
              store.updateTee(courseId, tee.id, { slope: parseSlope(text) });
            }}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Course rating"
            accessibilityLabel="Course rating"
            placeholder="72.0"
            keyboardType="decimal-pad"
            value={ratingText}
            hint="Strokes, e.g. 71.2."
            onChangeText={(text) => {
              setRatingText(text);
              store.updateTee(courseId, tee.id, { rating: parseRating(text) });
            }}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  warning: { padding: 14, borderColor: 'rgba(232,154,127,.35)' },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 2 },
  legendText: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.4,
    color: ink.soft,
    width: 46,
    textAlign: 'center',
  },
  holeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.cardDeep,
    borderWidth: 1,
    borderColor: line.hair,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  parGroup: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  parValue: {
    fontFamily: fonts.monoBold,
    fontSize: 14,
    color: ink.full,
    minWidth: 18,
    textAlign: 'center',
  },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: line.control,
    borderRadius: 9,
    paddingVertical: 7,
    paddingHorizontal: 8,
    fontFamily: fonts.mono,
    fontSize: 13,
    color: ink.full,
    textAlign: 'center',
  },
});
