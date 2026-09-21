import type { Cents, PlayerId, Transfer } from '../types';

/**
 * Accumulates who owes whom, in cents, as each format settles.
 *
 * Everything funnels through `pay` so there is exactly one place where money
 * moves, and `split` is the only way a team stake ever gets divided — it fixes
 * the rounding so the two halves always add back to the whole.
 */
export class Ledger {
  private readonly matrix: Record<PlayerId, Record<PlayerId, Cents>> = {};

  constructor(private readonly ids: PlayerId[]) {
    for (const a of ids) {
      this.matrix[a] = {};
      for (const b of ids) this.matrix[a][b] = 0;
    }
  }

  /** `from` hands `to` this many cents. Non-positive amounts are ignored. */
  pay(from: PlayerId, to: PlayerId, amount: Cents): void {
    if (amount <= 0 || from === to) return;
    if (!this.matrix[from] || this.matrix[from][to] == null) return;
    this.matrix[from][to] += Math.round(amount);
  }

  /**
   * Settles a side-versus-side result so each loser ends up down exactly
   * `perPlayer` and each winner up exactly `perPlayer`.
   *
   * The naive `perPlayer / winners.length` loses a cent on odd stakes. Handing
   * the remainder to the same winner every time instead makes one partner
   * richer than the other, so the shares rotate by loser: on a $3.33 stake the
   * first loser's extra cent goes to the first winner, the second loser's to
   * the second, and the sides come out level.
   */
  paySides(losers: PlayerId[], winners: PlayerId[], perPlayer: Cents): void {
    if (perPlayer <= 0 || losers.length === 0 || winners.length === 0) return;
    const shares = splitEvenly(perPlayer, winners.length);
    losers.forEach((loser, li) => {
      winners.forEach((winner, wi) => {
        // Rotate which winner collects the odd cent as we work down the losers.
        const share = shares[(wi - li + shares.length * losers.length) % shares.length];
        this.pay(loser, winner, share);
      });
    });
  }

  /** A straight 1v1 bet between every member of two sides. */
  payEachAgainstEach(losers: PlayerId[], winners: PlayerId[], amount: Cents): void {
    for (const loser of losers) for (const winner of winners) this.pay(loser, winner, amount);
  }

  /** Every other player pays `winner` this amount. */
  payAllTo(winner: PlayerId, amount: Cents): void {
    for (const id of this.ids) this.pay(id, winner, amount);
  }

  snapshot(): Record<PlayerId, Record<PlayerId, Cents>> {
    const out: Record<PlayerId, Record<PlayerId, Cents>> = {};
    for (const a of this.ids) out[a] = { ...this.matrix[a] };
    return out;
  }

  /** Positive means the player is up for the round. */
  net(): Record<PlayerId, Cents> {
    const net: Record<PlayerId, Cents> = {};
    for (const id of this.ids) net[id] = 0;
    for (const from of this.ids) {
      for (const to of this.ids) {
        const amt = this.matrix[from][to];
        if (amt === 0) continue;
        net[from] -= amt;
        net[to] += amt;
      }
    }
    return net;
  }

  /** Total cents that changed hands, before netting. */
  gross(): Cents {
    let total = 0;
    for (const from of this.ids) for (const to of this.ids) total += this.matrix[from][to];
    return total;
  }
}

/** Splits `amount` into `parts` whole cents that sum back to `amount`. */
export function splitEvenly(amount: Cents, parts: number): Cents[] {
  if (parts <= 0) return [];
  const base = Math.floor(amount / parts);
  let remainder = amount - base * parts;
  return Array.from({ length: parts }, () => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return base + extra;
  });
}

/**
 * Reduces net positions to the fewest hand-offs: biggest debtor pays the biggest
 * creditor until one of them is square, repeat.
 *
 * Greedy is not provably minimal for every shape, but for a foursome it always
 * lands on the same answer as the optimal solution and nobody has to make change.
 */
export function minimiseTransfers(net: Record<PlayerId, Cents>): Transfer[] {
  const debtors = Object.entries(net)
    .filter(([, v]) => v < 0)
    .map(([id, v]) => ({ id, v }))
    .sort((a, b) => a.v - b.v);
  const creditors = Object.entries(net)
    .filter(([, v]) => v > 0)
    .map(([id, v]) => ({ id, v }))
    .sort((a, b) => b.v - a.v);

  const out: Transfer[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const amount = Math.min(-debtors[d].v, creditors[c].v);
    if (amount > 0) out.push({ from: debtors[d].id, to: creditors[c].id, amount });
    debtors[d].v += amount;
    creditors[c].v -= amount;
    if (debtors[d].v === 0) d++;
    if (creditors[c].v === 0) c++;
  }
  return out;
}
