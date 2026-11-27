import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { makeCourse } from '../domain/factory';
import type { LatLng } from '../domain/types';
import { roughPosition } from '../hooks/position';
import { useStore } from '../store/AppStore';
import { fetchLibraryCourse, searchLibrary, SEARCH_MIN, type LibraryMatch } from '../sync/library';
import { makeStyles, useTheme } from '../theme/theme';
import { fonts, radius } from '../theme/tokens';
import { Field } from './Field';
import { Body, Card, Chip, Eyebrow, Mono, PrimaryButton } from './primitives';
import { CAN_SCAN, ScanScorecard } from './ScanScorecard';

/** Long enough that a name typed at speed is one search. */
export const SEARCH_DELAY_MS = 400;

/** What the golfer can do when the library hasn't the course: scan it on a phone, type it in anywhere. */
const OFFER = CAN_SCAN ? 'Scan its scorecard or type it in' : 'Type it in';

/** How far away a library match is, in miles; empty when nobody knows. */
export function describeDistance(km: number | null): string {
  if (km == null) return '';
  const miles = km * 0.621371;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

/** What one search found, kept against the name it was for. */
interface Found {
  term: string;
  matches: LibraryMatch[];
}

interface Failed {
  term: string;
  message: string;
}

const describeError = (error: unknown) => (error instanceof Error ? error.message : 'Couldn’t reach the course library.');

/**
 * Creating a course, starting from the course library (#383): the golfer types a name
 * and sees the courses already in Press, nearest first when location is allowed, each
 * with its distance and tees. A match goes on their list with one tap. Not there, they
 * type it in, as a draft course nothing in the library sees until it's saved.
 */
export function LibrarySearch() {
  const styles = useStyles();
  const { ink } = useTheme();
  const store = useStore();
  const router = useRouter();
  const [name, setName] = useState('');
  const [holeCount, setHoleCount] = useState<9 | 18>(18);
  const [found, setFound] = useState<Found | null>(null);
  const [failed, setFailed] = useState<Failed | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  // Asked once a screen, at the first search; null when location is refused.
  const position = useRef<Promise<LatLng | null> | null>(null);
  const term = name.trim();
  // Only what was found for the name as it is now: a result for an older name is stale.
  const shown = found?.term === term ? found : null;
  const problem = failed?.term === term ? failed.message : null;

  useEffect(() => {
    if (term.length < SEARCH_MIN) return;
    let live = true;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          position.current ??= roughPosition();
          const matches = await searchLibrary(term, await position.current);
          if (live) setFound({ term, matches });
        } catch (error) {
          if (live) setFailed({ term, message: describeError(error) });
        }
      })();
    }, SEARCH_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term]);

  const add = async (match: LibraryMatch) => {
    setAdding(match.id);
    try {
      const course = await fetchLibraryCourse(match.id);
      if (course) store.addLibraryCourse(course);
      else setFailed({ term, message: `${match.name} has gone from the library.` });
    } catch (error) {
      setFailed({ term, message: describeError(error) });
    } finally {
      setAdding(null);
    }
  };

  const typeItIn = () => {
    const course = makeCourse(term, holeCount);
    store.startNewCourse(course);
    router.push(`/course/${course.id}`);
  };

  return (
    <View style={{ gap: 12 }}>
      <Eyebrow>Add a course</Eyebrow>
      <Field
        label="Course name"
        placeholder="Pine Hollow"
        value={name}
        onChangeText={setName}
        hint="Press looks for it among the courses golfers have already set up."
      />
      {problem ? (
        <Body style={{ color: ink.soft, lineHeight: 19 }} accessibilityLiveRegion="polite">
          {problem}
        </Body>
      ) : null}
      {term.length >= SEARCH_MIN && !shown && !problem ? <Body style={{ color: ink.quiet }}>Looking…</Body> : null}

      {shown?.matches.map((match) => {
        const held = store.myCourses.some((c) => c.id === match.id);
        const meta = [describeDistance(match.km), match.tees.length ? match.tees.join(', ') : 'No tees yet'].filter(Boolean);
        return (
          <View key={match.id} style={styles.row}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.name}>{match.name}</Text>
              <Text style={styles.meta}>{meta.join(' · ')}</Text>
            </View>
            {held ? (
              <Mono size={11} style={{ color: ink.quiet }}>
                ON YOUR LIST
              </Mono>
            ) : (
              <Chip
                label={adding === match.id ? 'Adding…' : 'Add'}
                // Two courses can share a name: the distance and tees tell them apart.
                accessibilityLabel={`${adding === match.id ? 'Adding' : 'Add'} ${match.name}, ${meta.join(', ')}`}
                disabled={adding !== null}
                onPress={() => void add(match)}
              />
            )}
          </View>
        );
      })}

      {/* After a search, or one that failed: no signal mustn't leave the golfer without a course. */}
      {shown || (problem && term.length >= SEARCH_MIN) ? (
        <Card style={{ padding: 14, gap: 12 }}>
          <Body style={{ color: ink.soft, lineHeight: 19 }}>
            {!shown
              ? 'Or type it in.'
              : shown.matches.length === 0
                ? `No course called “${term}” in Press yet. ${OFFER}, and it’s there for the next golfer.`
                : `Not one of these? ${OFFER}.`}
          </Body>
          <ScanScorecard name={term} />
          <HoleCountPicker value={holeCount} onChange={setHoleCount} />
          <PrimaryButton label="Type it in" onPress={typeItIn} />
        </Card>
      ) : null}
    </View>
  );
}

/** 18 holes or 9, for a course being typed in. */
export function HoleCountPicker({ value, onChange }: { value: 9 | 18; onChange: (count: 9 | 18) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 8 }}>
      {([18, 9] as const).map((count) => (
        <Pressable
          key={count}
          accessibilityRole="button"
          accessibilityState={{ selected: value === count }}
          onPress={() => onChange(count)}
          style={[styles.toggle, value === count ? styles.toggleOn : null]}
        >
          <Text style={[styles.toggleText, value === count ? { color: colors.screen } : null]}>{count} holes</Text>
        </Pressable>
      ))}
    </View>
  );
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
      paddingVertical: 12,
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
  }),
);
