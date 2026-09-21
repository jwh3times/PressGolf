import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Field } from '../components/Field';
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
import { makeOuting, makeRound, splitIntoGroups } from '../domain/factory';
import type { PlayerId, TeeFormat } from '../domain/types';
import { useStore } from '../store/AppStore';
import { colors, fonts, ink, line, radius } from '../theme/tokens';

/**
 * Sets up a day for more than one group.
 *
 * A normal foursome does not come through here — "Start a round" still does
 * that in one tap. This is for the twenty-man Saturday, where the work is
 * picking who is actually out and splitting them up.
 */
export default function NewOutingScreen() {
  const store = useStore();
  const router = useRouter();
  const group = store.group;

  const [name, setName] = useState('');
  const [courseId, setCourseId] = useState<string | null>(
    group?.defaultCourseId ?? store.courses[0]?.id ?? null,
  );
  const [teeFormat, setTeeFormat] = useState<TeeFormat>('sequential');
  const [field, setField] = useState<PlayerId[]>(group?.players.map((p) => p.id) ?? []);

  if (!group) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="New outing" onClose={() => router.back()} />
        <EmptyState
          title="No group yet"
          body="Build your roster first — an outing is drawn from it."
          action={<PrimaryButton label="Set up a group" onPress={() => router.replace('/roster')} />}
        />
      </Screen>
    );
  }

  const course = store.courses.find((c) => c.id === courseId) ?? null;
  const groupCount = Math.max(1, splitIntoGroups(field).length);
  const canStart = course != null && field.length >= 2;

  const toggle = (id: PlayerId) =>
    setField((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const start = () => {
    if (!course) return;
    // Keep roster order so tee order is predictable.
    const ordered = group.players.filter((p) => field.includes(p.id)).map((p) => p.id);
    const outing = makeOuting(group, course, {
      name: name.trim() || `${course.name} outing`,
      field: ordered,
      teeFormat,
    });
    const chunks = splitIntoGroups(ordered);
    const rounds = chunks.map((ids, i) =>
      makeRound(group, course, ids, {
        outingId: outing.id,
        name: `Group ${i + 1}`,
        teeTime: teeFormat === 'sequential' ? `${8 + Math.floor(i / 6)}:${String((i * 10) % 60).padStart(2, '0')}` : null,
      }),
    );
    outing.roundIds = rounds.map((r) => r.id);
    // Everyone is opted into the pots by default; the organiser trims from there.
    outing.fieldGames.fieldSkins.entrants = [...ordered];
    outing.fieldGames.scats.entrants = [...ordered];

    store.startOuting(outing, rounds);
    router.replace('/outing');
  };

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader eyebrow={group.name} title="New outing" onClose={() => router.back()} />

      <Field
        label="What is it called"
        placeholder="Society Saturday"
        value={name}
        onChangeText={setName}
      />

      <View style={{ gap: 10 }}>
        <Eyebrow>Course</Eyebrow>
        {store.courses.length === 0 ? (
          <Card style={{ padding: 16, gap: 12 }}>
            <Body style={{ color: ink.soft, lineHeight: 19 }}>
              No courses saved yet.
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
                <Check on={on} />
              </Pressable>
            );
          })
        )}
      </View>

      <View style={{ gap: 10 }}>
        <Eyebrow>How you start</Eyebrow>
        {(
          [
            ['sequential', 'Tee times', 'Everyone off the first, ten minutes apart. Field standings update hole by hole.'],
            ['shotgun', 'Shotgun', 'Groups start on different holes. Field pots settle once the whole field has passed a hole.'],
          ] as const
        ).map(([value, label, blurb]) => {
          const on = teeFormat === value;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              onPress={() => setTeeFormat(value)}
              style={[styles.row, on ? styles.rowOn : null, { alignItems: 'flex-start' }]}
            >
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.name}>{label}</Text>
                <Text style={[styles.meta, { lineHeight: 16 }]}>{blurb}</Text>
              </View>
              <Check on={on} />
            </Pressable>
          );
        })}
      </View>

      <View style={{ gap: 10 }}>
        <View style={styles.fieldHeader}>
          <Eyebrow>Who is out</Eyebrow>
          <Mono size={11} style={{ color: ink.ghost }}>
            {field.length} in · {groupCount} group{groupCount === 1 ? '' : 's'}
          </Mono>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <GhostButton
            label="Everyone"
            onPress={() => setField(group.players.map((p) => p.id))}
            style={{ flex: 1 }}
          />
          <GhostButton label="Nobody" onPress={() => setField([])} style={{ flex: 1 }} />
        </View>
        {group.players.map((p) => {
          const on = field.includes(p.id);
          return (
            <Pressable
              key={p.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={p.name}
              onPress={() => toggle(p.id)}
              style={[styles.row, on ? styles.rowOn : null]}
            >
              <Avatar initials={p.initials} color={p.color} size={30} />
              <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>
                {p.name}
              </Text>
              <Check on={on} />
            </Pressable>
          );
        })}
        <GhostButton dashed label="Add somebody to the roster" onPress={() => router.push('/roster')} />
      </View>

      <PrimaryButton
        label={
          field.length < 2
            ? 'Pick at least two players'
            : !course
              ? 'Pick a course'
              : `Start · ${field.length} out in ${groupCount} group${groupCount === 1 ? '' : 's'}`
        }
        disabled={!canStart}
        onPress={start}
      />
      <Text style={styles.note}>
        Groups are split four at a time and can be rearranged afterwards. Field pots and each
        group’s own games are set once everyone is in.
      </Text>
    </Screen>
  );
}

function Check({ on }: { on: boolean }) {
  return (
    <View style={[styles.check, on ? styles.checkOn : null]}>
      {on ? <Text style={styles.checkMark}>✓</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
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
  fieldHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
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
  note: { fontFamily: fonts.sans, fontSize: 11, color: ink.ghost, lineHeight: 16 },
});
