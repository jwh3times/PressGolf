import * as fc from 'fast-check';
import { RoundContext, settleOuting, settleRound } from '../engine';
import { minimiseTransfers } from '../engine/ledger';
import { formatIndex, parseIndex } from '../handicap';
import type { PlayerId, Transfer } from '../types';
import { arbOuting, arbRound, PROPERTY_RUNS } from './arbitraries';

/**
 * Invariants that hold for every round, checked over generated ones.
 *
 * The worked examples in engine.test.ts say what a given round pays. These say
 * what no round may ever do.
 */

const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);

/** What each player ends up with once the transfers are made: received minus paid. */
function settledBy(transfers: Transfer[], ids: PlayerId[]): Record<PlayerId, number> {
  const out = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const t of transfers) {
    out[t.from] -= t.amount;
    out[t.to] += t.amount;
  }
  return out;
}

describe('settlement properties', () => {
  it('never mints or loses a cent: every round nets to zero, and the transfers repay it exactly', () => {
    fc.assert(
      fc.property(arbRound, ({ round, course, players }) => {
        const { net, transfers } = settleRound(round, course, players);
        expect(sum(Object.values(net))).toBe(0);
        expect(settledBy(transfers, round.playerIds)).toEqual(net);
      }),
      PROPERTY_RUNS,
    );
  });

  it('settles a card exactly as the same round played live', () => {
    fc.assert(
      fc.property(arbRound, ({ round, course, players }) => {
        const live = settleRound({ ...round, entry: 'live' }, course, players);
        const card = settleRound({ ...round, entry: 'card' }, course, players);
        expect(card).toEqual(live);
      }),
      PROPERTY_RUNS,
    );
  });

  it('never counts a written score as more than was written', () => {
    fc.assert(
      fc.property(arbRound, ({ round, course, players }) => {
        const ctx = new RoundContext(round, course, players);
        for (const id of round.playerIds) {
          for (let h = 0; h < ctx.holeCount; h++) {
            const written = round.scores[id][h];
            const counted = ctx.gross(id, h);
            if (written == null || counted == null) continue;
            // With no max score the card counts exactly what was written.
            expect(counted).toBe(round.options.maxScore === 'off' ? written : Math.min(counted, written));
          }
        }
      }),
      PROPERTY_RUNS,
    );
  });

  it('settles an outing so every cent is with a player or still in a pot, and each pot pays out what went in', () => {
    fc.assert(
      fc.property(arbOuting, ({ outing, rounds, course, players }) => {
        const settlement = settleOuting(outing, rounds, course, players);
        const riding = sum(settlement.fieldGames.map((pot) => pot.unclaimedPot));
        for (const pot of settlement.fieldGames) {
          expect(sum(Object.values(pot.payouts)) + sum(Object.values(pot.refunds)) + pot.unclaimedPot).toBe(
            pot.pot,
          );
          // Once the last card is in, only a pot whose leftovers carry keeps
          // anything: otherwise it was won, split, or handed back.
          const config = outing.fieldGames[pot.key];
          const mustBeEmpty = pot.pendingHoles === 0 && config.unclaimed !== 'carry';
          expect(mustBeEmpty ? pot.unclaimedPot : 0).toBe(0);
          // A refund is only ever a buy-in coming back to somebody who paid it.
          for (const [id, amount] of Object.entries(pot.refunds)) {
            expect(pot.entrants).toContain(id);
            expect(amount).toBeLessThanOrEqual(pot.buyIn);
          }
        }
        // A buy-in leaves the player when it goes into the pot, so money still
        // riding is the only thing that keeps the field's nets off zero.
        expect(sum(Object.values(settlement.net)) + riding).toBe(0);
        // With nothing left riding, the transfers repay every net exactly.
        const repaid = settledBy(settlement.transfers, Object.keys(settlement.net));
        expect(riding === 0 ? repaid : settlement.net).toEqual(settlement.net);
      }),
      PROPERTY_RUNS,
    );
  });
});

describe('transfer properties', () => {
  const arbNet = fc
    .array(fc.integer({ min: -100_000, max: 100_000 }), { minLength: 1, maxLength: 12 })
    .map((values) => {
      // Close the books: the last player takes whatever balances everyone else.
      const closed = [...values, 0 - sum(values) || 0];
      return Object.fromEntries(closed.map((v, i) => [`p${i}`, v]));
    });

  it('needs at most one fewer transfer than there are players with money to move, and repays every one', () => {
    fc.assert(
      fc.property(arbNet, (net) => {
        const transfers = minimiseTransfers(net);
        const moving = Object.values(net).filter((v) => v !== 0).length;
        expect(transfers.length).toBeLessThanOrEqual(Math.max(0, moving - 1));
        expect(transfers.every((t) => t.amount > 0)).toBe(true);
        expect(settledBy(transfers, Object.keys(net))).toEqual(net);
      }),
      PROPERTY_RUNS,
    );
  });
});

describe('handicap index properties', () => {
  it('reads back every index it writes, plus handicaps included', () => {
    // Tenths from +20.0 (stored as −20.0) to 54.0, the range parseIndex accepts.
    fc.assert(
      fc.property(fc.integer({ min: -200, max: 540 }), (tenths) => {
        const index = tenths / 10;
        expect(parseIndex(formatIndex(index))).toBe(index === 0 ? 0 : index);
      }),
      PROPERTY_RUNS,
    );
  });
});
