import DateTimePicker from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { ModalHeader, Screen } from '../components/Screen';
import {
  Avatar,
  Body,
  Card,
  Chip,
  EmptyState,
  Eyebrow,
  GhostButton,
  Mono,
  PrimaryButton,
} from '../components/primitives';
import { lastUsedTee, makeRound } from '../domain/factory';
import type { PlayerId } from '../domain/types';
import { useStore } from '../store/AppStore';
import { colors, fonts, ink, line, radius } from '../theme/tokens';

export default function NewRoundScreen() {
  const store = useStore();
  const router = useRouter();
  const group = store.group;
  // A finished paper card goes in beside the live round, dated the day it was played.
  const cardMode = useLocalSearchParams<{ mode?: string }>().mode === 'card';
  // Read the clock once, not on every render: the picker's latest allowed date.
  const [openedAt] = useState(() => new Date());
  const [playedOn, setPlayedOn] = useState(() => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    return today;
  });
  const [pickingDate, setPickingDate] = useState(false);
  // Null follows the course: the tee this group last played there.
  const [chosenTee, setChosenTee] = useState<string | null>(null);

  const [courseId, setCourseId] = useState<string | null>(
    group?.defaultCourseId ?? store.courses[0]?.id ?? null,
  );
  const [selected, setSelected] = useState<PlayerId[]>(group?.players.map((p) => p.id) ?? []);

  if (!group) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="New round" onClose={() => router.back()} />
        <EmptyState
          title="No group yet"
          body="Create a group and add players first."
          action={<PrimaryButton label="Set up a group" onPress={() => router.replace('/roster')} />}
        />
      </Screen>
    );
  }

  const activeRound = store.rounds.find((r) => r.id === store.activeRoundId && r.status === 'active');
  const course = store.courses.find((c) => c.id === courseId) ?? null;
  const teeId =
    course && chosenTee && course.tees.some((t) => t.id === chosenTee)
      ? chosenTee
      : course
        ? lastUsedTee(store.rounds, group.id, course)
        : null;
  const canStart = course != null && selected.length >= 2;

  const toggle = (id: PlayerId) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const start = () => {
    if (!course) return;
    // Keep tee order as the group's roster order, not the order of tapping.
    const ordered = group.players.filter((p) => selected.includes(p.id)).map((p) => p.id);
    if (cardMode) {
      store.startCard(makeRound(group, course, ordered, { entry: 'card', playedOn: playedOn.getTime(), teeId }));
    } else {
      store.startRound(makeRound(group, course, ordered, { teeId }));
    }
    router.replace('/format');
  };

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader
        eyebrow={group.name}
        title={cardMode ? 'Enter a finished card' : 'New round'}
        onClose={() => router.back()}
      />

      {cardMode ? (
        <View style={{ gap: 10 }}>
          <Eyebrow>Played on</Eyebrow>
          <Card style={{ padding: 14, gap: 10 }}>
            <Text style={styles.name}>
              {playedOn.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
            {Platform.OS === 'android' && !pickingDate ? (
              <GhostButton label="Change the date" onPress={() => setPickingDate(true)} />
            ) : null}
            {Platform.OS === 'ios' || pickingDate ? (
              <DateTimePicker
                value={playedOn}
                mode="date"
                display={Platform.OS === 'ios' ? 'compact' : 'default'}
                maximumDate={openedAt}
                onChange={(event, date) => {
                  setPickingDate(false);
                  if (event.type === 'set' && date) {
                    const noon = new Date(date);
                    noon.setHours(12, 0, 0, 0);
                    setPlayedOn(noon);
                  }
                }}
              />
            ) : null}
            <Body style={{ color: ink.soft, lineHeight: 18 }}>
              Any round that is going stays as it is. The card lands in History once it is saved.
            </Body>
          </Card>
        </View>
      ) : null}

      {activeRound && !cardMode ? (
        <Card style={styles.notice}>
          <Body style={{ color: colors.gold, lineHeight: 18 }}>
            There is already a round going. Starting a new one leaves the old one unfinished — you
            can still find it and post it from History.
          </Body>
        </Card>
      ) : null}

      <View style={{ gap: 10 }}>
        <Eyebrow>Course</Eyebrow>
        {store.courses.length === 0 ? (
          <Card style={{ padding: 16, gap: 12 }}>
            <Body style={{ color: ink.soft, lineHeight: 19 }}>
              No courses saved. You need one with a real par and stroke index per hole before pops
              mean anything.
            </Body>
            <PrimaryButton label="Add a course" onPress={() => router.push('/courses')} />
          </Card>
        ) : (
          store.courses.map((c) => {
            const on = courseId === c.id;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                onPress={() => setCourseId(c.id)}
                style={[styles.row, on ? styles.rowOn : null]}
              >
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.name}>{c.name}</Text>
                  <Text style={styles.meta}>
                    {c.tees[0].holes.length} holes · par {c.tees[0].holes.reduce((s, h) => s + h.par, 0)}
                    {c.tees.length > 1 ? ` · ${c.tees.length} tees` : ''}
                  </Text>
                </View>
                <View style={[styles.check, on ? styles.checkOn : null]}>
                  {on ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
              </Pressable>
            );
          })
        )}
        {course && course.tees.length > 1 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Text style={styles.meta}>Tee</Text>
            {course.tees.map((tee) => (
              <Chip
                key={tee.id}
                label={tee.name}
                accessibilityLabel={`${tee.name} tee`}
                active={teeId === tee.id}
                color={colors.accent}
                onPress={() => setChosenTee(tee.id)}
              />
            ))}
          </View>
        ) : null}
        {store.courses.length > 0 ? (
          <GhostButton dashed label="Manage courses" onPress={() => router.push('/courses')} />
        ) : null}
      </View>

      <View style={{ gap: 10 }}>
        <Eyebrow>Who’s playing</Eyebrow>
        {group.players.map((p) => {
          const on = selected.includes(p.id);
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => toggle(p.id)}
              style={[styles.row, on ? styles.rowOn : null]}
            >
              <Avatar initials={p.initials} color={p.color} size={30} />
              <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>
                {p.name}
              </Text>
              {on ? (
                <Mono size={10} style={{ color: ink.quiet }}>
                  TEE {group.players.filter((q) => selected.includes(q.id)).indexOf(p) + 1}
                </Mono>
              ) : null}
              <View style={[styles.check, on ? styles.checkOn : null]}>
                {on ? <Text style={styles.checkMark}>✓</Text> : null}
              </View>
            </Pressable>
          );
        })}
        <Text style={styles.note}>
          Tee order sets the Wolf rotation. Reorder players in the roster if it matters.
        </Text>
      </View>

      <PrimaryButton
        label={
          selected.length < 2
            ? 'Pick at least two players'
            : !course
              ? 'Pick a course'
              : `${cardMode ? 'Enter the card' : 'Start'} · ${selected.length} players at ${course.name}`
        }
        disabled={!canStart}
        onPress={start}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: { padding: 14, borderColor: 'rgba(232,196,106,.3)' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    backgroundColor: colors.cardDeep,
    borderWidth: 1,
    borderColor: line.card,
    borderRadius: radius.card,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  rowOn: { borderColor: colors.accentSoft, backgroundColor: colors.cardActive },
  name: { fontFamily: fonts.sansSemi, fontSize: 14, color: ink.full },
  meta: { fontFamily: fonts.sans, fontSize: 11.5, color: ink.soft, marginTop: 2 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: line.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { fontSize: 12, color: colors.screen, fontFamily: fonts.sansBold },
  note: { fontFamily: fonts.sans, fontSize: 11, color: ink.quiet, lineHeight: 16 },
});
