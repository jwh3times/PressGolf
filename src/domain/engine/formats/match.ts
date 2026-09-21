import type { GameOptions, Pairing, SettlementLine } from '../../types';
import { money, RoundContext } from '../context';
import type { Ledger } from '../ledger';
import { matchStatus } from './nassau';

/** Every unique pair in the round — the fallback when the group has not chosen rivals. */
export function allPairings(ctx: RoundContext): Pairing[] {
  const out: Pairing[] = [];
  for (let i = 0; i < ctx.ids.length; i++) {
    for (let j = i + 1; j < ctx.ids.length; j++) out.push([ctx.ids[i], ctx.ids[j]]);
  }
  return out;
}

/** Keeps only pairings whose players are both actually in this round. */
export function resolvePairings(ctx: RoundContext, options: GameOptions): Pairing[] {
  const chosen = (options.matchPairings ?? []).filter(
    ([a, b]) => a !== b && ctx.ids.includes(a) && ctx.ids.includes(b),
  );
  return chosen.length ? chosen : allPairings(ctx);
}

/** Straight 1v1 match play over the full round. Halved matches push. */
export function settleMatch(
  ctx: RoundContext,
  ledger: Ledger,
  stake: number,
  options: GameOptions,
): { lines: SettlementLine[] } {
  const lines: SettlementLine[] = [];
  const pairings = resolvePairings(ctx, options);

  for (const [a, b] of pairings) {
    const status = matchStatus(ctx, a, b, 0, ctx.holeCount - 1);
    const label = `${ctx.initials(a)} v ${ctx.initials(b)}`;
    if (status.lastPlayed < 0) {
      lines.push({ text: `${label} — not under way`, amount: '—', tone: 'pending' });
      continue;
    }
    if (status.up === 0) {
      lines.push({
        text: `${label} — all square`,
        amount: status.complete ? 'push' : 'live',
        tone: 'pending',
      });
      continue;
    }
    const winner = status.up > 0 ? a : b;
    const loser = status.up > 0 ? b : a;
    ledger.pay(loser, winner, stake);

    const remaining = ctx.holeCount - (status.lastPlayed + 1);
    const closedOut = Math.abs(status.up) > remaining;
    const state = status.complete
      ? `${Math.abs(status.up)} up`
      : closedOut
        ? `${Math.abs(status.up)} & ${remaining} — dormie done`
        : `${Math.abs(status.up)} up (running)`;

    lines.push({
      text: `${label} — ${ctx.initials(winner)} ${state}`,
      amount: money(stake),
      tone: 'won',
    });
  }

  return { lines };
}
