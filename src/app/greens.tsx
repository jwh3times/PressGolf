import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Field } from '../components/Field';
import { ModalHeader, Screen } from '../components/Screen';
import { Body, Card, Eyebrow, GhostButton, Mono, PrimaryButton } from '../components/primitives';
import { describeFeatures, withImportedFeatures } from '../domain/course-map';
import { withImported } from '../domain/geo';
import type { CourseFeature } from '../domain/types';
import { fetchCourseFeatures, findCourses, type CourseMatch } from '../osm/client';
import { featuresFromOsm } from '../osm/features';
import { greensFromOsm, type ImportedGreens } from '../osm/greens';
import { useStore } from '../store/AppStore';
import { makeStyles, useTheme } from '../theme/theme';
import { fonts } from '../theme/tokens';

type Step =
  | { kind: 'search' }
  | { kind: 'busy'; doing: string }
  | { kind: 'results'; matches: CourseMatch[] }
  | { kind: 'preview'; match: CourseMatch; imported: ImportedGreens; features: CourseFeature[] };

const holes = (numbers: number[]) => `${numbers.length === 1 ? 'hole' : 'holes'} ${numbers.join(', ')}`;

/**
 * Importing a course from OpenStreetMap: its greens (#8) and its map of
 * hazards, fairways and tees (#125). Search by name, pick the course, see how
 * much of it is mapped, then save. Greens marked on the course and anything
 * drawn in the app are kept; an earlier import is replaced.
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
      `Reading ${match.name}… This can take a minute.`,
      async () => {
        const onRetry = () => setStep({ kind: 'busy', doing: 'OpenStreetMap is slow right now. Still trying…' });
        const elements = await fetchCourseFeatures(match, { onRetry });
        return {
          kind: 'preview',
          match,
          imported: greensFromOsm(elements, holeCount),
          features: featuresFromOsm(elements, holeCount),
        };
      },
      { kind: 'results', matches },
    );

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader eyebrow={course.name} title="From OpenStreetMap" onClose={() => router.back()} closeLabel="Back" />

      <Body style={styles.copy}>
        Many courses are mapped on OpenStreetMap, hole by hole, with the outline of every green and the
        bunkers, water and fairways around it. Press reads the front, middle and back of each green, and
        the hazards for the hole map. Greens you marked standing on them are kept.
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
          features={step.features}
          kept={withImported(course.greens, step.imported.greens).kept}
          onSave={() => {
            store.setGreens(course.id, withImported(course.greens, step.imported.greens).greens);
            store.setFeatures(course.id, withImportedFeatures(course.features, step.features));
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
  features,
  kept,
  onSave,
}: {
  holeCount: number;
  imported: ImportedGreens;
  features: CourseFeature[];
  kept: number[];
  onSave: () => void;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const found = imported.greens.length;
  const saving = found - kept.length;
  const what = [saving > 0 ? `${saving} ${saving === 1 ? 'green' : 'greens'}` : null, features.length ? 'the course map' : null]
    .filter(Boolean)
    .join(' and ');
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
      <Body style={styles.copy}>
        {features.length ? `Course map: ${describeFeatures(features)}.` : 'No hazards or fairways are mapped.'}
      </Body>
      {what ? (
        <PrimaryButton label={`Save ${what}`} onPress={onSave} />
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
