import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Field } from '../components/Field';
import { GreenMap } from '../components/GreenMap';
import { ModalHeader, Screen } from '../components/Screen';
import { Body, Card, CHIP_ROW_GAP, Chip, Eyebrow, GhostButton, Mono, PrimaryButton } from '../components/primitives';
import { withFeature } from '../domain/course-map';
import { greenFor, placePoint, type GreenPoint } from '../domain/geo';
import type { CourseFeature, LatLng } from '../domain/types';
import { findCourses } from '../osm/client';
import { useStore } from '../store/AppStore';
import { makeStyles, useTheme } from '../theme/theme';
import { fonts } from '../theme/tokens';

const POINTS: { id: GreenPoint; label: string }[] = [
  { id: 'middle', label: 'MIDDLE' },
  { id: 'front', label: 'FRONT' },
  { id: 'back', label: 'BACK' },
];

/** An out-of-bounds line as it's being drawn or changed, before it's saved. */
interface Draft {
  id: string;
  /** Where it is in the list, for its name; null for a new line. */
  index: number | null;
  points: LatLng[];
  holes: number[];
}

/** "every hole", or the holes a line is limited to. */
function holesText(holes: number[] | undefined): string {
  if (!holes?.length) return 'every hole';
  return `${holes.length === 1 ? 'hole' : 'holes'} ${[...holes].sort((a, b) => a - b).join(', ')}`;
}

/**
 * The course owner's satellite map editor. Placing greens (#8), for a course
 * nobody has mapped and nobody is standing on: pick a hole, then tap where its
 * green is; drag a pin to move it, and front and back once the middle is down.
 * And drawing out of bounds (#136): tap along the white stakes, drag a point to
 * move it, and limit a line to the holes it applies to.
 */
export default function GreenMapScreen() {
  const styles = useStyles();
  const { colors } = useTheme();
  const { id, mode: startIn } = useLocalSearchParams<{ id: string; mode?: string }>();
  const store = useStore();
  const router = useRouter();
  const course = store.courses.find((c) => c.id === id);
  const [selected, setSelected] = useState(1);
  const [point, setPoint] = useState<GreenPoint>('middle');
  const [name, setName] = useState(course?.name ?? '');
  const [focus, setFocus] = useState<LatLng | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<'greens' | 'bounds'>(startIn === 'bounds' ? 'bounds' : 'greens');
  const [draft, setDraft] = useState<Draft | null>(null);

  if (!course) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="Course not found" onClose={() => router.back()} closeLabel="Back" />
      </Screen>
    );
  }
  const holeCount = course.tees[0].holes.length;
  const current = greenFor(course.greens, selected);
  const lines = course.features.filter((f) => f.kind === 'outOfBounds');

  const pick = (line: CourseFeature) =>
    setDraft({ id: line.id, index: lines.indexOf(line), points: line.points, holes: line.holes ?? [] });
  const save = (d: Draft) => {
    // Changed or new, it's the owner's now: a later import leaves it as they drew it.
    const line: CourseFeature = {
      id: d.id,
      kind: 'outOfBounds',
      hole: null,
      points: d.points,
      source: 'map',
      ...(d.holes.length ? { holes: d.holes } : {}),
    };
    store.setFeatures(course.id, withFeature(course.features, line));
    setDraft(null);
  };
  const toggleHole = (d: Draft, n: number) =>
    setDraft({ ...d, holes: d.holes.includes(n) ? d.holes.filter((h) => h !== n) : [...d.holes, n].sort((a, b) => a - b) });

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
      <ModalHeader
        eyebrow={course.name}
        title={mode === 'greens' ? 'Greens on a map' : 'Out of bounds'}
        onClose={() => router.back()}
        closeLabel="Back"
      />

      <View style={styles.chips}>
        {(['greens', 'bounds'] as const).map((m) => (
          <Chip
            key={m}
            label={m === 'greens' ? 'GREENS' : 'OUT OF BOUNDS'}
            accessibilityLabel={m === 'greens' ? 'Place greens' : 'Draw out of bounds'}
            active={mode === m}
            color={colors.accent}
            onPress={() => {
              setMode(m);
              setDraft(null);
            }}
          />
        ))}
      </View>

      <View style={styles.find}>
        <View style={{ flex: 1, minWidth: 180 }}>
          <Field label="Find the course on the map" value={name} onChangeText={setName} autoCorrect={false} />
        </View>
        <GhostButton label="Go" onPress={() => void find()} style={styles.go} />
      </View>
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {mode === 'greens' ? (
        <>
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
        </>
      ) : (
        <BoundsPanel
          lines={lines}
          draft={draft}
          holeCount={holeCount}
          onPick={pick}
          onNew={() => setDraft({ id: `map:ob-${Date.now().toString(36)}`, index: null, points: [], holes: [] })}
          onChange={setDraft}
          onToggleHole={toggleHole}
          onSave={save}
          onDelete={(d) => {
            store.setFeatures(course.id, course.features.filter((f) => f.id !== d.id));
            setDraft(null);
          }}
        />
      )}

      <GreenMap
        greens={course.greens}
        selected={mode === 'greens' ? selected : 0}
        focus={focus}
        lines={mode === 'bounds' ? lines.filter((l) => l.id !== draft?.id) : []}
        editing={mode === 'bounds' ? (draft?.points ?? null) : null}
        label={
          mode === 'greens'
            ? undefined
            : draft
              ? 'Satellite map. Tap at each stake of the out-of-bounds line, in order.'
              : 'Satellite map of the course’s out-of-bounds lines. Tap one to change it.'
        }
        onTap={(at) => {
          if (mode === 'greens') place(selected, current ? point : 'middle', at);
          else if (draft) setDraft({ ...draft, points: [...draft.points, at] });
        }}
        onDrag={(number, which, at) => place(number, which, at)}
        onPickLine={(lineId) => {
          const line = lines.find((l) => l.id === lineId);
          if (line && !draft) pick(line);
        }}
        onDragPoint={(index, at) => draft && setDraft({ ...draft, points: draft.points.map((p, i) => (i === index ? at : p)) })}
      />

      <Body style={styles.hint}>
        {mode === 'greens'
          ? `${course.greens.length} of ${holeCount} greens placed. Imagery is the map provider’s, and may be a few years old.`
          : 'Imagery is the map provider’s, and may be a few years old: the stakes on the course are what count.'}
      </Body>
    </Screen>
  );
}

