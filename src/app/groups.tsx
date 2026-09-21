import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ModalHeader, Screen } from '../components/Screen';
import {
  Avatar,
  Body,
  EmptyState,
  Eyebrow,
  GhostButton,
  Mono,
  PrimaryButton,
} from '../components/primitives';
import type { PlayerId } from '../domain/types';
import { useStore, type OutingGroupDraft } from '../store/AppStore';
import { colors, fonts, ink, line, radius } from '../theme/tokens';

/**
 * Sorting the field into playing groups.
 *
 * Deliberately tap-to-move rather than drag-and-drop: this gets used standing
 * in a car park on a cold morning, and a drag target you have to hit precisely
 * is the wrong control for that. Pick a player, tap the group they belong in.
 */
export default function GroupsScreen() {
  const store = useStore();
  const router = useRouter();
  const { outing, outingGroup, outingRounds } = store;

  const initial = useMemo<OutingGroupDraft[]>(
    () =>
      outingRounds.map((r) => ({
        roundId: r.id,
        name: r.name,
        teeTime: r.teeTime,
        playerIds: [...r.playerIds],
      })),
    [outingRounds],
  );

  /**
   * Null until the organiser actually moves somebody.
   *
   * Seeding useState from `initial` looks equivalent and is not: this screen
   * can mount before the store has finished reading off disk, and the
   * initialiser would then capture an empty list for good. The screen would
   * show all twenty players as unassigned and offer to save that — wiping
   * every group. Deferring to live data until the first edit removes the
   * failure mode rather than papering over it.
   */
  const [draft, setDraft] = useState<OutingGroupDraft[] | null>(null);
  const groups = draft ?? initial;
  const [picked, setPicked] = useState<PlayerId | null>(null);

  if (!outing || !outingGroup) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="Groups" onClose={() => router.back()} closeLabel="Back" />
        <EmptyState title="No outing on" body="Groups belong to a day with a field in it." />
      </Screen>
    );
  }

  const player = (id: PlayerId) => outingGroup.players.find((p) => p.id === id);
  const assigned = new Set(groups.flatMap((g) => g.playerIds));
  const unassigned = outing.field.filter((id) => !assigned.has(id));
  const dirty = draft != null && JSON.stringify(draft) !== JSON.stringify(initial);

  /** Moves the picked player into a group, pulling them out of wherever they were. */
  const moveTo = (targetIndex: number) => {
    if (!picked) return;
    setDraft((prev) =>
      (prev ?? initial).map((g, i) => ({
        ...g,
        playerIds:
          i === targetIndex
            ? g.playerIds.includes(picked)
              ? g.playerIds
              : [...g.playerIds, picked]
            : g.playerIds.filter((id) => id !== picked),
      })),
    );
    setPicked(null);
  };

  const pullOut = (id: PlayerId) => {
    setDraft((prev) =>
      (prev ?? initial).map((g) => ({ ...g, playerIds: g.playerIds.filter((x) => x !== id) })),
    );
    setPicked(id);
  };

  const save = () => {
    // Empty groups are dropped rather than sent out with nobody in them.
    store.setOutingGroups(groups.filter((g) => g.playerIds.length > 0));
    router.back();
  };

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader
        eyebrow={outing.name}
        title="Groups"
        onClose={() => router.back()}
        closeLabel={dirty ? 'Cancel' : 'Back'}
      />
      <Body style={{ color: ink.soft, lineHeight: 19 }}>
        Tap a player, then tap the group they should be in. Each group keeps its own card and its
        own bets — moving somebody brings their scores with them.
      </Body>

      {picked ? (
        <View style={styles.pickedBar}>
          <Avatar
            initials={player(picked)?.initials ?? '??'}
            color={player(picked)?.color ?? colors.accent}
            size={26}
          />
          <Text style={styles.pickedText}>
            {player(picked)?.name} — tap a group below
          </Text>
          <Pressable accessibilityRole="button" onPress={() => setPicked(null)} hitSlop={8}>
            <Mono size={10} style={{ color: ink.faint }}>
              CANCEL
            </Mono>
          </Pressable>
        </View>
      ) : null}

      {unassigned.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Eyebrow>Not in a group</Eyebrow>
          <View style={styles.pool}>
            {unassigned.map((id) => {
              const p = player(id);
              if (!p) return null;
              return (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityLabel={p.name}
                  onPress={() => setPicked(picked === id ? null : id)}
                  style={[styles.chip, picked === id ? { borderColor: p.color } : null]}
                >
                  <Avatar initials={p.initials} color={p.color} size={22} />
                  <Text style={styles.chipName}>{p.name}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.warn}>
            Anybody left here still counts in the field pots, so their holes read as unfinished all
            day.
          </Text>
        </View>
      ) : null}

      {groups.map((group, index) => (
        <Pressable
          key={group.roundId ?? index}
          accessibilityRole="button"
          accessibilityLabel={`Move into ${group.name}`}
          onPress={() => moveTo(index)}
          style={[styles.group, picked ? styles.groupTarget : null]}
        >
          <View style={styles.groupHead}>
            <Text style={styles.groupName}>{group.name}</Text>
            {group.teeTime ? (
              <Mono size={10.5} style={{ color: ink.ghost }}>
                {group.teeTime}
              </Mono>
            ) : null}
            <View style={{ flex: 1 }} />
            <Mono size={10.5} style={{ color: group.playerIds.length > 4 ? colors.clay : ink.ghost }}>
              {group.playerIds.length}
            </Mono>
          </View>

          {group.playerIds.length === 0 ? (
            <Text style={styles.emptyGroup}>Empty — it will be dropped when you save.</Text>
          ) : (
            <View style={{ gap: 7 }}>
              {group.playerIds.map((id) => {
                const p = player(id);
                if (!p) return null;
                return (
                  <Pressable
                    key={id}
                    accessibilityRole="button"
                    accessibilityLabel={`Take ${p.name} out of ${group.name}`}
                    onPress={() => pullOut(id)}
                    style={styles.member}
                  >
                    <Avatar initials={p.initials} color={p.color} size={24} />
                    <Text style={styles.memberName} numberOfLines={1}>
                      {p.name}
                    </Text>
                    <Mono size={10} style={{ color: ink.trace }}>
                      MOVE
                    </Mono>
                  </Pressable>
                );
              })}
            </View>
          )}

          {group.playerIds.length > 4 ? (
            <Text style={styles.warn}>
              Five or more in a group is slow going, but nothing stops you.
            </Text>
          ) : null}
        </Pressable>
      ))}

      <GhostButton
        dashed
        label="Add another group"
        onPress={() =>
          setDraft((prev) => {
            const base = prev ?? initial;
            return [
              ...base,
              { roundId: null, name: `Group ${base.length + 1}`, teeTime: null, playerIds: [] },
            ];
          })
        }
      />

      {groups.some((g) => g.roundId == null && g.playerIds.length > 0) ? (
        <Text style={styles.warn}>
          New groups need a card of their own — save, and they start blank.
        </Text>
      ) : null}

      <PrimaryButton label={dirty ? 'Save the groups' : 'Nothing changed'} disabled={!dirty} onPress={save} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pickedBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.cardActive,
    borderWidth: 1,
    borderColor: colors.accentSoft,
    borderRadius: radius.card,
    padding: 12,
  },
  pickedText: { flex: 1, minWidth: 0, fontFamily: fonts.sansSemi, fontSize: 13, color: ink.full },
  pool: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: line.control,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  chipName: { fontFamily: fonts.sans, fontSize: 12, color: ink.body },
  group: {
    backgroundColor: colors.cardDeep,
    borderWidth: 1,
    borderColor: line.card,
    borderRadius: radius.format,
    padding: 14,
    gap: 10,
  },
  groupTarget: { borderColor: colors.accentSoft, borderStyle: 'dashed' },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupName: { fontFamily: fonts.sansBold, fontSize: 14.5, color: ink.full },
  emptyGroup: { fontFamily: fonts.sans, fontSize: 11.5, color: ink.ghost },
  member: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  memberName: { flex: 1, minWidth: 0, fontFamily: fonts.sans, fontSize: 13, color: ink.full },
  warn: { fontFamily: fonts.sans, fontSize: 11, color: colors.clay, lineHeight: 15 },
});
