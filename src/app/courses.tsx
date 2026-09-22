import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Field } from '../components/Field';
import { ModalHeader, Screen } from '../components/Screen';
import { Body, Card, Eyebrow, Mono, PrimaryButton } from '../components/primitives';
import { makeCourse } from '../domain/factory';
import { useStore } from '../store/AppStore';
import { colors, fonts, ink, line, radius } from '../theme/tokens';

export default function CoursesScreen() {
  const store = useStore();
  const router = useRouter();
  const [name, setName] = useState('');
  const [holeCount, setHoleCount] = useState<9 | 18>(18);

  const create = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const course = makeCourse(trimmed, holeCount);
    store.createCourse(course);
    setName('');
    router.push(`/course/${course.id}`);
  };

  const remove = (id: string, courseName: string) => {
    const inUse = store.rounds.some((r) => r.courseId === id);
    Alert.alert(
      `Delete ${courseName}?`,
      inUse
        ? 'Rounds already played here will lose their card and drop out of the season ledger.'
        : 'This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => store.deleteCourse(id) },
      ],
    );
  };

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader eyebrow="Where you play" title="Courses" onClose={() => router.back()} />

      <View style={{ gap: 10 }}>
        <Eyebrow>Saved courses</Eyebrow>
        {store.courses.length === 0 ? (
          <Card style={{ padding: 16 }}>
            <Body style={{ color: ink.soft, lineHeight: 19 }}>
              None yet. A course needs a par and a stroke index for every hole — the stroke index is
              what decides where everybody’s pops land, so it is worth getting right.
            </Body>
          </Card>
        ) : (
          store.courses.map((course) => {
            const par = course.holes.reduce((sum, h) => sum + h.par, 0);
            const needsIndex = hasDefaultIndexes(course.holes);
            return (
              <Pressable
                key={course.id}
                accessibilityRole="button"
                onPress={() => router.push(`/course/${course.id}`)}
                onLongPress={() => remove(course.id, course.name)}
                style={styles.row}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name}>{course.name}</Text>
                  <Text style={styles.meta}>
                    {course.holes.length} holes · par {par}
                    {needsIndex ? ' · stroke index not set' : ''}
                  </Text>
                </View>
                <Mono size={11} style={{ color: ink.quiet }}>
                  EDIT ›
                </Mono>
              </Pressable>
            );
          })
        )}
      </View>

      <View style={{ gap: 12 }}>
        <Eyebrow>Add a course</Eyebrow>
        <Field label="Name" placeholder="Pine Hollow" value={name} onChangeText={setName} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([18, 9] as const).map((count) => (
            <Pressable
              key={count}
              accessibilityRole="button"
              accessibilityState={{ selected: holeCount === count }}
              onPress={() => setHoleCount(count)}
              style={[
                styles.toggle,
                holeCount === count ? styles.toggleOn : null,
              ]}
            >
              <Text
                style={[
                  styles.toggleText,
                  holeCount === count ? { color: colors.screen } : null,
                ]}
              >
                {count} holes
              </Text>
            </Pressable>
          ))}
        </View>
        <PrimaryButton label="Create course" disabled={name.trim().length === 0} onPress={create} />
        <Text style={styles.note}>
          New courses start as par 4 everywhere with stroke indexes in hole order. Set the real card
          before you play for money.
        </Text>
      </View>
    </Screen>
  );
}

/** A fresh course has indexes 1..n in hole order, which is almost never the real card. */
function hasDefaultIndexes(holes: { strokeIndex: number }[]): boolean {
  return holes.every((h, i) => h.strokeIndex === i + 1);
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: line.card,
    borderRadius: radius.card,
    paddingVertical: 14,
    paddingHorizontal: 15,
  },
  name: { fontFamily: fonts.sansSemi, fontSize: 14.5, color: ink.full },
  meta: { fontFamily: fonts.sans, fontSize: 11.5, color: ink.soft, marginTop: 2 },
  toggle: {
    flex: 1,
    borderWidth: 1,
    borderColor: line.control,
    borderRadius: radius.md,
    paddingVertical: 12,
    alignItems: 'center',
  },
  toggleOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  toggleText: { fontFamily: fonts.sansSemi, fontSize: 13, color: ink.body },
  note: { fontFamily: fonts.sans, fontSize: 11, color: ink.quiet, lineHeight: 16 },
});
