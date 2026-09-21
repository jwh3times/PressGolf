import type { GameOptions, PlayerId, SettlementLine, WolfPick } from '../../types';
import { money, RoundContext } from '../context';
import type { Ledger } from '../ledger';

/**
 * Whose turn it is to be the Wolf on a given hole.
 *
 * The honour rotates through the tee order, so on hole 5 of a foursome it is
 * back to the first player. Stored picks win over this — if the group shuffled
 * the order mid-round, history should not silently rewrite itself.
 */
export function wolfForHole(ctx: RoundContext, hole: number): PlayerId | null {
  const stored = ctx.round.wolfPicks.find((p) => p.hole === hole);
  if (stored) return stored.wolf;
  if (ctx.ids.length === 0) return null;
  return ctx.ids[hole % ctx.ids.length];
}

export function wolfPickForHole(ctx: RoundContext, hole: number): WolfPick | null {
  return ctx.round.wolfPicks.find((p) => p.hole === hole) ?? null;
}

/** Best net ball on a side, or null when nobody on it has a score. */
function best(ctx: RoundContext, side: PlayerId[], hole: number): number | null {
  const nets = side.map((id) => ctx.net(id, hole)).filter((n): n is number => n != null);
  return nets.length ? Math.min(...nets) : null;
}

/**
 * Wolf, hole by hole. The Wolf either takes a partner — two against the rest —
 * or goes alone for a multiple of the stake. Ties push.
 *
 * A played hole with no recorded pick pays nothing and says so, rather than
 * guessing that the Wolf went alone.
 */
export function settleWolf(
  ctx: RoundContext,
  ledger: Ledger,
  stake: number,
  options: GameOptions,
): { lines: SettlementLine[]; blocked?: boolean; blockedReason?: string } {
  const lines: SettlementLine[] = [];
  let missing = 0;
  let banked = false;

  for (let h = 0; h < ctx.holeCount; h++) {
    if (!ctx.played(h)) continue;
    const pick = wolfPickForHole(ctx, h);
    if (!pick) {
      missing++;
      continue;
    }

    const wolfSide = pick.partner ? [pick.wolf, pick.partner] : [pick.wolf];
    const field = ctx.ids.filter((id) => !wolfSide.includes(id));
    if (field.length === 0) continue;

    const wolfBall = best(ctx, wolfSide, h);
    const fieldBall = best(ctx, field, h);
    if (wolfBall == null || fieldBall == null) continue;

    const lone = pick.partner == null;
    const multiplier = lone ? Math.max(1, options.wolfLoneMultiplier) : 1;
    const perPlayer = stake * multiplier;
    const label = lone
      ? `${ctx.initials(pick.wolf)} alone`
      : `${ctx.initials(pick.wolf)} + ${ctx.initials(pick.partner!)}`;

    if (wolfBall === fieldBall) {
      lines.push({ text: `Hole ${h + 1} — ${label}, halved`, amount: 'push', tone: 'pending' });
      continue;
    }

    const wolfWon = wolfBall < fieldBall;
    const winners = wolfWon ? wolfSide : field;
    const losers = wolfWon ? field : wolfSide;

    // A lone wolf has a separate bet running against each opponent, so the
    // exposure is symmetric: beat all three and collect three times, lose and
    // pay all three. Routing that through paySides would quietly cap the
    // downside at a single stake.
    if (lone) ledger.payEachAgainstEach(losers, winners, perPlayer);
    else ledger.paySides(losers, winners, perPlayer);

    const moved = lone ? perPlayer * losers.length * winners.length : perPlayer * losers.length;
    banked = true;
    lines.push({
      text: `Hole ${h + 1} — ${label} ${wolfWon ? 'takes it' : 'gets beaten'} with net ${Math.min(
        wolfBall,
        fieldBall,
      )}${lone ? ` (${multiplier}×)` : ''}`,
      amount: money(moved),
      tone: 'won',
    });
  }

  if (missing > 0) {
    lines.push({
      text: `${missing} played hole${missing > 1 ? 's have' : ' has'} no Wolf pick — nothing banked there`,
      amount: '—',
      tone: 'pending',
    });
  }

  // "Blocked" means the format is switched on but has moved no money — the group
  // needs to do something before it pays. A halved hole is a real result, so it
  // does not count as banked, but it does not count as blocked either.
  if (!banked) {
    return {
      lines: lines.length
        ? lines
        : [{ text: 'Pick a Wolf partner on the Score screen to start banking holes.', amount: '—', tone: 'pending' }],
      blocked: true,
      blockedReason: missing > 0 ? 'Played holes are missing a Wolf pick.' : 'No Wolf picks recorded yet.',
    };
  }

  return { lines };
}