/** The out-of-bounds lines, and the one being drawn or changed. */
function BoundsPanel({
  lines,
  draft,
  holeCount,
  onPick,
  onNew,
  onChange,
  onToggleHole,
  onSave,
  onDelete,
}: {
  lines: CourseFeature[];
  draft: Draft | null;
  holeCount: number;
  onPick: (line: CourseFeature) => void;
  onNew: () => void;
  onChange: (draft: Draft | null) => void;
  onToggleHole: (draft: Draft, hole: number) => void;
  onSave: (draft: Draft) => void;
  onDelete: (draft: Draft) => void;
}) {
  const styles = useStyles();
  const { colors, ink } = useTheme();
  return (
    <View style={{ gap: 12 }}>
      <Body style={styles.hint}>
        Draw each line along the white stakes. The side away from the hole is out. A hole with lines of yours no longer
        counts the course edge as out of bounds.
      </Body>
      {draft ? (
        <Card style={styles.draft}>
          <Text style={styles.name}>{draft.index == null ? 'New line' : `Line ${draft.index + 1}`}</Text>
          <Body style={styles.hint}>
            {draft.points.length < 2
              ? 'Tap the map at each stake, in order along the line.'
              : 'Tap to carry the line on, or drag a point to move it.'}
          </Body>
          <Mono size={10.5} style={{ color: ink.soft, letterSpacing: 1.2 }}>
            {`${draft.points.length} ${draft.points.length === 1 ? 'POINT' : 'POINTS'}`}
          </Mono>
          <Eyebrow>Out of bounds for</Eyebrow>
          <View style={styles.chips}>
            <Chip
              label="EVERY HOLE"
              accessibilityLabel="Every hole"
              active={draft.holes.length === 0}
              color={colors.accent}
              onPress={() => onChange({ ...draft, holes: [] })}
            />
            {Array.from({ length: holeCount }, (_, i) => i + 1).map((n) => (
              <Chip
                key={n}
                label={String(n)}
                accessibilityLabel={`Hole ${n} only`}
                active={draft.holes.includes(n)}
                color={colors.accent}
                onPress={() => onToggleHole(draft, n)}
              />
            ))}
          </View>
          <PrimaryButton label="Save the line" disabled={draft.points.length < 2} onPress={() => onSave(draft)} />
          {draft.points.length ? (
            <GhostButton label="Undo the last point" onPress={() => onChange({ ...draft, points: draft.points.slice(0, -1) })} />
          ) : null}
          {draft.index != null ? <GhostButton label="Delete the line" onPress={() => onDelete(draft)} /> : null}
          {draft.index != null && draft.id.startsWith('osm:') ? (
            <Body style={styles.hint}>
              This line came from OpenStreetMap: importing the course again brings it back if it’s deleted. To stop it
              counting, limit it to a hole it doesn’t touch.
            </Body>
          ) : null}
          <GhostButton label="Cancel" onPress={() => onChange(null)} />
        </Card>
      ) : (
        <View style={{ gap: 8 }}>
          <Eyebrow>{lines.length ? 'Lines' : 'No out-of-bounds lines yet'}</Eyebrow>
          {lines.map((line, i) => (
            <GhostButton
              key={line.id}
              label={`Line ${i + 1} · ${holesText(line.holes)}${line.source === 'osm' ? ' · from OpenStreetMap' : ''}`}
              onPress={() => onPick(line)}
            />
          ))}
          <GhostButton dashed label="Draw a new line" onPress={onNew} />
        </View>
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors, ink }) =>
  StyleSheet.create({
    find: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8 },
    go: { minWidth: 72 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: CHIP_ROW_GAP },
    hint: { color: ink.soft, lineHeight: 19 },
    message: { fontFamily: fonts.sans, fontSize: 12.5, color: colors.clay, lineHeight: 17 },
    draft: { padding: 14, gap: 10 },
    name: { fontFamily: fonts.sansSemi, fontSize: 14, color: ink.full },
  }),
);
