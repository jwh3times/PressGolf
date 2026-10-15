import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Field } from '../components/Field';
import { GreenMap } from '../components/GreenMap';
import { ModalHeader, Screen } from '../components/Screen';
import { Body, CHIP_ROW_GAP, Chip, Eyebrow, GhostButton } from '../components/primitives';
import { greenFor, placePoint, type GreenPoint } from '../domain/geo';
import type { LatLng } from '../domain/types';
import { findCourses } from '../osm/client';
import { useStore } from '../store/AppStore';
import { makeStyles, useTheme } from '../theme/theme';
import { fonts } from '../theme/tokens';

const POINTS: { id: GreenPoint; label: string }[] = [
  { id: 'middle', label: 'MIDDLE' },
  { id: 'front', label: 'FRONT' },
  { id: 'back', label: 'BACK' },
];

/**
 * Placing greens on a satellite map (#8), for a course nobody has mapped and
 * nobody is standing on. Pick a hole, then tap where its green is; drag a pin
 * to move it. Front and back are optional, once the middle is down.
 */
export default function GreenMapScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const router = useRouter();
  const course = store.courses.find((c) => c.id === id);
  const [selected, setSelected] = useState(1);
  const [point, setPoint] = useState<GreenPoint>('middle');
  const [name, setName] = useState(course?.name ?? '');
  const [focus, setFocus] = useState<LatLng | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!course) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="Course not found" onClose={() => router.back()} closeLabel="Back" />
      </Screen>
    );
  }
  const holeCount = course.tees[0].holes.length;
  const current = greenFor(course.greens, selected);

  const place = (number: number, which: GreenPoint, at: LatLng) => {
    const placed = placePoint(greenFor(course.greens, number), number, which, at);
    if (!placed) return;
    store.setGreen(course.id, placed);
    // A new green's middle is the usual job, hole after hole: move on to the next.
    if (which === 'middle' && !greenFor(course.greens, number) && number < holeCount) setSelected(number + 1);
  };

  const find = async () => {
    setMessage(null);
    try {
      const [match] = await findCourses(name.trim());
      if (match?.center) setFocus({ ...match.center });
      else setMessage('OpenStreetMap doesn’t know a golf course by that name. Pan the map to it instead.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Couldn’t search. Pan the map to the course instead.');
    }
  };

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader eyebrow={course.name} title="Greens on a map" onClose={() => router.back()} closeLabel="Back" />

      <View style={styles.find}>
        <View style={{ flex: 1, minWidth: 180 }}>
          <Field label="Find the course on the map" value={name} onChangeText={setName} autoCorrect={false} />
        </View>
        <GhostButton label="Go" onPress={() => void find()} style={styles.go} />
      </View>
      {message ? <Text style={styles.message}>{message}</Text> : null}

      <View style={{ gap: 8 }}>
        <Eyebrow>Hole</Eyebrow>
        <View style={styles.chips}>
          {Array.from({ length: holeCount }, (_, i) => i + 1).map((n) => (
            <Chip
              key={n}
              label={greenFor(course.greens, n) ? `${n} ✓` : String(n)}
              accessibilityLabel={`Hole ${n}${greenFor(course.greens, n) ? ', green placed' : ''}`}
              active={n === selected}
              color={colors.accent}
              onPress={() => {
                setSelected(n);
                setPoint('middle');
              }}
            />
          ))}
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <Eyebrow>Point to place</Eyebrow>
        <View style={styles.chips}>
          {POINTS.map((p) => (
            <Chip
              key={p.id}
              label={p.label}
              accessibilityLabel={`Place the ${p.id}`}
              active={p.id === point}
              color={colors.accent}
              disabled={p.id !== 'middle' && !current}
              onPress={() => setPoint(p.id)}
            />
          ))}
        </View>
      </View>

      <Body style={styles.hint}>
        {current
          ? `Tap the map to put hole ${selected}’s ${point} there, or drag its pin.`
          : `Tap the map where the middle of hole ${selected}’s green is.`}
      </Body>

      <GreenMap
        greens={course.greens}
        selected={selected}
        focus={focus}
        onTap={(at) => place(selected, current ? point : 'middle', at)}
        onDrag={(number, which, at) => place(number, which, at)}
      />

      <Body style={styles.hint}>
        {`${course.greens.length} of ${holeCount} greens placed. Imagery is the map provider’s, and may be a few years old.`}
      </Body>
    </Screen>
  );
}

const useStyles = makeStyles(({ colors, ink }) =>
  StyleSheet.create({
    find: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8 },
    go: { minWidth: 72 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: CHIP_ROW_GAP },
    hint: { color: ink.soft, lineHeight: 19 },
    message: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.clay, lineHeight: 17 },
  }),
);
