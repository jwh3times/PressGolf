import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Field } from '../components/Field';
import { HoleCountPicker, LibrarySearch } from '../components/LibrarySearch';
import { ModalHeader, Screen } from '../components/Screen';
import { Body, Card, Eyebrow, Mono, PrimaryButton } from '../components/primitives';
import { makeCourse } from '../domain/factory';
import { useStore } from '../store/AppStore';
import { makeStyles, useTheme } from '../theme/theme';
import { fonts, radius } from '../theme/tokens';

export default function CoursesScreen() {
  const styles = useStyles();
  const { ink } = useTheme();
  const store = useStore();
  const router = useRouter();

  // A course in the library stays there for everyone: the golfer only takes it off their list (#383).
  const remove = (id: string, courseName: string) => {
    if (store.libraryOpen) {
      Alert.alert(`Take ${courseName} off your courses?`, 'It stays in Press for everyone, and on any round played there.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Take it off', style: 'destructive', onPress: () => store.removeFromMyCourses(id) },
      ]);
      return;
    }
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
        <Eyebrow>{store.libraryOpen ? 'Your courses' : 'Saved courses'}</Eyebrow>
        {store.myCourses.length === 0 ? (
          <Card style={{ padding: 16 }}>
            <Body style={{ color: ink.soft, lineHeight: 19 }}>
              None yet. A course needs a par and a stroke index for every hole — the stroke index is
              what decides where everybody’s pops land, so it is worth getting right.
            </Body>
          </Card>
        ) : (
          store.myCourses.map((course) => {
            const holes = course.tees[0].holes;
            const par = holes.reduce((sum, h) => sum + h.par, 0);
            const needsIndex = course.tees.some((t) => hasDefaultIndexes(t.holes));
            return (
              <Pressable
                key={course.id}
                accessibilityRole="button"
                accessibilityHint={store.libraryOpen ? 'Long press to take it off your courses.' : 'Long press to delete it.'}
                onPress={() => router.push(`/course/${course.id}`)}
                onLongPress={() => remove(course.id, course.name)}
                style={styles.row}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name}>{course.name}</Text>
                  <Text style={styles.meta}>
                    {holes.length} holes · par {par}
                    {course.tees.length > 1 ? ` · ${course.tees.length} tees` : ''}
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

      {store.libraryOpen ? <LibrarySearch /> : <TypeACourse />}
    </Screen>
  );
}

/** The demo, and a build with no server: courses typed in by hand and kept on the phone. */
function TypeACourse() {
  const styles = useStyles();
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

  return (
    <View style={{ gap: 12 }}>
      <Eyebrow>Add a course</Eyebrow>
      <Field label="Name" placeholder="Pine Hollow" value={name} onChangeText={setName} />
      <HoleCountPicker value={holeCount} onChange={setHoleCount} />
      <PrimaryButton label="Create course" disabled={name.trim().length === 0} onPress={create} />
      <Text style={styles.note}>
        New courses start as par 4 everywhere with stroke indexes in hole order. Set the real card
        before you play for money.
      </Text>
    </View>
  );
}

/** A fresh course has indexes 1..n in hole order, which is almost never the real card. */
function hasDefaultIndexes(holes: { strokeIndex: number }[]): boolean {
  return holes.every((h, i) => h.strokeIndex === i + 1);
}

const useStyles = makeStyles(({ colors, ink, line }) =>
  StyleSheet.create({
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
    note: { fontFamily: fonts.sans, fontSize: 11, color: ink.quiet, lineHeight: 16 },
  }),
);
