import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Field } from '../components/Field';
import { ModalHeader, Screen } from '../components/Screen';
import { Body, Card, Eyebrow, GhostButton, Mono, PrimaryButton } from '../components/primitives';
import { withImported } from '../domain/geo';
import { fetchCourseFeatures, findCourses, type CourseMatch } from '../osm/client';
import { greensFromOsm, type ImportedGreens } from '../osm/greens';
import { useStore } from '../store/AppStore';
import { makeStyles, useTheme } from '../theme/theme';
import { fonts } from '../theme/tokens';

type Step =
  | { kind: 'search' }
  | { kind: 'busy'; doing: string }
  | { kind: 'results'; matches: CourseMatch[] }
  | { kind: 'preview'; match: CourseMatch; imported: ImportedGreens };

const holes = (numbers: number[]) => `${numbers.length === 1 ? 'hole' : 'holes'} ${numbers.join(', ')}`;

/**
 * Finding a course's greens on OpenStreetMap (#8): search by name, pick the
 * course, see how many holes it accounts for, then save. Greens marked on the
 * course are kept; an earlier import is replaced.
 */
export default function GreensScreen() {
  const styles = useStyles();
  const { colors, ink } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const router = useRouter();
  const course = store.courses.find((c) => c.id === id);
  const [name, setName] = useState(course?.name ?? '');
  const [step, setStep] = useState<Step>({ kind: 'search' });
  const [error, setError] = useState<string | null>(null);

  if (!course) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="Course not found" onClose={() => router.back()} closeLabel="Back" />
      </Screen>
    );
  }
  const holeCount = course.tees[0].holes.length;

  const run = async (doing: string, work: () => Promise<Step>, fallback: Step) => {
    setError(null);
    setStep({ kind: 'busy', doing });
    try {
      setStep(await work());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
      setStep(fallback);
    }
  };

  const search = () =>
    run('Searching OpenStreetMap…', async () => ({ kind: 'results', matches: await findCourses(name.trim()) }), {
      kind: 'search',
    });

  const choose = (match: CourseMatch, matches: CourseMatch[]) =>
    run(
      `Reading ${match.name}…`,
      async () => ({ kind: 'preview', match, imported: greensFromOsm(await fetchCourseFeatures(match), holeCount) }),
      { kind: 'results', matches },
    );

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader eyebrow={course.name} title="Find greens" onClose={() => router.back()} closeLabel="Back" />

      <Body style={styles.copy}>
        Many courses are mapped on OpenStreetMap, hole by hole, with the outline of every green. Press
        reads the front, middle and back of each green from them. Greens you marked standing on them
        are kept.
      </Body>

      <Field
        label="Course name on OpenStreetMap"
        value={name}
        onChangeText={setName}
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={() => {
          if (name.trim()) void search();
        }}
      />
      <PrimaryButton label="Search" disabled={!name.trim() || step.kind === 'busy'} onPress={() => void search()} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {step.kind === 'busy' ? (
        <View style={styles.busy}>
          <ActivityIndicator color={colors.accent} />
          <Mono size={11} style={{ color: ink.soft }}>
            {step.doing}
          </Mono>
        </View>
      ) : null}

      {step.kind === 'results' ? (
        <View style={{ gap: 8 }}>
          <Eyebrow>{step.matches.length ? 'Which course?' : 'No golf course by that name'}</Eyebrow>
          {step.matches.length === 0 ? (
            <Body style={styles.copy}>
              Try the name as it would appear on a map, such as “Rancho Park Golf Course”. If the
              course isn’t mapped, its greens can be marked standing on them, from the Score screen.
            </Body>
          ) : null}
          {step.matches.map((match) => (
            <GhostButton
              key={`${match.osmType}/${match.osmId}`}
              label={match.place ? `${match.name} · ${match.place}` : match.name}
              onPress={() => void choose(match, step.matches)}
            />
          ))}
        </View>
      ) : null}

      {step.kind === 'preview' ? (
        <Preview
          holeCount={holeCount}
          imported={step.imported}
          kept={withImported(course.greens, step.imported.greens).kept}
          onSave={() => {
            store.setGreens(course.id, withImported(course.greens, step.imported.greens).greens);
            router.back();
          }}
        />
      ) : null}

      <Pressable
        accessibilityRole="link"
        accessibilityLabel="Map data © OpenStreetMap contributors, under the Open Database License"
        onPress={() => void Linking.openURL('https://www.openstreetmap.org/copyright')}
        style={styles.credit}
      >
        <Mono size={10.5} style={{ color: ink.soft, lineHeight: 16 }}>
          MAP DATA © OPENSTREETMAP CONTRIBUTORS, UNDER THE OPEN DATABASE LICENSE
        </Mono>
      </Pressable>
    </Screen>
  );
}

function Preview({
  holeCount,
  imported,
  kept,
  onSave,
}: {
  holeCount: number;
  imported: ImportedGreens;
  kept: number[];
  onSave: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const found = imported.greens.length;
  const saving = found - kept.length;
  return (
    <Card style={styles.preview}>
      <Eyebrow>{`Greens for ${found} of ${holeCount} holes`}</Eyebrow>
      {imported.missing.length ? <Body style={styles.copy}>Not mapped: {holes(imported.missing)}.</Body> : null}
      {imported.ambiguous.length ? (
        <Body style={styles.copy}>Mapped more than once, so left out: {holes(imported.ambiguous)}.</Body>
      ) : null}
      {kept.length ? (
        <Body style={styles.copy}>
          {holes(kept).replace(/^h/, 'H')} {kept.length === 1 ? 'keeps' : 'keep'} the green you marked.
        </Body>
      ) : null}
      {saving > 0 ? (
        <PrimaryButton label={`Save ${saving} ${saving === 1 ? 'green' : 'greens'}`} onPress={onSave} />
      ) : (
        <Body style={[styles.copy, { color: colors.clay }]}>
          {found ? 'Nothing new to save.' : 'This course has no greens mapped yet.'}
        </Body>
      )}
    </Card>
  );
}

const useStyles = makeStyles(({ colors, ink }) =>
  StyleSheet.create({
    copy: { color: ink.soft, lineHeight: 19 },
    error: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.clay, lineHeight: 17 },
    busy: { alignItems: 'center', gap: 8, paddingVertical: 12 },
    preview: { padding: 16, gap: 10 },
    credit: { minHeight: 48, justifyContent: 'center' },
  }),
);
