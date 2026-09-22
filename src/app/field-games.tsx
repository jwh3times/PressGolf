import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ModalHeader, Screen } from '../components/Screen';
import {
  Avatar,
  Body,
  EmptyState,
  Eyebrow,
  GhostButton,
  Mono,
  Stepper,
  Switch,
} from '../components/primitives';
import { money } from '../domain/engine';
import { FIELD_FORMATS } from '../domain/formats';
import { FIELD_GAME_KEYS } from '../domain/types';
import { useStore } from '../store/AppStore';
import { colors, fill, fonts, ink, line, radius } from '../theme/tokens';

/**
 * The pots everybody plays, and who is in them.
 *
 * Two things here are load-bearing and easy to get wrong in a group, so they
 * are stated on screen rather than buried: whether the hole is decided on gross
 * or net, and whether a tied hole carries. Those two switches are the whole
 * difference between skins and a rabbit-variant scat.
 */
export default function FieldGamesScreen() {
  const store = useStore();
  const router = useRouter();
  const { outing, outingGroup } = store;

  if (!outing || !outingGroup) {
    return (
      <Screen floatingTabBar={false}>
        <ModalHeader title="Field pots" onClose={() => router.back()} />
        <EmptyState title="No outing on" body="Field pots belong to a day with a field in it." />
      </Screen>
    );
  }

  const fieldPlayers = outing.field
    .map((id) => outingGroup.players.find((p) => p.id === id))
    .filter((p): p is NonNullable<typeof p> => p != null);

  const step = (cents: number) => (cents >= 5000 ? 1000 : cents >= 2000 ? 500 : 100);

  return (
    <Screen floatingTabBar={false}>
      <ModalHeader
        eyebrow={outing.name}
        title="Field pots"
        onClose={() => router.back()}
        closeLabel="Done"
      />
      <Body style={{ color: ink.soft, lineHeight: 19 }}>
        Everyone in a pot puts up the same buy-in and the pot comes back out to whoever won holes.
        Each foursome’s own games are set separately, on the Format tab.
      </Body>

      {FIELD_GAME_KEYS.map((key) => {
        const meta = FIELD_FORMATS[key];
        const config = outing.fieldGames[key];
        const on = config.on;
        const pot = config.buyIn * config.entrants.length;

        return (
          <View
            key={key}
            style={[
              styles.card,
              { backgroundColor: on ? colors.cardActive : colors.cardDeep, borderColor: on ? colors.accentSoft : line.card },
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.name}>{meta.name}</Text>
                  <View style={styles.tag}>
                    <Text style={styles.tagText}>{meta.tag}</Text>
                  </View>
                </View>
                <Text style={styles.blurb}>{meta.blurb}</Text>
              </View>
              <Switch
                on={on}
                onToggle={() => store.setFieldGame(key, { on: !on })}
                label={meta.name}
              />
            </View>

            {on ? (
              <View style={{ gap: 14, marginTop: 14, paddingTop: 13, borderTopWidth: 1, borderTopColor: line.bright }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.settingLabel}>{meta.buyInLabel}</Text>
                    <Text style={styles.settingHint}>
                      {config.entrants.length} in · {money(pot)} pot
                    </Text>
                  </View>
                  <Stepper
                    value={money(config.buyIn)}
                    onDecrement={() =>
                      store.setFieldGame(key, { buyIn: Math.max(0, config.buyIn - step(config.buyIn)) })
                    }
                    onIncrement={() =>
                      store.setFieldGame(key, { buyIn: config.buyIn + step(config.buyIn) })
                    }
                  />
                </View>

                <Toggle
                  label={config.useNet ? 'Decided on net' : 'Decided on gross'}
                  hint={
                    config.useNet
                      ? 'Pops come off first. Low net wins the hole.'
                      : 'Raw score, handicaps ignored. "Only one man made par" is a gross statement.'
                  }
                  on={config.useNet}
                  onToggle={() => store.setFieldGame(key, { useNet: !config.useNet })}
                />

                <Toggle
                  label={config.carry ? 'Ties carry (rabbit)' : 'Ties just push'}
                  hint={
                    config.carry
                      ? 'A tied hole stacks its money onto the next hole somebody wins outright.'
                      : 'The pot splits evenly across however many holes get won outright.'
                  }
                  on={config.carry}
                  onToggle={() => store.setFieldGame(key, { carry: !config.carry })}
                />

                <Toggle
                  label={
                    config.unclaimed === 'splitAmongWinners'
                      ? 'Leftovers split among winners'
                      : 'Leftovers carry to next time'
                  }
                  hint={
                    config.unclaimed === 'splitAmongWinners'
                      ? 'Money still riding at the last hole is shared between everyone who won one.'
                      : 'Money still riding stays in the pot for the next outing.'
                  }
                  on={config.unclaimed === 'splitAmongWinners'}
                  onToggle={() =>
                    store.setFieldGame(key, {
                      unclaimed:
                        config.unclaimed === 'splitAmongWinners' ? 'carry' : 'splitAmongWinners',
                    })
                  }
                />

                <View style={{ gap: 9 }}>
                  <View style={styles.entrantHead}>
                    <Eyebrow>Who is in</Eyebrow>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <GhostButton
                        label="All"
                        onPress={() => store.setFieldGame(key, { entrants: [...outing.field] })}
                        style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 }}
                      />
                      <GhostButton
                        label="None"
                        onPress={() => store.setFieldGame(key, { entrants: [] })}
                        style={{ paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 }}
                      />
                    </View>
                  </View>
                  <View style={styles.entrantGrid}>
                    {fieldPlayers.map((p) => {
                      const inPot = config.entrants.includes(p.id);
                      return (
                        <Pressable
                          key={p.id}
                          accessibilityRole="button"
                          accessibilityState={{ selected: inPot }}
                          accessibilityLabel={`${p.name} in ${meta.name}`}
                          onPress={() => store.toggleFieldEntrant(key, p.id)}
                          style={[
                            styles.entrant,
                            inPot ? { borderColor: p.color, backgroundColor: `${p.color}18` } : null,
                          ]}
                        >
                          <Avatar initials={p.initials} color={p.color} size={22} />
                          <Text
                            style={[styles.entrantName, inPot ? { color: ink.full } : null]}
                            numberOfLines={1}
                          >
                            {p.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>

                {config.entrants.length < 2 ? (
                  <Text style={styles.warn}>
                    Needs at least two people in before it pays anything.
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}

      <View style={{ gap: 6 }}>
        <Eyebrow>Worth knowing</Eyebrow>
        <Mono size={11} style={{ color: ink.quiet, lineHeight: 17 }}>
          A hole only pays once every entrant has posted a score on it. With tee times ten minutes
          apart that means most of the card sits unresolved until the last group is in — which is
          reported rather than guessed at.
        </Mono>
      </View>
    </Screen>
  );
}

function Toggle({
  label,
  hint,
  on,
  onToggle,
}: {
  label: string;
  hint: string;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.settingLabel}>{label}</Text>
        <Text style={styles.settingHint}>{hint}</Text>
      </View>
      <Switch on={on} onToggle={onToggle} label={label} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: radius.format, padding: 15 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  name: { fontFamily: fonts.sansBold, fontSize: 15.5, color: ink.full },
  tag: { backgroundColor: fill.control, borderRadius: radius.sm, paddingVertical: 3, paddingHorizontal: 6 },
  tagText: {
    fontFamily: fonts.mono,
    fontSize: 8.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: ink.muted,
  },
  blurb: { fontFamily: fonts.sans, fontSize: 12, color: ink.muted, marginTop: 5, lineHeight: 17 },
  settingLabel: { fontFamily: fonts.sansSemi, fontSize: 13.5, color: ink.full },
  settingHint: { fontFamily: fonts.sans, fontSize: 11, color: ink.muted, marginTop: 3, lineHeight: 15 },
  entrantHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  entrantGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  entrant: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: line.control,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 7,
    maxWidth: '48%',
  },
  entrantName: { fontFamily: fonts.sans, fontSize: 11.5, color: ink.quiet, flexShrink: 1 },
  warn: { fontFamily: fonts.sans, fontSize: 11.5, color: colors.clay, lineHeight: 16 },
});
