import type { JunkKind, PlayerId, SettlementLine } from '../../types';
import { money, RoundContext } from '../context';
import type { Ledger } from '../ledger';

/** `label` is the chip's face; `name` is how it reads in a sentence, such as a control's accessible name. */
export const MANUAL_JUNK: { kind: JunkKind; label: string; name: string; hint: string }[] = [
  { kind: 'greenie', label: 'GREENIE', name: 'Greenie', hint: 'Closest on a par 3 and made par' },
  { kind: 'sandie', label: 'SANDIE', name: 'Sandie', hint: 'Up and down from the bunker' },
  { kind: 'chipIn', label: 'CHIP-IN', name: 'Chip-in', hint: 'Holed from off the green' },
  { kind: 'polie', label: 'POLIE', name: 'Polie', hint: 'Inside the flagstick and made it' },
];

/** Gross-to-par junk, and what it multiplies the stake by. */
function autoJunk(gross: number, par: number): { label: string; multiplier: number } | null {
  const diff = gross - par;
  if (diff <= -3) return { label: 'albatross', multiplier: 3 };
  if (diff === -2) return { label: 'eagle', multiplier: 2 };
  if (diff === -1) return { label: 'birdie', multiplier: 1 };
  return null;
}

export interface JunkEvent {
  hole: number;
  playerId: PlayerId;
  label: string;
  multiplier: number;
  /** Manual junk can be untapped; birdies cannot. */
  manual: boolean;
}

/** Every junk item claimed so far, in hole order. Used by both settlement and the play screen. */
export function junkEvents(ctx: RoundContext): JunkEvent[] {
  const out: JunkEvent[] = [];
  for (let h = 0; h < ctx.holeCount; h++) {
    for (const id of ctx.ids) {
      const gross = ctx.gross(id, h);
      if (gross == null) continue;
      const auto = autoJunk(gross, ctx.par(h, id));
      if (auto) out.push({ hole: h, playerId: id, label: auto.label, multiplier: auto.multiplier, manual: false });
      for (const { kind, label } of MANUAL_JUNK) {
        if (ctx.hasJunk(h, id, kind)) {
          out.push({ hole: h, playerId: id, label: label.toLowerCase(), multiplier: 1, manual: true });
        }
      }
    }
  }
  return out;
}

/** Each junk item collects the stake (times its multiplier) from every other player. */
export function settleJunk(
  ctx: RoundContext,
  ledger: Ledger,
  stake: number,
): { lines: SettlementLine[] } {
  const others = ctx.ids.length - 1;
  const events = junkEvents(ctx);
  const lines: SettlementLine[] = [];

  for (const event of events) {
    const perPlayer = stake * event.multiplier;
    ledger.payAllTo(event.playerId, perPlayer);
    lines.push({
      text: `Hole ${event.hole + 1} — ${ctx.initials(event.playerId)} ${event.label}`,
      amount: money(perPlayer * others),
      tone: 'won',
    });
  }

  return { lines };
}
