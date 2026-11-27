import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
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

  const find = async () => {
    setMessage(null);
    try {
      const [match] = await findCourses(name);
      if (match?.center) setFocus({ ...match.center });
      else setMessage('OpenStreetMap doesn’t know a golf course by that name. Move the map to it instead.');
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Couldn’t search. Move the map to the course instead.');
    }
  };

  // Once, on the way in, unless the course already has a place to start from.
  useEffect(() => {
    if (name && !draft?.location) void find();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      {name ? <GhostButton label={`Find ${name} on the map`} onPress={() => void find()} /> : null}
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
