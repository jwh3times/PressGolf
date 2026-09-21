import { FORMATS } from '../formats';
import type { Cents, Course, GameKey, GameResult, Player, Round, Settlement } from '../types';
import { GAME_KEYS } from '../types';
import { RoundContext } from './context';
import { Ledger, minimiseTransfers } from './ledger';
import { settleJunk } from './formats/junk';
import { settleMatch } from './formats/match';
import { settleNassau } from './formats/nassau';
import { settleStableford, settleStroke } from './formats/points';
import { settleSkins } from './formats/skins';
import { settleBestBall, settleVegas } from './formats/teams';
import { settleWolf } from './formats/wolf';

export * from './context';
export * from './ledger';
export { matchStatus, nassauSegments } from './formats/nassau';
export { junkEvents, MANUAL_JUNK } from './formats/junk';
export { stablefordTotals } from './formats/points';
export { validateTeams, vegasNumber } from './formats/teams';
export { wolfForHole, wolfPickForHole } from './formats/wolf';
export { allPairings, resolvePairings } from './formats/match';

/**
 * Runs every switched-on format over the round and nets the results down to the
 * fewest hand-offs.
 *
 * Order matters only for display — each format writes into the same ledger, so
 * the money is commutative.
 */
export function settleRound(round: Round, course: Course, roster: Player[]): Settlement {
  const ctx = new RoundContext(round, course, roster);
  const ledger = new Ledger(ctx.ids);
  const games: GameResult[] = [];

  for (const key of GAME_KEYS) {
    const config = round.games[key];
    if (!config?.on) continue;
    const meta = FORMATS[key];
    const result = runFormat(key, ctx, ledger, config.stake, round);
    games.push({
      key,
      name: meta.name,
      detail: meta.detail,
      stakeLabel: meta.stakeLabel,
      color: meta.color,
      ...result,
    });
  }

  const net = ledger.net();
  return {
    matrix: ledger.snapshot(),
    net,
    games,
    transfers: minimiseTransfers(net),
    thru: ctx.thru(),
  };
}

function runFormat(
  key: GameKey,
  ctx: RoundContext,
  ledger: Ledger,
  stake: Cents,
  round: Round,
): Pick<GameResult, 'lines' | 'carry' | 'blocked' | 'blockedReason'> {
  switch (key) {
    case 'nassau':
      return settleNassau(ctx, ledger, stake);
    case 'skins':
      return settleSkins(ctx, ledger, stake);
    case 'junk':
      return settleJunk(ctx, ledger, stake);
    case 'stableford':
      return settleStableford(ctx, ledger, stake, round.options);
    case 'bestball':
      return settleBestBall(ctx, ledger, stake, round.options);
    case 'wolf':
      return settleWolf(ctx, ledger, stake, round.options);
    case 'vegas':
      return settleVegas(ctx, ledger, stake, round.options);
    case 'match':
      return settleMatch(ctx, ledger, stake, round.options);
    case 'stroke':
      return settleStroke(ctx, ledger, stake);
  }
}

/**
 * Worst case for a single player if every remaining hole goes against them.
 *
 * This is deliberately conservative and format-specific rather than the
 * prototype's flat multipliers — a number on the "lock it in" button that
 * nobody can reproduce is worse than no number at all.
 */
export function maxExposure(round: Round, course: Course, roster: Player[]): Cents {
  const ctx = new RoundContext(round, course, roster);
  const n = ctx.ids.length;
  if (n < 2) return 0;
  const holes = ctx.holeCount;
  const opponents = n - 1;
  const g = round.games;
  let total = 0;

  // Nassau: three matches against each opponent, plus anything already pressed.
  if (g.nassau.on) {
    const segments = holes > 9 ? 3 : 1;
    total += g.nassau.stake * segments * opponents;
    total += round.presses
      .filter((p) => p.by === ctx.ids[0] || p.against === ctx.ids[0])
      .reduce((sum, p) => sum + p.stake, 0);
  }
  // Skins: lose every hole to somebody.
  if (g.skins.on) total += g.skins.stake * holes;
  // Junk: assume every opponent birdies every hole. Pessimistic on purpose.
  if (g.junk.on) total += g.junk.stake * holes * opponents;
  // Winner-takes-all pots.
  if (g.stableford.on) total += g.stableford.stake;
  if (g.stroke.on) total += g.stroke.stake;
  // Team games settle once per opposing side.
  if (g.bestball.on) total += g.bestball.stake * Math.max(1, round.options.teams.length - 1);
  if (g.wolf.on) total += g.wolf.stake * Math.max(1, round.options.wolfLoneMultiplier) * holes;
  // Vegas has no theoretical cap, so quote a realistic blow-up: 10 points a hole.
  if (g.vegas.on) total += g.vegas.stake * 10 * holes;
  if (g.match.on) {
    const pairings = (round.options.matchPairings ?? []).filter((p) => p.includes(ctx.ids[0]));
    total += g.match.stake * Math.max(1, pairings.length || opponents);
  }
  return total;
}

/** Total cents in motion right now, before netting — the "pot" figure on Home. */
export function potTotal(settlement: Settlement): Cents {
  let sum = 0;
  for (const from of Object.keys(settlement.matrix)) {
    for (const to of Object.keys(settlement.matrix[from])) sum += settlement.matrix[from][to];
  }
  return sum;
}
