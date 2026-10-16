import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { MAX_NOTE } from '../domain/course-map';
import { makeStyles } from '../theme/theme';
import { Field } from './Field';
import { Body, Card, Eyebrow, GhostButton, PrimaryButton } from './primitives';

/**
 * The course owner's note on a hole (#136), and where they write it. Written
 * before the round, like a yardage book, so it shows in a counted one too.
 * Guests of a shared outing read the owner's; the server keeps it the owner's
 * to change.
 */
export function HoleNoteCard({ hole, note, onSave }: { hole: number; note: string | null; onSave: (text: string) => void }) {
  const styles = useStyles();
  const [draft, setDraft] = useState<string | null>(null);

  if (draft != null) {
    return (
      <View style={{ gap: 8 }}>
        <Eyebrow>Note on this hole</Eyebrow>
        <Card style={styles.card}>
          <Field
            label={`Note on hole ${hole}`}
            hint={`${draft.length} of ${MAX_NOTE} characters. Everyone you share the course with sees it.`}
            placeholder="Blind tee shot, aim at the steeple."
            value={draft}
            maxLength={MAX_NOTE}
            multiline
            onChangeText={setDraft}
            style={{ minHeight: 88, textAlignVertical: 'top' }}
          />
          <PrimaryButton
            label={draft.trim() ? 'Save the note' : note ? 'Remove the note' : 'Save the note'}
            disabled={!draft.trim() && !note}
            onPress={() => {
              onSave(draft);
              setDraft(null);
            }}
          />
          <GhostButton label="Cancel" onPress={() => setDraft(null)} />
        </Card>
      </View>
    );
  }

  return note ? (
    <View style={{ gap: 8 }}>
      <Eyebrow>Note on this hole</Eyebrow>
      <Card style={styles.card}>
        <Body style={styles.note}>{note}</Body>
        <GhostButton label="Edit the note" onPress={() => setDraft(note)} />
      </Card>
    </View>
  ) : (
    <GhostButton dashed label="Add a note on this hole" onPress={() => setDraft('')} />
  );
}

const useStyles = makeStyles(({ ink }) =>
  StyleSheet.create({
    card: { padding: 14, gap: 12 },
    note: { color: ink.full, lineHeight: 21 },
  }),
);
