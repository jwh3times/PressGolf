import type { PlayerId, SettlementLine } from '../../types';
import { money, RoundContext } from '../context';
import type { Ledger } from '../ledger';

export interface MatchStatus {
  /** Holes won by `a`. */
  aWins: number;
  bWins: number;
  /** Positive means `a` is up. */
  up: number;
  /** Highest played hole index in the range, or -1 if none. */
  lastPlayed: number;
  /** Every hole in the range has a score. */
  complete: boolean;
}

/** Hole-by-hole match play between two players over an inclusive hole range. */
export function matchStatus(
  ctx: RoundContext,
  a: PlayerId,
  b: PlayerId,
  from: number,
  to: number,
): MatchStatus {
  let aWins = 0;
  let bWins = 0;
  let lastPlayed = -1;
  let total = 0;
  let played = 0;
  for (let h = from; h <= to && h < ctx.holeCount; h++) {
    total++;
    if (!ctx.played(h)) continue;
    played++;
    lastPlayed = h;
    const x = ctx.net(a, h);
    const y = ctx.net(b, h);
    if (x == null || y == null) continue;
    if (x < y) aWins++;
    else if (y < x) bWins++;
  }
  return { aWins, bWins, up: aWins - bWins, lastPlayed, complete: total > 0 && played === total };
}

export interface NassauSegment {
  label: string;
  from: number;
  to: number;
}

/** Front / back / total, collapsing to a single match on a nine-hole course. */
export function nassauSegments(ctx: RoundContext): NassauSegment[] {
  const back = ctx.backRange;
  if (!back) {
    const [f, t] = ctx.frontRange;
    return [{ label: 'Match', from: f, to: t }];
  }
  const [ff, ft] = ctx.frontRange;
  return [
    { label: 'Front', from: ff, to: ft },
    { label: 'Back', from: back[0], to: back[1] },
    { label: 'Total', from: 0, to: ctx.holeCount - 1 },
  ];
}

export function settleNassau(
  ctx: RoundContext,
  ledger: Ledger,
  stake: number,
): { lines: SettlementLine[] } {
  const lines: SettlementLine[] = [];
  const segments = nassauSegments(ctx);
  const ids = ctx.ids;

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i];
      const b = ids[j];
      for (const seg of segments) {
        const status = matchStatus(ctx, a, b, seg.from, seg.to);
        if (status.lastPlayed < 0) continue; // nothing played in this segment yet
        if (status.up === 0) {
          lines.push({
            text: `${seg.label} — ${ctx.initials(a)} v ${ctx.initials(b)} all square`,
            amount: status.complete ? 'push' : 'live',
            tone: 'pending',
          });
          continue;
        }
        const winner = status.up > 0 ? a : b;
        const loser = status.up > 0 ? b : a;
        ledger.pay(loser, winner, stake);
        lines.push({
          text: `${seg.label} — ${ctx.initials(winner)} over ${ctx.initials(loser)}, ${Math.abs(
            status.up,
          )} up${status.complete ? '' : ' (running)'}`,
          amount: money(stake),
          tone: 'won',
        });
      }
    }
  }

  for (const press of ctx.round.presses) {
    const status = matchStatus(ctx, press.by, press.against, press.startHole, press.endHole);
    if (status.lastPlayed < 0) {
      lines.push({
        text: `Press from ${press.startHole + 1} — not yet under way`,
        amount: money(press.stake),
        tone: 'pending',
      });
      continue;
    }
    if (status.up === 0) {
      lines.push({
        text: `Press from ${press.startHole + 1} — ${ctx.initials(press.by)} v ${ctx.initials(
          press.against,
        )} all square`,
        amount: status.complete ? 'push' : 'live',
        tone: 'pending',
      });
      continue;
    }
    const winner = status.up > 0 ? press.by : press.against;
    const loser = status.up > 0 ? press.against : press.by;
    ledger.pay(loser, winner, press.stake);
    lines.push({
      text: `Press from ${press.startHole + 1} — ${ctx.initials(winner)} over ${ctx.initials(
        loser,
      )}, ${Math.abs(status.up)} up${status.complete ? '' : ' (running)'}`,
      amount: money(press.stake),
      tone: 'won',
    });
  }

  return { lines };
}
