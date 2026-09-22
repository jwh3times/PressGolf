import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ModalHeader, Screen } from '../components/Screen';
import {
  Avatar,
  Body,
  Card,
  EmptyState,
  Eyebrow,
  GhostButton,
  Mono,
  PrimaryButton,
} from '../components/primitives';
import { makeRound } from '../domain/factory';
import type { PlayerId } from '../domain/types';
import { useStore } from '../store/AppStore';
import { colors, fonts, ink, line, radius } from '../theme/tokens';

export default function NewRoundScreen() {
  const store = useStore();
  const router = useRouter();
  const group = store.group;

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
  const canStart = course != null && selected.length >= 2;

  const toggle = (id: PlayerId) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const start = () => {
    if (!course) return;
    // Keep tee order as the group's roster order, not the order of tapping.
    const ordered = group.players.filter((p) => selected.includes(p.id)).map((p) => p.id);
    const round = makeRound(group, course, ordered);
    store.startRound(round);
    router.replace('/format');
  };

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader eyebrow={group.name} title="New round" onClose={() => router.back()} />

      {activeRound ? (
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
                    {c.holes.length} holes · par {c.holes.reduce((s, h) => s + h.par, 0)}
                  </Text>
                </View>
                <View style={[styles.check, on ? styles.checkOn : null]}>
                  {on ? <Text style={styles.checkMark}>✓</Text> : null}
                </View>
              </Pressable>
            );
          })
        )}
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
              : `Start · ${selected.length} players at ${course.name}`
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
