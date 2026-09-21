import type { GameOptions, PlayerId, SettlementLine } from '../../types';
import { RoundContext } from '../context';
import type { Ledger } from '../ledger';

/** Net points for a single hole under the group's Stableford table. */
export function stablefordPoints(diffToPar: number, table: GameOptions['stablefordPoints']): number {
  if (diffToPar <= -2) return table.eagleOrBetter;
  if (diffToPar === -1) return table.birdie;
  if (diffToPar === 0) return table.par;
  if (diffToPar === 1) return table.bogey;
  return table.worse;
}

export function stablefordTotals(ctx: RoundContext, options: GameOptions): Record<PlayerId, number> {
  const totals: Record<PlayerId, number> = {};
  for (const id of ctx.ids) totals[id] = 0;
  for (let h = 0; h < ctx.holeCount; h++) {
    if (!ctx.played(h)) continue;
    for (const id of ctx.ids) {
      const net = ctx.net(id, h);
      if (net == null) continue;
      totals[id] += stablefordPoints(net - ctx.par(h), options.stablefordPoints);
    }
  }
  return totals;
}

/**
 * High points takes the pot. A tie at the top pushes — splitting a winner-takes-all
 * pot between two people is not what anybody agreed to on the first tee.
 */
export function settleStableford(
  ctx: RoundContext,
  ledger: Ledger,
  stake: number,
  options: GameOptions,
): { lines: SettlementLine[] } {
  const totals = stablefordTotals(ctx, options);
  const values = ctx.ids.map((id) => totals[id]);
  const high = values.length ? Math.max(...values) : 0;
  const leaders = ctx.ids.filter((id) => totals[id] === high);
  const decided = leaders.length === 1 && ctx.thru() === ctx.holeCount;

  if (decided) ledger.payAllTo(leaders[0], stake);

  const lines: SettlementLine[] = ctx.ids
    .slice()
    .sort((a, b) => totals[b] - totals[a])
    .map((id) => ({
      text: `${ctx.name(id)} — ${totals[id]} pts`,
      amount: leaders.includes(id) ? (decided ? 'takes it' : 'leader') : '',
      tone: leaders.includes(id) ? ('won' as const) : ('pending' as const),
    }));

  if (!decided && ctx.thru() > 0) {
    lines.push({
      text: leaders.length > 1 ? 'Tied at the top — pushes unless somebody breaks it' : 'Still running',
      amount: '',
      tone: 'pending',
    });
  }

  return { lines };
}

/**
 * Lowest net total over the full round clears the table. Like Stableford, an
 * unbroken tie pushes rather than splitting.
 */
export function settleStroke(
  ctx: RoundContext,
  ledger: Ledger,
  stake: number,
): { lines: SettlementLine[] } {
  const totals: Record<PlayerId, number> = {};
  for (const id of ctx.ids) {
    let sum = 0;
    for (let h = 0; h < ctx.holeCount; h++) {
      const net = ctx.net(id, h);
      if (net != null) sum += net;
    }
    totals[id] = sum;
  }

  const complete = ctx.thru() === ctx.holeCount && ctx.holeCount > 0;
  const values = ctx.ids.map((id) => totals[id]);
  const low = values.length ? Math.min(...values) : 0;
  const leaders = ctx.ids.filter((id) => totals[id] === low);
  const decided = complete && leaders.length === 1;

  if (decided) ledger.payAllTo(leaders[0], stake);

  const lines: SettlementLine[] = ctx.ids
    .slice()
    .sort((a, b) => totals[a] - totals[b])
    .map((id) => ({
      text: `${ctx.name(id)} — ${totals[id]} net thru ${ctx.thru()}`,
      amount: leaders.includes(id) ? (decided ? 'takes it' : 'leader') : '',
      tone: leaders.includes(id) ? ('won' as const) : ('pending' as const),
    }));

  if (!complete) {
    lines.push({ text: 'Settles once all scores are in.', amount: '', tone: 'pending' });
  } else if (!decided) {
    lines.push({ text: 'Tied low net — pushes.', amount: 'push', tone: 'pending' });
  }

  return { lines };
}
