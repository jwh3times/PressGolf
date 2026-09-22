import { useLocalSearchParams, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Field } from '../../components/Field';
import { ModalHeader, Screen } from '../../components/Screen';
import { Body, Card, Eyebrow, Mono, StepperButton } from '../../components/primitives';
import { useStore } from '../../store/AppStore';
import { colors, fonts, ink, line, radius } from '../../theme/tokens';

export default function CourseEditorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const router = useRouter();
  const course = store.courses.find((c) => c.id === id);

  if (!course) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="Course not found" onClose={() => router.back()} closeLabel="Back" />
      </Screen>
    );
  }

  const totalPar = course.holes.reduce((sum, h) => sum + h.par, 0);
  const indexes = course.holes.map((h) => h.strokeIndex);
  const duplicateIndexes = indexes.length !== new Set(indexes).size;

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader
        eyebrow={`${course.holes.length} holes · par ${totalPar}`}
        title={course.name}
        onClose={() => router.back()}
        closeLabel="Back"
      />

      <Field
        label="Course name"
        value={course.name}
        onChangeText={(text) => store.updateCourse(course.id, { name: text })}
      />

      {duplicateIndexes ? (
        <Card style={styles.warning}>
          <Body style={{ color: colors.clay, lineHeight: 18 }}>
            Two holes share a stroke index. Pops will land on the wrong holes until every index from
            1 to {course.holes.length} is used exactly once.
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

        {course.holes.map((hole, index) => (
          <View key={hole.number} style={styles.holeRow}>
            <Mono size={13} weight="bold" style={{ width: 24, color: ink.full }}>
              {hole.number}
            </Mono>

            <View style={styles.parGroup}>
              <StepperButton
                label={'−'}
                size={28}
                onPress={() =>
                  store.updateHole(course.id, index, { par: Math.max(3, hole.par - 1) })
                }
              />
              <Text style={styles.parValue}>{hole.par}</Text>
              <StepperButton
                label="+"
                size={28}
                onPress={() =>
                  store.updateHole(course.id, index, { par: Math.min(6, hole.par + 1) })
                }
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
                store.updateHole(course.id, index, {
                  strokeIndex: Math.max(1, Math.min(course.holes.length, value || 1)),
                });
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
                store.updateHole(course.id, index, {
                  yards: Number.isFinite(value) ? value : 0,
                });
              }}
              style={[styles.input, { width: 62 }]}
            />
          </View>
        ))}
      </View>
    </Screen>
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
