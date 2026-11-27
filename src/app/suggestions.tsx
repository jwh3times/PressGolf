/**
 * The admin's review of suggested course changes (#381).
 *
 * Every suggestion waiting, oldest first, each as its changes from what to what.
 * Approving applies one whole, or reports the value that changed since it was made;
 * declining takes a one-line reason the golfer sees. Only the admin reaches it: the
 * link is theirs alone, and the server refuses anyone else.
 */
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { Field } from '../components/Field';
import { ModalHeader, Screen } from '../components/Screen';
import { Body, Card, Eyebrow, GhostButton, PrimaryButton } from '../components/primitives';
import { describeChange } from '../domain/course-changes';
import { useStore } from '../store/AppStore';
import { approveSuggestion, declineSuggestion, waitingSuggestions, type Suggestion } from '../sync/suggestions';
import { useTheme } from '../theme/theme';

export default function SuggestionsScreen() {
  const store = useStore();
  const router = useRouter();
  const { ink } = useTheme();
  const [waiting, setWaiting] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    waitingSuggestions()
      .then((list) => {
        setWaiting(list);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not reach the server.'));
  }, []);
  useEffect(() => {
    if (store.isAdmin) load();
  }, [store.isAdmin, load]);

  if (!store.isAdmin) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="Course suggestions" onClose={() => router.back()} closeLabel="Back" />
        <Body>Only the admin reviews suggested changes.</Body>
      </Screen>
    );
  }

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader
        eyebrow={waiting ? `${waiting.length} waiting` : undefined}
        title="Course suggestions"
        onClose={() => router.back()}
        closeLabel="Back"
      />
      {error ? <Body accessibilityLiveRegion="polite">{`Couldn’t load them: ${error}`}</Body> : null}
      {waiting && waiting.length === 0 ? <Body style={{ color: ink.soft }}>Nothing is waiting.</Body> : null}
      {(waiting ?? []).map((suggestion) => (
        <Review key={suggestion.id} suggestion={suggestion} onDone={load} />
      ))}
    </Screen>
  );
}

function Review({ suggestion, onDone }: { suggestion: Suggestion; onDone: () => void }) {
  const store = useStore();
  const { ink } = useTheme();
  const course = store.courses.find((c) => c.id === suggestion.courseId);
  const teeName = (id: string) => course?.tees.find((t) => t.id === id)?.name ?? id;
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(suggestion.conflict);

  const act = async (run: () => Promise<string | null>) => {
    setBusy(true);
    try {
      setNote(await run());
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <Eyebrow>{course?.name ?? 'A course not on this phone'}</Eyebrow>
      {suggestion.changes.map((change, i) => (
        <Body key={i} style={{ lineHeight: 19 }}>
          {describeChange(change, teeName)}
        </Body>
      ))}
      {note ? <Body style={{ color: ink.soft }} accessibilityLiveRegion="polite">{note}</Body> : null}
      <Field label="Reason, to decline" value={reason} onChangeText={setReason} maxLength={200} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
        <PrimaryButton
          label="Approve"
          disabled={busy}
          onPress={() =>
            act(async () => {
              const status = await approveSuggestion(suggestion.id);
              if (status === 'approved') {
                onDone();
                return null;
              }
              // The server keeps the conflict on the suggestion; read it back.
              onDone();
              return 'A value it replaces has changed since. It keeps waiting.';
            })
          }
        />
        <GhostButton
          label="Decline"
          onPress={() => {
            if (busy) return;
            if (!reason.trim()) {
              setNote('Give a reason to decline: the golfer sees it.');
              return;
            }
            void act(async () => {
              await declineSuggestion(suggestion.id, reason.trim());
              onDone();
              return null;
            });
          }}
        />
      </View>
    </Card>
  );
}
