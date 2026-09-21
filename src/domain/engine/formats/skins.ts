import type { SettlementLine } from '../../types';
import { money, RoundContext } from '../context';
import type { Ledger } from '../ledger';

/**
 * Low net wins the hole outright; ties push the pot forward.
 *
 * The winner collects `stake` from every other player, multiplied by how many
 * skins had piled up. A skin still riding when the round ends is dead money —
 * it is reported but never paid, which is how every group settles it.
 */
export function settleSkins(
  ctx: RoundContext,
  ledger: Ledger,
  stake: number,
): { lines: SettlementLine[]; carry: number } {
  const lines: SettlementLine[] = [];
  const others = ctx.ids.length - 1;
  let carry = 1;

  for (let h = 0; h < ctx.holeCount; h++) {
    if (!ctx.played(h)) continue;
    const nets = ctx.ids.map((id) => ({ id, net: ctx.net(id, h)! }));
    const low = Math.min(...nets.map((n) => n.net));
    const winners = nets.filter((n) => n.net === low);
    if (winners.length === 1) {
      const winner = winners[0].id;
      const perPlayer = stake * carry;
      ledger.payAllTo(winner, perPlayer);
      lines.push({
        text: `Hole ${h + 1} — ${ctx.initials(winner)} nets ${low}${
          carry > 1 ? `, ${carry} skins` : ''
        }`,
        amount: money(perPlayer * others),
        tone: 'won',
      });
      carry = 1;
    } else {
      carry++;
    }
  }

  if (carry > 1) {
    const riding = carry - 1;
    const nextHole = nextUnplayedHole(ctx);
    lines.push({
      text:
        nextHole == null
          ? `${riding} skin${riding > 1 ? 's' : ''} never claimed — dead money`
          : `${riding} skin${riding > 1 ? 's' : ''} riding into hole ${nextHole + 1}`,
      amount: money(stake * riding * others),
      tone: 'pending',
    });
  }

  return { lines, carry };
}

function nextUnplayedHole(ctx: RoundContext): number | null {
  for (let h = 0; h < ctx.holeCount; h++) if (!ctx.played(h)) return h;
  return null;
}
