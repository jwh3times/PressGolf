import type { GameOptions, PlayerId, SettlementLine, Team } from '../../types';
import { money, RoundContext } from '../context';
import type { Ledger } from '../ledger';

export interface TeamsValidation {
  ok: boolean;
  reason?: string;
  teams: Team[];
}

/**
 * Teams have to be real before four-ball or Vegas can settle: at least two of
 * them, every member actually in the round, and nobody on two sides at once.
 */
export function validateTeams(ctx: RoundContext, options: GameOptions): TeamsValidation {
  const teams = options.teams ?? [];
  if (teams.length < 2) return { ok: false, reason: 'Set the sides in Format before this pays out.', teams };
  const seen = new Set<PlayerId>();
  for (const team of teams) {
    for (const id of team) {
      if (!ctx.ids.includes(id)) return { ok: false, reason: 'A side has somebody who is not in this round.', teams };
      if (seen.has(id)) return { ok: false, reason: 'Somebody is on two sides at once.', teams };
      seen.add(id);
    }
  }
  return { ok: true, teams };
}

/** Lowest net ball on the side for this hole, or null if the side has no scores yet. */
function bestBall(ctx: RoundContext, team: Team, hole: number): number | null {
  const nets = team.map((id) => ctx.net(id, hole)).filter((n): n is number => n != null);
  return nets.length ? Math.min(...nets) : null;
}

/**
 * Four-ball: best ball of two, played as match play between every pair of sides.
 * Each player on the losing side ends the match down exactly `stake`.
 */
export function settleBestBall(
  ctx: RoundContext,
  ledger: Ledger,
  stake: number,
  options: GameOptions,
): { lines: SettlementLine[]; blocked?: boolean; blockedReason?: string } {
  const check = validateTeams(ctx, options);
  if (!check.ok) return { lines: [{ text: check.reason!, amount: '—', tone: 'pending' }], blocked: true, blockedReason: check.reason };

  const lines: SettlementLine[] = [];
  const { teams } = check;

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const A = teams[i];
      const B = teams[j];
      let aWins = 0;
      let bWins = 0;
      let played = 0;
      for (let h = 0; h < ctx.holeCount; h++) {
        if (!ctx.played(h)) continue;
        const a = bestBall(ctx, A, h);
        const b = bestBall(ctx, B, h);
        if (a == null || b == null) continue;
        played++;
        if (a < b) aWins++;
        else if (b < a) bWins++;
      }
      const label = `${A.map((id) => ctx.initials(id)).join(' + ')} v ${B.map((id) => ctx.initials(id)).join(' + ')}`;
      if (played === 0) {
        lines.push({ text: `${label} — not under way`, amount: '—', tone: 'pending' });
        continue;
      }
      if (aWins === bWins) {
        lines.push({ text: `${label} — ${aWins}–${bWins}, all square`, amount: 'push', tone: 'pending' });
        continue;
      }
      const winners = aWins > bWins ? A : B;
      const losers = aWins > bWins ? B : A;
      ledger.paySides([...losers], [...winners], stake);
      const complete = ctx.thru() === ctx.holeCount;
      lines.push({
        text: `${label} — ${Math.max(aWins, bWins)}–${Math.min(aWins, bWins)} to ${winners
          .map((id) => ctx.initials(id))
          .join(' + ')}${complete ? '' : ' (running)'}`,
        amount: money(stake),
        tone: 'won',
      });
    }
  }

  return { lines };
}

/**
 * Builds a side's Vegas number: the two net scores read as digits, low first.
 * A 4 and a 6 make 46. Double figures just concatenate — an 8 and a 10 make 810,
 * which is exactly the blow-up the game is designed to punish.
 */
export function vegasNumber(low: number, high: number): number {
  const [a, b] = low <= high ? [low, high] : [high, low];
  return Number(`${a}${b}`);
}

/** True when anyone on the side beat par on this hole — that flips the opponents. */
function sideHasBirdie(ctx: RoundContext, team: Team, hole: number): boolean {
  return team.some((id) => {
    const net = ctx.net(id, hole);
    return net != null && net < ctx.par(hole);
  });
}

/**
 * Vegas: the difference between the two sides' numbers, times the stake per point.
 * A birdie flips the other side's number high-digit-first, which is where the
 * damage comes from.
 */
export function settleVegas(
  ctx: RoundContext,
  ledger: Ledger,
  stake: number,
  options: GameOptions,
): { lines: SettlementLine[]; blocked?: boolean; blockedReason?: string } {
  const check = validateTeams(ctx, options);
  if (!check.ok) return { lines: [{ text: check.reason!, amount: '—', tone: 'pending' }], blocked: true, blockedReason: check.reason };

  const lines: SettlementLine[] = [];
  const { teams } = check;

  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      const A = teams[i];
      const B = teams[j];
      let points = 0; // positive means side A is up
      let holesCounted = 0;

      for (let h = 0; h < ctx.holeCount; h++) {
        if (!ctx.played(h)) continue;
        const aNets = A.map((id) => ctx.net(id, h)).filter((n): n is number => n != null);
        const bNets = B.map((id) => ctx.net(id, h)).filter((n): n is number => n != null);
        if (aNets.length < 2 || bNets.length < 2) continue;
        holesCounted++;

        const flipA = options.vegasFlipOnBirdie && sideHasBirdie(ctx, B, h);
        const flipB = options.vegasFlipOnBirdie && sideHasBirdie(ctx, A, h);
        const aLow = Math.min(...aNets);
        const aHigh = Math.max(...aNets);
        const bLow = Math.min(...bNets);
        const bHigh = Math.max(...bNets);
        const aNum = flipA ? Number(`${aHigh}${aLow}`) : vegasNumber(aLow, aHigh);
        const bNum = flipB ? Number(`${bHigh}${bLow}`) : vegasNumber(bLow, bHigh);
        points += bNum - aNum; // lower number is better, so the gap favours the low side
      }

      const label = `${A.map((id) => ctx.initials(id)).join(' + ')} v ${B.map((id) => ctx.initials(id)).join(' + ')}`;
      if (holesCounted === 0) {
        lines.push({ text: `${label} — not under way`, amount: '—', tone: 'pending' });
        continue;
      }
      if (points === 0) {
        lines.push({ text: `${label} — level on points`, amount: 'push', tone: 'pending' });
        continue;
      }
      const winners = points > 0 ? A : B;
      const losers = points > 0 ? B : A;
      const owed = Math.abs(points) * stake;
      ledger.paySides([...losers], [...winners], owed);
      lines.push({
        text: `${label} — ${Math.abs(points)} points to ${winners.map((id) => ctx.initials(id)).join(' + ')}`,
        amount: money(owed),
        tone: 'won',
      });
    }
  }

  return { lines };
}
