import { settleOuting } from '../engine';
import { splitEvenly } from '../engine/ledger';
import { splitIntoGroups } from '../factory';
import type { OutingSettlement } from '../types';
import { flatField, makeTestOuting } from './outing-helpers';
import { TEST_PAR } from './helpers';

const settle = (spec: Parameters<typeof makeTestOuting>[0]) => {
  const { outing, rounds, course, roster } = makeTestOuting(spec);
  return settleOuting(outing, rounds, course, roster);
};

/**
 * Pairwise bets are a closed system, but a pot is not: money handed into an
 * envelope has genuinely left the players until somebody wins it. So the books
 * balance to minus whatever is still sitting in the pots, not to zero.
 */
function expectBalanced(result: OutingSettlement) {
  const held = result.fieldGames.reduce((sum, g) => sum + g.unclaimedPot, 0);
  const net = Object.values(result.net).reduce((a, b) => a + b, 0);
  // Stated as a sum rather than `toBe(-held)`: with nothing held that compares
  // 0 against -0, which Object.is rejects.
  expect(net + held).toBe(0);
}

/** What one hole of an 18-hole pot is worth, in whole cents. */
const holeShares = (pot: number, holes = 18) => splitEvenly(pot, holes);

describe('splitting a field into groups', () => {
  it('makes foursomes', () => {
    const ids = Array.from({ length: 20 }, (_, i) => `p${i}`);
    const groups = splitIntoGroups(ids, 4);
    expect(groups).toHaveLength(5);
    expect(groups.every((g) => g.length === 4)).toBe(true);
  });

  it('never sends one player out alone', () => {
    const ids = Array.from({ length: 17 }, (_, i) => `p${i}`);
    const groups = splitIntoGroups(ids, 4);
    expect(groups.map((g) => g.length)).toEqual([4, 4, 4, 5]);
    expect(groups.flat()).toHaveLength(17);
  });

  it('handles a short field', () => {
    expect(splitIntoGroups(['a', 'b', 'c'], 4)).toEqual([['a', 'b', 'c']]);
    expect(splitIntoGroups([], 4)).toEqual([]);
  });
});

describe('field skins pot', () => {
  it('holds the pot until the whole field is in', () => {
    // Twenty players, only the first foursome has played anything.
    const cards = flatField(20, 5);
    for (let p = 4; p < 20; p++) cards[p] = Array(18).fill(null) as unknown as number[];
    cards[0][0] = 3; // p00 alone at the low score on hole 1

    const result = settle({
      cards,
      fieldGames: { fieldSkins: { on: true, buyIn: 2000 } },
    });
    const skins = result.fieldGames[0];
    expect(skins.pot).toBe(40000); // 20 x $20
    expect(skins.pendingHoles).toBe(18);
    // Nobody has been paid, but everyone is down their buy-in.
    expect(result.net['p00']).toBe(-2000);
    expect(skins.unclaimedPot).toBe(40000);
    expectBalanced(result);
  });

  it('splits the pot evenly across the skins won', () => {
    // Flat field of 20 on every hole; p00 wins holes 1 and 2 outright.
    const cards = flatField(20, 5);
    cards[0][0] = 4;
    cards[0][1] = 4;
    const result = settle({ cards, fieldGames: { fieldSkins: { on: true, buyIn: 2000 } } });
    const skins = result.fieldGames[0];

    expect(skins.pendingHoles).toBe(0);
    // Two skins, both to p00, so p00 takes the whole $400 pot back.
    expect(skins.payouts['p00']).toBe(40000);
    expect(result.net['p00']).toBe(38000); // $400 out, $20 buy-in in
    expect(result.net['p01']).toBe(-2000);
    expectBalanced(result);
  });

  it('shares the pot between different winners', () => {
    const cards = flatField(20, 5);
    cards[0][0] = 4; // p00 takes hole 1
    cards[1][1] = 4; // p01 takes hole 2
    cards[2][2] = 4; // p02 takes hole 3
    const result = settle({ cards, fieldGames: { fieldSkins: { on: true, buyIn: 2000 } } });
    const skins = result.fieldGames[0];

    // $400 across three skins: 13333 / 13333 / 13334, summing exactly to the pot.
    const paid = Object.values(skins.payouts).reduce((a, b) => a + b, 0);
    expect(paid).toBe(40000);
    expect(Object.keys(skins.payouts).sort()).toEqual(['p00', 'p01', 'p02']);
    expectBalanced(result);
  });

  it('carries the whole pot when nobody wins a hole', () => {
    const result = settle({
      cards: flatField(20, 5),
      fieldGames: { fieldSkins: { on: true, buyIn: 2000 } },
    });
    const skins = result.fieldGames[0];
    expect(skins.unclaimedPot).toBe(40000);
    expect(skins.lines.some((l) => l.text.includes('carries'))).toBe(true);
    // Everybody is down exactly their buy-in and the money is still in the pot.
    expect(result.net['p00']).toBe(-2000);
  });

  it('only charges the people who bought in', () => {
    const cards = flatField(20, 5);
    cards[0][0] = 4;
    const entrants = ['p00', 'p01', 'p02', 'p03'];
    const result = settle({
      cards,
      fieldGames: { fieldSkins: { on: true, buyIn: 2000, entrants } },
    });
    expect(result.fieldGames[0].pot).toBe(8000);
    expect(result.net['p04']).toBe(0); // not in the pot, untouched
    expect(result.net['p00']).toBe(6000); // $80 pot back, less his own $20
  });
});

