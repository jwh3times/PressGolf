import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { View } from 'react-native';
import { canSave, describePlace, SOURCE_NAMES, stillNeeded, type CourseDraft, type CourseSource } from '../domain/course-draft';
import { positionHere } from '../hooks/position';
import { useStore } from '../store/AppStore';
import { alpha } from '../theme/color';
import { useTheme } from '../theme/theme';
import { Body, Card, Eyebrow, GhostButton, PrimaryButton } from './primitives';

/** "To save it, give it a name, name every tee and say where it is." */
function saveHint(needs: string[]): string {
  const list = needs.length > 1 ? `${needs.slice(0, -1).join(', ')} and ${needs[needs.length - 1]}` : needs[0];
  return `To save it, ${list}.`;
}

/** The sources a draft's marks name, in the order they first appear. */
const sourcesOf = (draft: CourseDraft): CourseSource[] => [...new Set(Object.values(draft.marks))];

/**
 * The top of a new course in the editor (#383): it isn't saved, and nothing of it is
 * in the course library yet. With values a source filled, how many, and a way to say
 * they're right.
 */
export function NewCourseBanner({ draft }: { draft: CourseDraft }) {
  const { colors, ink } = useTheme();
  const store = useStore();
  const count = Object.keys(draft.marks).length;
  const from = sourcesOf(draft).map((source) => SOURCE_NAMES[source]).join(' and ');
  return (
    <Card style={{ padding: 14, gap: 10, borderColor: alpha(colors.gold, 0.45) }}>
      <Body style={{ color: ink.body, lineHeight: 19 }}>
        Not saved yet. Nothing of this course reaches the course library until you save it.
      </Body>
      {count > 0 ? (
        <>
          <Body style={{ color: ink.soft, lineHeight: 19 }}>
            {count === 1 ? '1 value came' : `${count} values came`} from {from}, each marked with a gold dot or a note.
            Check them against the card: one you change counts as checked, and saving counts as checking the rest.
          </Body>
          <GhostButton label="They’re all right" onPress={store.confirmNewCourse} />
        </>
      ) : null}
    </Card>
  );
}

/**
 * The bottom of a new course in the editor: where it is, and saving it. A new course
 * needs a location, so two courses with one name can be told apart: where the golfer
 * is standing, or a pick on the map.
 */
export function NewCourseSave({ draft }: { draft: CourseDraft }) {
  const { ink } = useTheme();
  const store = useStore();
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const course = draft.course;

  const here = async () => {
    setMessage(null);
    try {
      const at = await positionHere();
      if (at) store.updateCourse(course.id, { location: at });
      else setMessage('Location is off for Press. Pick the course on the map instead.');
    } catch {
      setMessage('Couldn’t tell where you are. Pick the course on the map instead.');
    }
  };

  const save = () => {
    if (store.saveNewCourse()) router.back();
  };

  return (
    <View style={{ gap: 10 }}>
      <Eyebrow>Where it is</Eyebrow>
      <Body style={{ color: ink.soft, lineHeight: 19 }}>
        {describePlace(course.location)} A new course needs one, so golfers can tell it from another of the same
        name.
      </Body>
      <GhostButton label="Use where I’m standing" onPress={() => void here()} />
      <GhostButton label="Pick it on a map" onPress={() => router.push({ pathname: '/course-location', params: { id: course.id } })} />
      {message ? <Body style={{ color: ink.soft, lineHeight: 19 }} accessibilityLiveRegion="polite">{message}</Body> : null}
      <PrimaryButton label="Save the course" disabled={!canSave(draft)} onPress={save} />
      {canSave(draft) ? null : <Body style={{ color: ink.quiet, lineHeight: 18 }}>{saveHint(stillNeeded(draft))}</Body>}
    </View>
  );
}
