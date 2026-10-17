import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { usualScoreFor } from '../domain/bag';
import {
  aimPhrase,
  asSentence,
  secondLine,
  suggestShot,
  suggestionLine,
  type ClubSuggestion,
  type Lie,
} from '../domain/club-suggestion';
import { metresBetween } from '../domain/geo';
import type { Course, LatLng, TeeId, UsualScore } from '../domain/types';
import { useStore } from '../store/AppStore';
import { makeStyles } from '../theme/theme';
import { fonts, radius } from '../theme/tokens';
import { Body, Chip, CHIP_ROW_GAP, Eyebrow } from './primitives';

/**
 * Club suggestions on screen (#146): the Score screen's line and the hole
 * map's card. Club advice, so only shown where `useAdvice` allows it: outside
 * a round, or in a practice round.
 */

const YARD = 0.9144;
/** A suggestion holds until the player has moved this far, so GPS drift doesn't flicker it. */
const STEADY_M = 5 * YARD;
/** Spots are squares this size: one seed, and one lie the player picked, for each. */
const SQUARE_M = 5 * YARD;
const METRES_PER_DEGREE = 111_320;

// ─── The lie a player picked, by spot, shared between screens ───────────────

const picked = new Map<string, Lie>();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
function pickLie(key: string, lie: Lie) {
  picked.set(key, lie);
  listeners.forEach((l) => l());
}

/** A point that moves only when `point` has moved more than a few yards from it. */
function useSteady(point: LatLng | null): LatLng | null {
  const [held, setHeld] = useState(point);
  const moved = point == null ? held != null : held == null || metresBetween(point, held) > STEADY_M;
  if (moved) setHeld(point);
  return moved ? point : held;
}

/** The square a point is in, as a key. */
function squareOf(p: LatLng): string {
  const i = Math.round((p.lat * METRES_PER_DEGREE) / SQUARE_M);
  const j = Math.round((p.lng * METRES_PER_DEGREE * Math.cos((p.lat * Math.PI) / 180)) / SQUARE_M);
  return `${i},${j}`;
}

/** FNV-1a, for a seed from a spot's key. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

export interface Suggestion {
  result: ClubSuggestion;
  usualScore: UsualScore;
  setLie: (lie: Lie) => void;
}

interface SuggestionFor {
  course: Course | undefined;
  hole: number;
  teeId: TeeId | null | undefined;
  /** Where the shot is from; the tee when null. */
  from: LatLng | null;
  /** False where club advice isn't allowed, or there's nothing to suggest on. */
  enabled?: boolean;
}

/** The suggestion for the shot from `from`, from this phone's bag; null when not enabled. */
export function useClubSuggestion({ course, hole, teeId, from, enabled = true }: SuggestionFor): Suggestion | null {
  const store = useStore();
  const usualScore = usualScoreFor(store.usualScore, store.groups).score;
  const spot = useSteady(from);
  const key = `${course?.id}:${hole}:${spot ? squareOf(spot) : 'tee'}`;
  const lie = useSyncExternalStore(subscribe, () => picked.get(key), () => picked.get(key));
  const result = useMemo(
    () =>
      enabled && course
        ? suggestShot({ course, hole, teeId, from: spot, lie, bag: store.clubs, usualScore, seed: hash(key) })
        : null,
    [enabled, course, hole, teeId, spot, lie, store.clubs, usualScore, key],
  );
  return result ? { result, usualScore, setLie: (l) => pickLie(key, l) } : null;
}

/**
 * The suggestion from the tee, worked out after the first paint rather than
 * during it: the course guide asks for every hole at once, and each takes a
 * moment on a phone.
 */
export function useTeeSuggestion({ course, hole, teeId, enabled = true }: Omit<SuggestionFor, 'from'>): ClubSuggestion | null {
  const store = useStore();
  const usualScore = usualScoreFor(store.usualScore, store.groups).score;
  const key = `${course?.id}:${hole}:tee`;
  const lie = useSyncExternalStore(subscribe, () => picked.get(key), () => picked.get(key));
  // Too few carries for a suggestion, and the guide says nothing of clubs: no need to work it out.
  const enough = store.clubs.filter((c) => c.carry != null).length >= 3;
  const inputs = useMemo(
    () => (enabled && course && enough ? { course, hole, teeId, from: null, lie, bag: store.clubs, usualScore, seed: hash(key) } : null),
    [enabled, enough, course, hole, teeId, lie, store.clubs, usualScore, key],
  );
  // The answer, and the inputs it answers: a stale one is never shown.
  const [done, setDone] = useState<{ inputs: object; result: ClubSuggestion } | null>(null);
  useEffect(() => {
    if (!inputs) return;
    const timer = setTimeout(() => setDone({ inputs, result: suggestShot(inputs) }), 0);
    return () => clearTimeout(timer);
  }, [inputs]);
  return inputs && done?.inputs === inputs ? done.result : null;
}