describe('scats with the rabbit', () => {
  // These two isolate the per-hole allocation, so they switch the end-of-day
  // sweep off — otherwise the sole winner also hoovers up every unclaimed hole
  // and the per-hole figure is invisible.
  it('pays one hole when nothing is riding', () => {
    const cards = flatField(20, 5);
    cards[0][0] = 4;
    const result = settle({
      cards,
      fieldGames: { scats: { on: true, buyIn: 2000, carry: true, unclaimed: 'carry' } },
    });
    const scats = result.fieldGames[0];
    const shares = holeShares(40000);
    expect(scats.holes[0].winner).toBe('p00');
    expect(scats.holes[0].holesClaimed).toBe(1);
    expect(scats.payouts['p00']).toBe(shares[0]);
  });

  it('stacks blank holes onto the next winner', () => {
    // Holes 1-5 are tied by everybody; p00 wins hole 6 outright.
    const cards = flatField(20, 5);
    cards[0][5] = 4;
    const result = settle({
      cards,
      fieldGames: { scats: { on: true, buyIn: 2000, carry: true, unclaimed: 'carry' } },
    });
    const scats = result.fieldGames[0];
    const hole6 = scats.holes[5];
    const shares = holeShares(40000);

    expect(hole6.winner).toBe('p00');
    expect(hole6.holesClaimed).toBe(6);
    // Six holes' worth of the pot, to the cent.
    expect(scats.payouts['p00']).toBe(shares.slice(0, 6).reduce((a, b) => a + b, 0));
    expect(scats.lines[0].text).toContain('takes 6 holes');
  });

  it('freezes the rabbit behind a hole the field has not finished', () => {
    // The last foursome has no card at all, so no hole is complete.
    const cards = flatField(20, 5);
    for (let p = 16; p < 20; p++) cards[p] = Array(18).fill(null) as unknown as number[];
    cards[0][0] = 4;
    const result = settle({
      cards,
      fieldGames: { scats: { on: true, buyIn: 2000, carry: true } },
    });
    const scats = result.fieldGames[0];

    expect(scats.holes[0].complete).toBe(false);
    expect(scats.holes[0].waitingOn).toEqual(['p16', 'p17', 'p18', 'p19']);
    // Nothing paid: hole 1 is unresolved, so nothing behind it can pay either.
    expect(Object.keys(scats.payouts)).toHaveLength(0);
    expect(scats.unclaimedPot).toBe(40000);
  });

  it('decides scats on gross, not net', () => {
    // p01 is given a fat handicap; on gross he is nowhere, on net he would win.
    const cards = flatField(20, 5);
    cards[0][0] = 4; // p00 low gross
    const pops = Array(20).fill(0);
    pops[1] = 18; // a shot a hole for p01

    const gross = settle({
      cards,
      pops,
      fieldGames: { scats: { on: true, buyIn: 2000, useNet: false, carry: true } },
    });
    expect(gross.fieldGames[0].holes[0].winner).toBe('p00');

    const net = settle({
      cards,
      pops,
      fieldGames: { scats: { on: true, buyIn: 2000, useNet: true, carry: true } },
    });
    // On net p01 is at 4 and p00 at 4 — tied, so the hole carries instead.
    expect(net.fieldGames[0].holes[0].winner).toBeNull();
  });

  it('splits money nobody claimed among the day’s winners', () => {
    // p00 wins hole 1; holes 2-18 are all tied, so the rabbit runs out.
    const cards = flatField(20, 5);
    cards[0][0] = 4;
    const result = settle({
      cards,
      fieldGames: {
        scats: { on: true, buyIn: 2000, carry: true, unclaimed: 'splitAmongWinners' },
      },
    });
    const scats = result.fieldGames[0];
    // Sole winner scoops the lot once the leftovers are shared out.
    expect(scats.payouts['p00']).toBe(40000);
    expect(scats.unclaimedPot).toBe(0);
    expect(result.net['p00']).toBe(38000);
    expectBalanced(result);
  });

  it('carries the leftovers instead when told to', () => {
    const cards = flatField(20, 5);
    cards[0][0] = 4;
    const result = settle({
      cards,
      fieldGames: { scats: { on: true, buyIn: 2000, carry: true, unclaimed: 'carry' } },
    });
    const scats = result.fieldGames[0];
    const shares = holeShares(40000);
    expect(scats.payouts['p00']).toBe(shares[0]);
    expect(scats.unclaimedPot).toBe(40000 - shares[0]);
    expectBalanced(result);
  });

  it('never pays out more than the pot', () => {
    // A messy field: lots of outright winners across the card.
    const cards = flatField(20, 6);
    for (let h = 0; h < 18; h++) cards[h % 20][h] = 3;
    const result = settle({
      cards,
      fieldGames: { scats: { on: true, buyIn: 2000, carry: true } },
    });
    const scats = result.fieldGames[0];
    const paid = Object.values(scats.payouts).reduce((a, b) => a + b, 0);
    expect(paid + scats.unclaimedPot).toBe(scats.pot);
    expect(paid).toBeLessThanOrEqual(scats.pot);
    expectBalanced(result);
  });
});

