import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTeeSuggestion } from '../components/ClubSuggestion';
import { HoleDiagram } from '../components/HoleDiagram';
import { PracticeSwitch, useAdvice } from '../components/PracticeRound';
import { ModalHeader, Screen } from '../components/Screen';
import { Body, Mono } from '../components/primitives';
import { holePlan } from '../domain/hole-map';
import { noteFor } from '../domain/course-map';
import { teeLine } from '../domain/club-suggestion';
import { aimSentence, facingZone, holeStrategy, withoutAim, zoneSummary } from '../domain/hole-strategy';
import type { Course, Hole, TeeId } from '../domain/types';
import { useStore } from '../store/AppStore';
import { makeStyles } from '../theme/theme';
import { fonts, radius } from '../theme/tokens';

/** Short enough that a screen holds two or three holes; tall enough to read each one's shape. */
const DRAWING_HEIGHT = 96;

/**
 * Every hole on one page (#136): its drawing, par and yards, and how it plays,
 * to look a course over before the round; where advice is allowed, the club
 * to hit from the tee (#146). A tap opens the hole's map.
 */
export default function CourseGuideScreen() {
  const params = useLocalSearchParams<{ course: string; tee?: string; round?: string }>();
  const store = useStore();
  const router = useRouter();
  const styles = useStyles();
  const course = store.courses.find((c) => c.id === params.course);
  const { advice, practice } = useAdvice(params.round);

  if (!course) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="Course not found" onClose={() => router.back()} closeLabel="Back" />
      </Screen>
    );
  }

  const tee = course.tees.find((t) => t.id === params.tee) ?? course.tees[0];
  return (
    <Screen floatingTabBar={false}>
      <ModalHeader eyebrow={course.name} title="Course guide" onClose={() => router.back()} closeLabel="Back" />
      <Body style={styles.copy}>
        {`How each hole plays from the ${tee.name} tee, read from the course map. Tap a hole for its map and distances.`}
      </Body>
      {params.round ? <PracticeSwitch on={practice === true} onChange={(on) => store.setPractice(params.round!, on)} /> : null}
      {tee.holes.map((hole) => (
        <GuideHole
          key={hole.number}
          course={course}
          hole={hole}
          teeId={tee.id}
          advice={advice}
          onOpen={() =>
            router.push({
              pathname: '/hole-map',
              params: { course: course.id, hole: String(hole.number), tee: tee.id, ...(params.round ? { round: params.round } : {}) },
            })
          }
        />
      ))}
    </Screen>
  );
}

function GuideHole({
  course,
  hole,
  teeId,
  advice,
  onOpen,
}: {
  course: Course;
  hole: Hole;
  teeId: TeeId;
  advice: boolean;
  onOpen: () => void;
}) {
  const styles = useStyles();
  const plan = useMemo(() => holePlan(course, hole.number), [course, hole.number]);
  const advised = useMemo(() => holeStrategy(course, hole.number, { teeId, advice }), [course, hole.number, teeId, advice]);
  const tee = useTeeSuggestion({ course, hole: hole.number, teeId, enabled: advice && plan.green != null });
  const fromTee = tee ? teeLine(tee) : null;
  // The tee shot's club and aim stand in for the hole strategy's aim on it: one aim, never two.
  const teeZone = fromTee ? facingZone(course, hole.number, null, null, { teeId }) : null;
  const strategy = advised && teeZone ? withoutAim(advised, teeZone) : advised;
  const lines = strategy
    ? strategy.zones.flatMap((z) => [
        zoneSummary(z),
        ...(z.zone === teeZone && fromTee ? [fromTee] : z.aim ? [`Aim: ${aimSentence(z.zone, z.aim)}`] : []),
      ])
    : [plan.line || plan.green ? 'Too little mapped to say how it plays' : 'Not mapped yet', ...(fromTee ? [fromTee] : [])];
  const note = noteFor(course.notes, hole.number);
  if (note) lines.push(`Note: ${note}`);
  const meta = `PAR ${hole.par}${hole.yards ? ` · ${hole.yards} YARDS` : ''}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Hole ${hole.number}, par ${hole.par}${hole.yards ? `, ${hole.yards} yards` : ''}. ${lines.map((l) => (l.endsWith('.') ? l : `${l}.`)).join(' ')}`}
      accessibilityHint="Opens the hole map"
      onPress={onOpen}
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
    >
      {plan.line || plan.green ? <HoleDiagram plan={plan} from={null} target={null} height={DRAWING_HEIGHT} across /> : null}
      <View style={styles.text}>
        <View style={styles.heading}>
          <Text style={styles.name}>{`Hole ${hole.number}`}</Text>
          <Mono size={10.5} style={styles.quiet}>
            {meta}
          </Mono>
        </View>
        {lines.map((line, i) => (
          // Two zones can read alike, so not keyed by their words.
          <Body key={i} style={styles.copy}>
            {line}
          </Body>
        ))}
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors, ink, line }) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.cardDeep,
      borderWidth: 1,
      borderColor: line.card,
      borderRadius: radius.card,
      overflow: 'hidden',
    },
    text: { padding: 14, gap: 4 },
    heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 12 },
    name: { fontFamily: fonts.sansSemi, fontSize: 14, color: ink.full },
    copy: { color: ink.soft, lineHeight: 19 },
    quiet: { color: ink.soft, letterSpacing: 1.2 },
  }),
);