/** The Score screen's lines: the club and aim, and a second option. A tap opens the hole map. */
export function ClubSuggestionLine({ suggestion, onOpen }: { suggestion: Suggestion; onOpen: () => void }) {
  const styles = useStyles();
  const line = suggestionLine(suggestion.result);
  if (!line) return null;
  const second = secondLine(suggestion.result);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Club suggestion: ${line}.${second ? ` ${asSentence(second)}` : ''}`}
      accessibilityHint="Opens the hole map, which explains it"
      onPress={onOpen}
      style={({ pressed }) => [styles.line, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.club}>{line}</Text>
      {second ? <Body style={styles.copy}>{second}</Body> : null}
    </Pressable>
  );
}

const LIES: { lie: Lie; name: string }[] = [
  { lie: 'tee', name: 'Tee' },
  { lie: 'fairway', name: 'Fairway' },
  { lie: 'rough', name: 'Rough' },
  { lie: 'sand', name: 'Sand' },
];
const SHOOTS: Record<UsualScore, string> = { '70s': 'in the 70s', '80s': 'in the 80s', '90s': 'in the 90s', '100s': '100 or more' };

/** The hole map's card: the suggestion, what it rests on, the lie, and what the map leaves out. */
export function ClubSuggestionCard({
  suggestion,
  planning,
  located,
  onBack,
}: {
  suggestion: Suggestion;
  /** Planning from a point the player tapped, not where they are. */
  planning: boolean;
  /** The phone knows where the player is on the hole; otherwise suggestions are from the tee. */
  located: boolean;
  onBack: () => void;
}) {
  const styles = useStyles();
  const [choosing, setChoosing] = useState(false);
  const { result, usualScore, setLie } = suggestion;
  const best = result.best;
  const lieName = LIES.find((l) => l.lie === result.lie)!.name;
  const shows = result.status === 'suggested' || result.status === 'partial';

  return (
    <View style={styles.card}>
      <Eyebrow>Club suggestion</Eyebrow>
      {/* Where it is from shows above the map; only planning from a tapped point needs saying here. */}
      {planning ? (
        <View style={styles.heading}>
          <Body style={styles.copy}>From the point you tapped.</Body>
          <Chip label="BACK TO WHERE I AM" accessibilityLabel={located ? 'Plan from where I am again' : 'Plan from the tee again'} onPress={onBack} />
        </View>
      ) : null}

      {best ? (
        <View style={{ gap: 4 }}>
          <Text style={styles.club}>{best.club}</Text>
          <Body style={styles.copy}>{aimPhrase(best.aim)}</Body>
          {best.odds ? <Body style={styles.copy}>{asSentence(best.odds)}</Body> : null}
          {result.second ? <Body style={styles.copy}>{asSentence(secondLine(result))}</Body> : null}
        </View>
      ) : (
        <Body style={styles.copy}>
          {result.status === 'onGreen'
            ? 'On the green: no club to suggest.'
            : result.status === 'noTee'
              ? 'Measure from where you are for a suggestion: the map has no tee for this hole.'
              : asSentence(suggestionLine(result))}
        </Body>
      )}
      {result.missing ? <Body style={styles.copy}>{`Add your ${result.missing}’s carry for a fuller suggestion.`}</Body> : null}

      {shows ? (
        <View style={{ gap: 8 }}>
          <View style={styles.chips}>
            <Chip
              label={`LIE: ${lieName.toUpperCase()} ${choosing ? '▴' : '▾'}`}
              accessibilityLabel={`Lie: ${lieName}${result.liePicked ? '' : ', read from the map'}. Change it`}
              onPress={() => setChoosing((now) => !now)}
            />
          </View>
          {choosing ? (
            <View accessibilityRole="radiogroup" accessibilityLabel="Lie" style={styles.chips}>
              {LIES.map((l) => (
                <Chip
                  key={l.lie}
                  radio
                  label={l.name.toUpperCase()}
                  accessibilityLabel={l.name}
                  active={l.lie === result.lie}
                  onPress={() => {
                    setLie(l.lie);
                    setChoosing(false);
                  }}
                />
              ))}
            </View>
          ) : null}
        </View>
      ) : null}

      {shows ? (
        <Body style={styles.copy}>
          {`Based on published shot patterns for golfers who usually shoot ${SHOOTS[usualScore]}, and your bag’s carries.`}
        </Body>
      ) : null}
      <Body style={styles.copy}>
        {result.caveats.includes('littleMapped')
          ? 'Little of this hole is mapped, so suggestions are rough.'
          : 'Trees aren’t on the map.'}
      </Body>
    </View>
  );
}

const useStyles = makeStyles(({ colors, ink, line }) =>
  StyleSheet.create({
    line: { gap: 2, minHeight: 44, justifyContent: 'center' },
    card: {
      backgroundColor: colors.cardDeep,
      borderWidth: 1,
      borderColor: line.card,
      borderRadius: radius.card,
      padding: 14,
      gap: 10,
    },
    heading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: 12 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8, rowGap: CHIP_ROW_GAP },
    club: { fontFamily: fonts.sansSemi, fontSize: 15, color: ink.full },
    copy: { color: ink.soft, lineHeight: 19 },
    quiet: { color: ink.soft, letterSpacing: 1.2 },
  }),
);

/** The Score screen's suggestion for one hole: keyed by hole, so each starts from its tee. */
export function ScoreClubSuggestion({
  course,
  hole,
  teeId,
  from,
  onOpen,
}: {
  course: Course;
  hole: number;
  teeId: TeeId;
  from: LatLng | null;
  onOpen: () => void;
}) {
  const suggestion = useClubSuggestion({ course, hole, teeId, from });
  return suggestion ? <ClubSuggestionLine suggestion={suggestion} onOpen={onOpen} /> : null;
}