describe('a whole outing', () => {
  it('nets foursome games and field pots into one set of hand-offs', () => {
    const cards = flatField(20, 5);
    // Give each group's first player a better card so Nassau moves inside groups.
    for (let g = 0; g < 5; g++) cards[g * 4] = Array(18).fill(4);
    // And one outright low score for the pots.
    cards[0][0] = 3;

    const { outing, rounds, course, roster } = makeTestOuting({
      cards,
      games: { nassau: { on: true, stake: 500 } },
      fieldGames: {
        fieldSkins: { on: true, buyIn: 2000 },
        scats: { on: true, buyIn: 1000, carry: true },
      },
    });
    const result = settleOuting(outing, rounds, course, roster);

    expect(result.groups).toHaveLength(5);
    expect(result.groups.every((g) => g.games.length === 1)).toBe(true);
    expect(result.fieldGames).toHaveLength(2);
    expect(result.fieldThru).toBe(18);
    expectBalanced(result);

    // Transfers move exactly what the winners are owed.
    const owed = Object.values(result.net)
      .filter((v) => v > 0)
      .reduce((a, b) => a + b, 0);
    expect(result.transfers.reduce((s, t) => s + t.amount, 0)).toBe(owed);
    expect(Object.values(result.net).every((v) => Number.isInteger(v))).toBe(true);
  });

  it('keeps each foursome’s games to that foursome', () => {
    const cards = flatField(8, 5);
    cards[0] = Array(18).fill(4); // p00 beats his own group
    const result = settle({
      cards,
      playerCount: 8,
      games: { nassau: { on: true, stake: 500 } },
    });

    // p00 collects from p01-p03 only; nobody in the second group is affected.
    expect(result.net['p00']).toBe(4500); // 3 opponents x 3 matches x $5
    expect(result.net['p04']).toBe(0);
    expect(result.net['p05']).toBe(0);
    expectBalanced(result);
  });

  it('reports the field as thru only what everybody has finished', () => {
    const cards = flatField(20, 5);
    // The last group has played nothing past hole 9.
    for (let p = 16; p < 20; p++) {
      for (let h = 9; h < 18; h++) (cards[p] as (number | null)[])[h] = null;
    }
    const result = settle({ cards, fieldGames: { fieldSkins: { on: true, buyIn: 2000 } } });
    expect(result.fieldThru).toBe(9);
    // The early groups are further along in their own games.
    expect(result.groups[0].thru).toBe(18);
  });

  it('waits on players who are in the field but not yet in a group', () => {
    const cards = flatField(20, 5);
    cards[0][0] = 4;
    const { outing, rounds, course, roster } = makeTestOuting({
      cards,
      fieldGames: { fieldSkins: { on: true, buyIn: 2000 } },
    });
    // Somebody signed up but never got put in a foursome.
    outing.field.push('p99');
    const extended = [...roster, { id: 'p99', name: 'Late Entry', initials: 'LE', color: '#fff' }];
    outing.fieldGames.fieldSkins.entrants = [...outing.field];

    const result = settleOuting(outing, rounds, course, extended);
    const skins = result.fieldGames[0];
    expect(skins.entrants).toContain('p99');
    expect(skins.holes[0].complete).toBe(false);
    expect(skins.holes[0].waitingOn).toEqual(['p99']);
  });

  it('holds together with 20 players, foursome games and both pots', () => {
    // Deterministic but uneven scoring so lots of formats have something to do.
    const cards = Array.from({ length: 20 }, (_, p) =>
      Array.from({ length: 18 }, (__, h) => TEST_PAR[h] + ((p * 7 + h * 3) % 4) - 1),
    );
    const { outing, rounds, course, roster } = makeTestOuting({
      cards,
      pops: Array.from({ length: 20 }, (_, i) => i % 12),
      games: {
        nassau: { on: true, stake: 500 },
        skins: { on: true, stake: 200 },
        junk: { on: true, stake: 200 },
        stroke: { on: true, stake: 1000 },
      },
      fieldGames: {
        fieldSkins: { on: true, buyIn: 2000 },
        scats: { on: true, buyIn: 1000, carry: true },
      },
    });
    const result = settleOuting(outing, rounds, course, roster);

    expectBalanced(result);
    expect(Object.keys(result.net)).toHaveLength(20);
    for (const game of result.fieldGames) {
      const paid = Object.values(game.payouts).reduce((a, b) => a + b, 0);
      expect(paid + game.unclaimedPot).toBe(game.pot);
    }
    const owed = Object.values(result.net)
      .filter((v) => v > 0)
      .reduce((a, b) => a + b, 0);
    expect(result.transfers.reduce((s, t) => s + t.amount, 0)).toBe(owed);
  });
});
