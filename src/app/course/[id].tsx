import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { CourseSuggestions } from '../../components/CourseSuggestions';
import { Field } from '../../components/Field';
import { NewCourseBanner, NewCourseSave } from '../../components/NewCourse';
import { ModalHeader, Screen } from '../../components/Screen';
import { Body, Card, CHIP_ROW_GAP, Chip, Eyebrow, GhostButton, StepperButton } from '../../components/primitives';
import { courseField, holeField, markOn, SOURCE_NAMES, teeField, type CourseSource, type SourceMarks } from '../../domain/course-draft';
import { describeFeatures } from '../../domain/course-map';
import type { Hole, Tee } from '../../domain/types';
import { useStore } from '../../store/AppStore';
import { alpha } from '../../theme/color';
import { makeStyles, useTheme } from '../../theme/theme';
import { fonts, radius } from '../../theme/tokens';

export default function CourseEditorScreen() {
  const styles = useStyles();
  const { colors, ink, scheme } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const router = useRouter();
  // A new course, not saved yet, is its draft (#383).
  const draft = store.newCourse?.course.id === id ? store.newCourse : null;
  const saved = store.courses.find((c) => c.id === id);
  // Someone else's course shows its unsent draft (#381); the course itself when there's none.
  const course = draft ? draft.course : saved ? (store.courseDraft(saved.id) ?? saved) : undefined;
  const owned = saved ? store.ownsCourse(saved.id) : true;
  const marks: SourceMarks = draft?.marks ?? {};
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
  // A draft's blank (0) isn't an index yet, so two blanks aren't a clash.
  const indexes = tee.holes.map((h) => h.strokeIndex).filter((index) => index > 0);
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
        eyebrow={`${draft ? 'New course · ' : ''}${tee.holes.length} holes · par ${totalPar}`}
        title={course.name || 'New course'}
        // Leaving a new course without saving it makes nothing.
        onClose={() => {
          if (draft) store.discardNewCourse();
          router.back();
        }}
        closeLabel={draft ? 'Cancel' : 'Back'}
      />

      {draft ? <NewCourseBanner draft={draft} /> : null}
      {owned || !saved ? null : <CourseSuggestions course={saved} />}

      <Field
        label="Course name"
        value={course.name}
        hint={checkHint(markOn(marks, courseField('name')))}
        onChangeText={(text) => store.updateCourse(course.id, { name: text })}
      />

      <View style={{ gap: 10 }}>
        <Eyebrow>Tees</Eyebrow>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: CHIP_ROW_GAP }}>
          {course.tees.map((t) => (
            <Chip
              key={t.id}
              label={t.name || 'Unnamed'}
              accessibilityLabel={`${t.name || 'Unnamed'} tee`}
              active={t.id === tee.id}
              color={colors.accent}
              onPress={() => setSelectedTeeId(t.id)}
            />
          ))}
        </View>
        {/* Keyed by tee, so switching tees resets the half-typed rating. */}
        <TeeDetails key={tee.id} courseId={course.id} tee={tee} marks={marks} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <GhostButton label={`New tee from ${tee.name}`} onPress={addTee} />
          {owned && course.tees.length > 1 ? (
            <GhostButton label={`Delete the ${tee.name} tee`} onPress={deleteTee} />
          ) : null}
        </View>
      </View>

      {draft ? (
        <View style={{ gap: 8 }}>
          <Eyebrow>Greens and course map</Eyebrow>
          <Body style={{ color: ink.soft, lineHeight: 19 }}>
            Greens and the course map come once the course is saved.
          </Body>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Eyebrow>Greens and course map</Eyebrow>
          <Body style={{ color: ink.soft, lineHeight: 19 }}>
            {course.greens.length
              ? `${course.greens.length} of ${tee.holes.length} greens saved, for yardage on the Score screen.`
              : 'No greens saved yet. With them, the Score screen gives the yardage to the green.'}
            {course.features.length ? ` The map has ${describeFeatures(course.features)}.` : ''}
          </Body>
          <GhostButton
            label="Import from OpenStreetMap"
            onPress={() => router.push({ pathname: '/greens', params: { id: course.id } })}
          />
          <GhostButton
            label="Place greens on a map"
            onPress={() => router.push({ pathname: '/green-map', params: { id: course.id } })}
          />
          <GhostButton
            label="Draw out of bounds"
            onPress={() => router.push({ pathname: '/green-map', params: { id: course.id, mode: 'bounds' } })}
          />
          {course.features.length || course.greens.length ? (
            <GhostButton
              label="View the hole map"
              onPress={() => router.push({ pathname: '/hole-map', params: { course: course.id, hole: '1' } })}
            />
          ) : null}
          {course.features.length ? (
            <GhostButton
              label="Course guide"
              onPress={() => router.push({ pathname: '/course-guide', params: { course: course.id } })}
            />
          ) : null}
        </View>
      )}

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

        {tee.holes.map((hole, index) => {
          const source = markOn(
            marks,
            holeField(tee.id, hole.number, 'par'),
            holeField(tee.id, hole.number, 'strokeIndex'),
            holeField(tee.id, hole.number, 'yards'),
          );
          return (
            <View key={hole.number} style={[styles.holeRow, source ? styles.marked : null]}>
              {/* A value a source filled: a gold dot, until the golfer confirms it (#383). */}
              <Text
                style={[styles.number, source ? { color: colors.gold } : null]}
                accessibilityLabel={source ? `Hole ${hole.number} came from ${SOURCE_NAMES[source]}: check it` : undefined}
              >
                {hole.number}
                {source ? '•' : ''}
              </Text>

              <View style={styles.parGroup}>
                <StepperButton
                  label={'−'}
                  accessibilityLabel={`Lower par on hole ${hole.number}`}
                  size={28}
                  // A blank par, from a scan, starts at 4 whichever way it's pressed.
                  onPress={() => setHole(index, { par: hole.par ? Math.max(3, hole.par - 1) : 4 })}
                />
                <Text style={styles.parValue}>{hole.par || '—'}</Text>
                <StepperButton
                  label="+"
                  accessibilityLabel={`Raise par on hole ${hole.number}`}
                  size={28}
                  onPress={() => setHole(index, { par: hole.par ? Math.min(6, hole.par + 1) : 4 })}
                />
              </View>

              <TextInput
                accessibilityLabel={`Stroke index for hole ${hole.number}`}
                value={hole.strokeIndex ? String(hole.strokeIndex) : ''}
                placeholder="—"
                placeholderTextColor={ink.quiet}
                keyboardType="number-pad"
                selectTextOnFocus
                selectionColor={colors.accent}
                keyboardAppearance={scheme}
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
                keyboardAppearance={scheme}
                onChangeText={(text) => {
                  const value = Number(text.replace(/[^0-9]/g, ''));
                  setHole(index, { yards: Number.isFinite(value) ? value : 0 });
                }}
                style={[styles.input, { width: 62 }]}
              />
            </View>
          );
        })}
      </View>

      {draft ? <NewCourseSave draft={draft} /> : null}
    </Screen>
  );
}

