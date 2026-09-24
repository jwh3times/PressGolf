import { useRouter } from 'expo-router';
import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Screen } from '../../components/Screen';
import {
  Avatar,
  Body,
  Display,
  EmptyState,
  Eyebrow,
  GameDot,
  Money,
  Mono,
  PrimaryButton,
} from '../../components/primitives';
import { RoundContext, money, signedMoney } from '../../domain/engine';
import { useLargeText } from '../../hooks/useLargeText';
import { useStore } from '../../store/AppStore';
import { colors, fill, fonts, ink, line, radius } from '../../theme/tokens';

export default function SettleScreen() {
  const store = useStore();
  const router = useRouter();
  const largeText = useLargeText();
  const { round, course, group, settlement } = store;

  if (!round || !course || !group || !settlement) {
    return (
      <Screen>
        <EmptyState
          title="Nothing to settle"
          body="Once a round is going, this is where the money lands."
          action={
            <PrimaryButton
              label="Start a round"
              onPress={() => router.push('/new-round')}
              style={{ alignSelf: 'stretch' }}
            />
          }
        />
      </Screen>
    );
  }

  const ctx = new RoundContext(round, course, group.players);
  const youId = group.youId;
  const yourNet = youId ? settlement.net[youId] ?? 0 : 0;
  const headline = !youId
    ? `${settlement.transfers.length} hand-off${settlement.transfers.length === 1 ? '' : 's'}`
    : yourNet > 0
      ? `You’re up ${money(yourNet)}`
      : yourNet < 0
        ? `You’re down ${money(-yourNet)}`
        : 'You’re dead even';

  const finish = () => {
    Alert.alert(
      'Post to the season ledger?',
      'This closes the round and adds every net position to the season standings. You can reopen it from History.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'Post it',
          style: 'default',
          onPress: () => {
            store.completeRound(round.id);
            router.replace('/');
          },
        },
      ],
    );
  };

  return (
    <Screen>
      <View>
        <Eyebrow>Settlement · thru {settlement.thru}</Eyebrow>
        <Display style={{ marginTop: 3 }}>{headline}</Display>
      </View>

      <View style={{ gap: 8 }}>
        <Eyebrow>Hand it over</Eyebrow>
        {settlement.transfers.length === 0 ? (
          <View style={styles.square}>
            <Body style={{ color: ink.soft, textAlign: 'center' }}>
              Dead even. Nobody owes anybody — yet.
            </Body>
          </View>
        ) : (
          settlement.transfers.map((transfer, i) => {
            const from = group.players.find((p) => p.id === transfer.from);
            const to = group.players.find((p) => p.id === transfer.to);
            if (!from || !to) return null;
            return (
              <View key={i} style={[styles.transfer, largeText ? styles.stackRow : null]}>
                <View style={styles.transferAvatars}>
                  <Avatar initials={from.initials} color={from.color} size={30} />
                  <Text style={{ fontSize: 13, color: ink.quiet }}>→</Text>
                  <Avatar initials={to.initials} color={to.color} size={30} />
                </View>
                <View style={[styles.transferCopy, largeText ? styles.transferCopyLarge : null]}>
                  {/* Full names, not first words: "Big Ray" truncates to "Big". */}
                  <Text
                    style={[styles.transferText, largeText ? styles.fullWidth : null]}
                    numberOfLines={largeText ? undefined : 1}
                  >
                    {from.name} pays {to.name}
                  </Text>
                  <Text style={styles.transferAmount}>{money(transfer.amount)}</Text>
                </View>
              </View>
            );
          })
        )}
      </View>

      <View style={{ gap: 10 }}>
        <Eyebrow>The math, line by line</Eyebrow>
        {settlement.games.length === 0 ? (
          <View style={styles.square}>
            <Body style={{ color: ink.soft, textAlign: 'center' }}>
              No games switched on. Nothing to add up.
            </Body>
          </View>
        ) : (
          settlement.games.map((game) => (
            <View key={game.key} style={styles.breakdown}>
              <View style={[styles.breakdownHeader, largeText ? styles.stackRow : null]}>
                <GameDot color={game.color} />
                <Text style={[styles.breakdownName, largeText ? styles.fullWidth : null]}>
                  {game.name} · {game.detail}
                </Text>
                <Mono size={11} style={{ color: ink.soft }}>
                  {money(round.games[game.key].stake)}
                </Mono>
              </View>
              {(game.lines.length
                ? game.lines
                : [{ text: 'Nothing banked yet.', amount: '—', tone: 'pending' as const }]
              ).map((line_, i) => (
                <View
                  key={i}
                  style={[styles.breakdownLine, largeText ? styles.stackRow : null]}
                >
                  <Text style={[styles.breakdownText, largeText ? styles.fullWidth : null]}>
                    {line_.text}
                  </Text>
                  <Text
                    style={[
                      styles.breakdownAmount,
                      line_.tone === 'won'
                        ? { color: colors.accent, fontFamily: fonts.monoBold, fontSize: 12.5 }
                        : null,
                    ]}
                  >
                    {line_.amount}
                  </Text>
                </View>
              ))}
            </View>
          ))
        )}
      </View>

      <View style={{ gap: 8 }}>
        <Eyebrow>Net position</Eyebrow>
        {ctx.players.map((player) => {
          const net = settlement.net[player.id] ?? 0;
          const toPar = ctx.netToPar(player.id);
          return (
            <View key={player.id} style={[styles.netRow, largeText ? styles.stackRow : null]}>
              <View style={[styles.netIdentity, largeText ? styles.fullWidth : null]}>
                <Avatar initials={player.initials} color={player.color} size={30} />
                <Text style={styles.netName} numberOfLines={largeText ? undefined : 1}>
                  {player.name}
                </Text>
              </View>
              <View style={styles.netStats}>
                <Mono size={11} style={{ color: ink.quiet }}>
                  {toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : toPar}
                </Mono>
                <Money cents={net} label={signedMoney(net)} />
              </View>
            </View>
          );
        })}
      </View>

      <PrimaryButton label="Post to the season ledger" onPress={finish} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  stackRow: { flexDirection: 'column', alignItems: 'flex-start' },
  fullWidth: { flex: 0, width: '100%' },
  square: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: line.dashed,
    borderRadius: radius.panel,
    padding: 18,
  },
  transfer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: line.strong,
    borderRadius: radius.panel,
    padding: 14,
  },
  transferAvatars: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  transferCopy: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 10 },
  transferCopyLarge: { flex: 0, width: '100%', flexDirection: 'column', alignItems: 'flex-start' },
  transferText: { flex: 1, minWidth: 0, fontFamily: fonts.sans, fontSize: 13, color: ink.body },
  transferAmount: { fontFamily: fonts.monoBold, fontSize: 16, color: ink.full },
  breakdown: {
    backgroundColor: colors.cardDeep,
    borderWidth: 1,
    borderColor: line.card,
    borderRadius: radius.panel,
    overflow: 'hidden',
  },
  breakdownHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: fill.wash,
  },
  breakdownName: { flex: 1, minWidth: 0, fontFamily: fonts.sansSemi, fontSize: 13.5, color: ink.full },
  breakdownLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: line.hair,
  },
  breakdownText: { flex: 1, minWidth: 0, fontFamily: fonts.sans, fontSize: 12.5, color: ink.body, lineHeight: 17 },
  breakdownAmount: { fontFamily: fonts.mono, fontSize: 12, color: ink.soft },
  netRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: line.soft,
  },
  netIdentity: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 11 },
  netStats: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  netName: { flex: 1, minWidth: 0, fontFamily: fonts.sans, fontSize: 13.5, color: ink.full },
});
