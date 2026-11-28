import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useEffectEvent, useState } from 'react';
import { View } from 'react-native';
import { PlaceMap } from '../components/PlaceMap';
import { ModalHeader, Screen } from '../components/Screen';
import { Body, GhostButton, PrimaryButton } from '../components/primitives';
import { describePlace } from '../domain/course-draft';
import type { LatLng } from '../domain/types';
import { findCourses } from '../osm/client';
import { useStore } from '../store/AppStore';
import { useTheme } from '../theme/theme';

/**
 * Where a new course is (#383), picked on a map by a golfer who isn't there. The map
 * starts on the course OpenStreetMap knows by the draft's name, if it knows one.
 */
export default function CourseLocationScreen() {
  const { ink } = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const router = useRouter();
  const draft = store.newCourse?.course.id === id ? store.newCourse.course : null;
  const [focus, setFocus] = useState<LatLng | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const name = draft?.name.trim() ?? '';

  // Every update lands when the search settles, never while it starts.
  const search = () =>
    Promise.resolve()
      .then(() => findCourses(name))
      .then(
        ([match]) => {
          if (match?.center) setFocus({ ...match.center });
          else setMessage('OpenStreetMap doesn’t know a golf course by that name. Move the map to it instead.');
        },
        (e: unknown) => {
          setMessage(e instanceof Error ? e.message : 'Couldn’t search. Move the map to the course instead.');
        },
      );
  // Asked again: clear the last search's message first.
  const find = () => {
    setMessage(null);
    void search();
  };

  // Once, on the way in, unless the course already has a place to start from.
  // An effect event reads the draft as it is then, without re-running on edits,
  // and there is no message yet to clear.
  const findOnEntry = useEffectEvent(() => {
    if (name && !draft?.location) void search();
  });
  useEffect(() => {
    findOnEntry();
  }, []);

  if (!draft) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="Course not found" onClose={() => router.back()} closeLabel="Back" />
      </Screen>
    );
  }

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader eyebrow={draft.name} title="Where it is" onClose={() => router.back()} closeLabel="Back" />
      <Body style={{ color: ink.soft, lineHeight: 19 }}>
        Tap the clubhouse, or anywhere on the course. Drag the pin to move it.
      </Body>
      {name ? <GhostButton label={`Find ${name} on the map`} onPress={find} /> : null}
      {message ? <Body style={{ color: ink.soft, lineHeight: 19 }} accessibilityLiveRegion="polite">{message}</Body> : null}
      <PlaceMap
        at={draft.location ?? null}
        focus={focus}
        onPlace={(at) => store.updateCourse(draft.id, { location: at })}
      />
      <View style={{ gap: 8 }}>
        <Body style={{ color: ink.soft }}>{describePlace(draft.location)}</Body>
        <PrimaryButton label="Done" disabled={!draft.location} onPress={() => router.back()} />
      </View>
    </Screen>
  );
}