/** What a field a source filled says under it, until the golfer confirms it (#383). */
function checkHint(source: CourseSource | null, otherwise?: string): string | undefined {
  return source ? `From ${SOURCE_NAMES[source]}. Check it against the card.` : otherwise;
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
function TeeDetails({ courseId, tee, marks }: { courseId: string; tee: Tee; marks: SourceMarks }) {
  const store = useStore();
  const [slopeText, setSlopeText] = useState(tee.slope == null ? '' : String(tee.slope));
  const [ratingText, setRatingText] = useState(tee.rating == null ? '' : String(tee.rating));

  return (
    <View style={{ gap: 10 }}>
      <Field
        label="Tee name"
        accessibilityLabel="Tee name"
        value={tee.name}
        hint={checkHint(markOn(marks, teeField(tee.id, 'name')))}
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
            hint={checkHint(markOn(marks, teeField(tee.id, 'slope')), '55–155, from the scorecard.')}
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
            hint={checkHint(markOn(marks, teeField(tee.id, 'rating')), 'Strokes, e.g. 71.2.')}
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

const useStyles = makeStyles(({ colors, ink, line }) =>
  StyleSheet.create({
    warning: { padding: 14, borderColor: alpha(colors.clay, 0.35) },
    marked: { borderColor: alpha(colors.gold, 0.6) },
    number: { width: 24, fontFamily: fonts.monoBold, fontSize: 13, color: ink.full },
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
  }),
);
