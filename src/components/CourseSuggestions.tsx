/**
 * Changes to someone else's course, from the course editor (#381).
 *
 * The editor edits someone else's course as a draft. This says how changes go, lists
 * the draft's changes with how each will be taken, sends or discards them, and shows
 * the golfer's own suggestions on the course with where each stands.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { courseChanges, describeChange, fillsGap } from '../domain/course-changes';
import type { Course } from '../domain/types';
import { useStore } from '../store/AppStore';
import { mySuggestions, type Suggestion } from '../sync/suggestions';
import { useTheme } from '../theme/theme';
import { Body, Card, Eyebrow, GhostButton, PrimaryButton } from './primitives';

const STATUS: Record<Suggestion['status'], string> = { waiting: 'Waiting for the admin', approved: 'Approved', declined: 'Declined' };

export function CourseSuggestions({ course }: { course: Course }) {
  const store = useStore();
  const { ink } = useTheme();
  const draft = store.courseDraft(course.id);
  // The admin's every change goes straight in (#381).
  const direct = (change: Parameters<typeof fillsGap>[0]) => store.isAdmin || fillsGap(change);
  const changes = draft ? courseChanges(course, draft) : [];
  const teeName = (id: string) => (draft ?? course).tees.find((t) => t.id === id)?.name ?? id;
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [mine, setMine] = useState<Suggestion[]>([]);

  const load = useCallback(() => {
    mySuggestions(course.id)
      .then(setMine)
      .catch(() => setMine([]));
  }, [course.id]);
  useEffect(load, [load]);

  const send = async () => {
    setSending(true);
    try {
      const result = await store.sendCourseDraft(course.id);
      const waiting = changes.length - result.applied;
      setOutcome(
        [result.applied > 0 ? `${result.applied} went straight in` : null, waiting > 0 ? `${waiting} wait for the admin` : null]
          .filter(Boolean)
          .join('; ') + '.',
      );
      load();
    } catch (error) {
      setOutcome(`Couldn’t send: ${error instanceof Error ? error.message : 'no connection'}. Your changes are kept.`);
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={{ gap: 10 }}>
      <Body style={{ color: ink.soft, lineHeight: 19 }}>
        {store.isAdmin
          ? 'Someone else added this course. As the admin, your changes go straight in. They send together, and need a connection.'
          : 'Someone else added this course. A gap you fill or a tee you add goes straight in; any other change goes to the admin as a suggestion. Your changes send together, and need a connection.'}
      </Body>

      {changes.length > 0 ? (
        <Card>
          <Eyebrow>{`${changes.length} unsent ${changes.length === 1 ? 'change' : 'changes'}`}</Eyebrow>
          {changes.map((change, i) => (
            <Body key={i} style={{ lineHeight: 19 }}>
              {`${describeChange(change, teeName)} · ${direct(change) ? 'goes straight in' : 'a suggestion'}`}
            </Body>
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <PrimaryButton label={sending ? 'Sending…' : 'Send changes'} onPress={send} disabled={sending} />
            <GhostButton label="Discard changes" onPress={() => store.discardCourseDraft(course.id)} />
          </View>
        </Card>
      ) : null}

      {outcome ? <Body accessibilityLiveRegion="polite">{outcome}</Body> : null}

      {mine.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Eyebrow>Your suggestions</Eyebrow>
          {mine.map((s) => (
            <Card key={s.id}>
              <Body>{STATUS[s.status]}</Body>
              {s.changes.map((change, i) => (
                <Body key={i} style={{ color: ink.soft, lineHeight: 19 }}>
                  {describeChange(change, teeName)}
                </Body>
              ))}
              {s.status === 'declined' && s.reason ? <Body>{`Reason: ${s.reason}`}</Body> : null}
            </Card>
          ))}
        </View>
      ) : null}
    </View>
  );
}
