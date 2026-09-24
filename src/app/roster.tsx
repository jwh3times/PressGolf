import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Field } from '../components/Field';
import { ModalHeader, Screen } from '../components/Screen';
import {
  Avatar,
  Body,
  Card,
  Eyebrow,
  GhostButton,
  Mono,
  PrimaryButton,
} from '../components/primitives';
import { PLAYER_COLORS, deriveInitials, makePlayer } from '../domain/factory';
import type { Player } from '../domain/types';
import { useStore } from '../store/AppStore';
import { colors, fonts, ink, radius } from '../theme/tokens';

export default function RosterScreen() {
  const store = useStore();
  const router = useRouter();
  const [groupName, setGroupName] = useState('');
  const [newPlayer, setNewPlayer] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const group = store.group;

  // First run: there is no group yet, so this screen is the onboarding.
  if (!group) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader
          eyebrow="Setup"
          title="Name the group"
          onClose={() => router.back()}
          closeLabel="Close"
        />
        <Body style={{ color: ink.soft, lineHeight: 19 }}>
          Whatever you actually call yourselves. You can change it later.
        </Body>
        <Field
          label="Group name"
          placeholder="Saturday Dogs"
          value={groupName}
          onChangeText={setGroupName}
          autoFocus
          returnKeyType="done"
        />
        <PrimaryButton
          label="Create group"
          disabled={groupName.trim().length === 0}
          onPress={() => store.createGroup(groupName.trim())}
        />
      </Screen>
    );
  }

  const addPlayer = () => {
    const name = newPlayer.trim();
    if (!name) return;
    store.addPlayer(group.id, makePlayer(name, group.players.length));
    setNewPlayer('');
  };

  const removePlayer = (player: Player) => {
    Alert.alert(
      `Remove ${player.name}?`,
      'They stay in any round you have already posted, so the season ledger keeps its history.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => store.removePlayer(group.id, player.id),
        },
      ],
    );
  };

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader eyebrow="Your group" title={group.name} onClose={() => router.back()} />

      <Field
        label="Group name"
        value={group.name}
        onChangeText={(text) => store.updateGroup(group.id, { name: text })}
      />
      <Field
        label="Subtitle"
        placeholder="Pine Hollow · 7:40 tee"
        hint="Shown under the group name on the home screen."
        value={group.subtitle}
        onChangeText={(text) => store.updateGroup(group.id, { subtitle: text })}
      />

      <View style={{ gap: 10 }}>
        <Eyebrow>Players</Eyebrow>
        {group.players.length === 0 ? (
          <Card style={{ padding: 16 }}>
            <Body style={{ color: ink.soft }}>Nobody yet. Add at least two to play anything.</Body>
          </Card>
        ) : null}

        {group.players.map((player, index) => {
          const isYou = group.youId === player.id;
          const open = editing === player.id;
          return (
            <Card key={player.id} style={{ padding: 13, gap: open ? 12 : 0 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditing(open ? null : player.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}
              >
                <Avatar initials={player.initials} color={player.color} size={34} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                    <Text style={styles.name} numberOfLines={1}>
                      {player.name}
                    </Text>
                    {isYou ? (
                      <View style={styles.youTag}>
                        <Text style={styles.youText}>YOU</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.sub}>{open ? 'tap to close' : 'tap to edit'}</Text>
                </View>
                <Mono size={11} style={{ color: ink.quiet }}>
                  {index + 1}
                </Mono>
              </Pressable>

              {open ? (
                <View style={{ gap: 12 }}>
                  <Field
                    label="Name"
                    value={player.name}
                    onChangeText={(text) =>
                      store.updatePlayer(group.id, player.id, {
                        name: text,
                        // Keep initials in step unless they have been customised.
                        initials:
                          player.initials === deriveInitials(player.name)
                            ? deriveInitials(text)
                            : player.initials,
                      })
                    }
                  />
                  <Field
                    label="Initials"
                    value={player.initials}
                    maxLength={3}
                    autoCapitalize="characters"
                    onChangeText={(text) =>
                      store.updatePlayer(group.id, player.id, { initials: text.toUpperCase() })
                    }
                  />
                  <View style={{ gap: 6 }}>
                    <Text style={styles.fieldLabel}>Colour</Text>
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      {PLAYER_COLORS.map((color) => (
                        <Pressable
                          key={color}
                          accessibilityRole="button"
                          accessibilityLabel={`Colour ${color}`}
                          onPress={() => store.updatePlayer(group.id, player.id, { color })}
                          style={[
                            styles.swatch,
                            {
                              backgroundColor: `${color}33`,
                              borderColor: player.color === color ? color : 'transparent',
                            },
                          ]}
                        >
                          <View style={{ width: 14, height: 14, borderRadius: 999, backgroundColor: color }} />
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {!isYou ? (
                      <GhostButton
                        label="This is me"
                        onPress={() => store.updateGroup(group.id, { youId: player.id })}
                        style={{ flex: 1 }}
                      />
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => removePlayer(player)}
                      style={[styles.destructive, { flex: 1 }]}
                    >
                      <Text style={styles.destructiveText}>Remove</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </Card>
          );
        })}

        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-end' }}>
          <View style={{ flex: 1 }}>
            <Field
              label="Add a player"
              placeholder="Name"
              value={newPlayer}
              onChangeText={setNewPlayer}
              onSubmitEditing={addPlayer}
              returnKeyType="done"
            />
          </View>
          <PrimaryButton
            label="Add"
            onPress={addPlayer}
            disabled={newPlayer.trim().length === 0}
            style={{ paddingVertical: 13, paddingHorizontal: 18, borderRadius: radius.md }}
          />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  name: { fontFamily: fonts.sansSemi, fontSize: 15, color: ink.full },
  sub: { fontFamily: fonts.sans, fontSize: 11, color: ink.quiet, marginTop: 2 },
  fieldLabel: {
    fontFamily: fonts.mono,
    fontSize: 10,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    color: ink.soft,
  },
  youTag: {
    backgroundColor: 'rgba(139,224,174,.15)',
    borderRadius: 4,
    paddingVertical: 2,
    paddingHorizontal: 5,
  },
  youText: { fontFamily: fonts.mono, fontSize: 10, letterSpacing: 0.85, color: colors.accent },
  swatch: {
    width: 34,
    height: 34,
    borderRadius: 999,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destructive: {
    borderWidth: 1,
    borderColor: 'rgba(232,154,127,.4)',
    borderRadius: radius.card,
    paddingVertical: 13,
    alignItems: 'center',
  },
  destructiveText: { fontFamily: fonts.sansSemi, fontSize: 13.5, color: colors.clay },
});
