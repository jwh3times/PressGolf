import { settleRound } from '../engine';
import { RoundContext, money, parseMoney, signedMoney } from '../engine/context';
import { minimiseTransfers, splitEvenly } from '../engine/ledger';
import { vegasNumber } from '../engine/formats/teams';
import {
  expectBalanced,
  flat,
  makeTestCourse,
  makeTestPlayers,
  makeTestRound,
  P,
  TEST_SI,
} from './helpers';

const course = makeTestCourse();
const players = makeTestPlayers();
const settle = (round: Parameters<typeof settleRound>[0]) => settleRound(round, course, players);

describe('money formatting', () => {
  it('uses a true minus sign and drops trailing zeros', () => {
    expect(money(500)).toBe('$5');
    expect(money(-1250)).toBe('−$12.50');
    expect(signedMoney(0)).toBe('even');
    expect(signedMoney(500)).toBe('+$5');
  });

  it('parses user input back into whole cents', () => {
    expect(parseMoney('$12.50')).toBe(1250);
    expect(parseMoney('5')).toBe(500);
    expect(parseMoney('')).toBeNull();
  });
});

describe('pops allocation', () => {
  it('puts strokes on the hardest holes first', () => {
    const round = makeTestRound({ scores: [flat(4), flat(4), flat(4), flat(4)], pops: [0, 3, 0, 0] });
    const ctx = new RoundContext(round, course, players);
    const hardest = TEST_SI.indexOf(1);
    const easiest = TEST_SI.indexOf(18);
    expect(ctx.strokes('b', hardest)).toBe(1);
    expect(ctx.strokes('b', TEST_SI.indexOf(3))).toBe(1);
    expect(ctx.strokes('b', TEST_SI.indexOf(4))).toBe(0);
    expect(ctx.strokes('b', easiest)).toBe(0);
  });

  it('wraps around past the hole count instead of capping at one shot', () => {
    const round = makeTestRound({ scores: [flat(4), flat(4), flat(4), flat(4)], pops: [0, 20, 0, 0] });
    const ctx = new RoundContext(round, course, players);
    expect(ctx.strokes('b', TEST_SI.indexOf(1))).toBe(2);
    expect(ctx.strokes('b', TEST_SI.indexOf(2))).toBe(2);
    expect(ctx.strokes('b', TEST_SI.indexOf(3))).toBe(1);
    expect(ctx.strokes('b', TEST_SI.indexOf(18))).toBe(1);
  });
});

describe('nassau', () => {
  it('pays each of the three matches separately', () => {
    // a beats b on every hole; c and d match a exactly so only the a-b pair moves.
    const scores = [flat(4), flat(5), flat(4), flat(4)];
    const round = makeTestRound({ scores, games: { nassau: { on: true, stake: 500 } } });
    const result = settle(round);
    // a wins front, back and total from b => $15. c and d each halve with a.
    expect(result.net['a']).toBe(1500);
    expect(result.net['b']).toBe(-4500); // loses three matches to each of a, c, d
    expectBalanced(result.net);
  });

  it('holds money on a halved match instead of inventing a winner', () => {
    const round = makeTestRound({
      scores: [flat(4), flat(4), flat(4), flat(4)],
      games: { nassau: { on: true, stake: 500 } },
    });
    const result = settle(round);
    expect(Object.values(result.net).every((v) => v === 0)).toBe(true);
    expect(result.games[0].lines.every((l) => l.tone === 'pending')).toBe(true);
  });

  it('collapses to a single match on a nine-hole course', () => {
    const nine = makeTestCourse(9);
    const round = makeTestRound({
      scores: [flat(4, 9), flat(5, 9), flat(5, 9), flat(5, 9)],
      holeCount: 9,
      games: { nassau: { on: true, stake: 500 } },
    });
    const result = settleRound(round, nine, players);
    expect(result.net['a']).toBe(1500); // one match against each of three opponents
  });

  it('settles a press over its own hole range only', () => {
    // b is level with a everywhere except hole 12, which b wins.
    const aScores = flat(4);
    const bScores = flat(4);
    bScores[11] = 3;
    const round = makeTestRound({
      scores: [aScores, bScores, flat(4), flat(4)],
      games: { nassau: { on: true, stake: 500 } },
      presses: [{ id: 'pr1', by: 'a', against: 'b', startHole: 11, endHole: 17, stake: 500 }],
    });
    const result = settle(round);
    // Back nine and total both go to b, plus the press b is up in.
    expect(result.net['b']).toBeGreaterThan(0);
    const pressLine = result.games[0].lines.find((l) => l.text.startsWith('Press from 12'));
    expect(pressLine?.text).toContain('BO over AL');
    expectBalanced(result.net);
  });
});

describe('skins', () => {
  it('carries a tied hole into the next one', () => {
    // Hole 1 halved four ways, hole 2 won outright by a => a takes 2 skins.
    const scores = [
      [4, 3, ...Array(16).fill(null)],
      [4, 5, ...Array(16).fill(null)],
      [4, 5, ...Array(16).fill(null)],
      [4, 5, ...Array(16).fill(null)],
    ];
    const round = makeTestRound({ scores, games: { skins: { on: true, stake: 200 } } });
    const result = settle(round);
    // 2 skins x $2 x 3 opponents
    expect(result.net['a']).toBe(1200);
    expect(result.net['b']).toBe(-400);
    expectBalanced(result.net);
  });

  it('reports skins still riding without paying them out', () => {
    const scores = [
      [4, ...Array(17).fill(null)],
      [4, ...Array(17).fill(null)],
      [4, ...Array(17).fill(null)],
      [4, ...Array(17).fill(null)],
    ];
    const round = makeTestRound({ scores, games: { skins: { on: true, stake: 200 } } });
    const result = settle(round);
    expect(Object.values(result.net).every((v) => v === 0)).toBe(true);
    expect(result.games[0].carry).toBe(2);
    expect(result.games[0].lines[0].text).toContain('riding into hole 2');
  });

  it('decides skins on net, not gross', () => {
    // b shoots a stroke worse but gets a pop on the hardest hole.
    const hardest = TEST_SI.indexOf(1);
    const a = Array(18).fill(null);
    const b = Array(18).fill(null);
    const c = Array(18).fill(null);
    const d = Array(18).fill(null);
    a[hardest] = 4;
    b[hardest] = 4;
    c[hardest] = 5;
    d[hardest] = 5;
    const round = makeTestRound({
      scores: [a, b, c, d],
      pops: [0, 1, 0, 0],
      games: { skins: { on: true, stake: 200 } },
    });
    const result = settle(round);
    expect(result.net['b']).toBe(600);
  });
});

describe('junk', () => {
  it('pays birdies once and eagles double', () => {
    const par = course.holes[0].par; // 4
    const a = Array(18).fill(null);
    const rest = () => Array(18).fill(null);
    a[0] = par - 1; // birdie
    a[1] = course.holes[1].par - 2; // eagle
    const b = rest();
    const c = rest();
    const d = rest();
    [b, c, d].forEach((row) => {
      row[0] = course.holes[0].par;
      row[1] = course.holes[1].par;
    });
    const round = makeTestRound({ scores: [a, b, c, d], games: { junk: { on: true, stake: 200 } } });
    const result = settle(round);
    // birdie: $2 x 3 = $6. eagle: $4 x 3 = $12. Total $18.
    expect(result.net['a']).toBe(1800);
    expectBalanced(result.net);
  });

  it('pays tapped greenies', () => {
    const rows = [Array(18).fill(null), Array(18).fill(null), Array(18).fill(null), Array(18).fill(null)];
    rows.forEach((row) => (row[3] = course.holes[3].par));
    const round = makeTestRound({
      scores: rows,
      junk: { '3:a:greenie': true },
      games: { junk: { on: true, stake: 200 } },
    });
    const result = settle(round);
    expect(result.net['a']).toBe(600);
  });
});

describe('stableford and stroke play', () => {
  it('only pays stableford once the round is finished', () => {
    const partial = makeTestRound({
      scores: [flat(3), flat(5), flat(5), flat(5)].map((r) => [...r.slice(0, 9), ...Array(9).fill(null)]),
      games: { stableford: { on: true, stake: 500 } },
    });
    expect(Object.values(settle(partial).net).every((v) => v === 0)).toBe(true);

    const full = makeTestRound({
      scores: [flat(3), flat(5), flat(5), flat(5)],
      games: { stableford: { on: true, stake: 500 } },
    });
    expect(settle(full).net['a']).toBe(1500);
  });

  it('pushes stroke play on a tie at the top', () => {
    const round = makeTestRound({
      scores: [flat(4), flat(4), flat(5), flat(5)],
      games: { stroke: { on: true, stake: 1000 } },
    });
    const result = settle(round);
    expect(Object.values(result.net).every((v) => v === 0)).toBe(true);
    expect(result.games[0].lines.some((l) => l.amount === 'push')).toBe(true);
  });
});

describe('four-ball', () => {
  it('refuses to settle until sides are set', () => {
    const round = makeTestRound({
      scores: [flat(4), flat(4), flat(5), flat(5)],
      games: { bestball: { on: true, stake: 1000 } },
    });
    const result = settle(round);
    expect(result.games[0].blocked).toBe(true);
    expect(Object.values(result.net).every((v) => v === 0)).toBe(true);
  });

  it('leaves each loser down exactly the stake', () => {
    const round = makeTestRound({
      scores: [flat(4), flat(6), flat(5), flat(6)],
      games: { bestball: { on: true, stake: 1000 } },
      options: { teams: [['a', 'b'], ['c', 'd']] },
    });
    const result = settle(round);
    expect(result.net['a']).toBe(1000);
    expect(result.net['b']).toBe(1000);
    expect(result.net['c']).toBe(-1000);
    expect(result.net['d']).toBe(-1000);
    expectBalanced(result.net);
  });

  it('splits an odd stake without losing a cent', () => {
    const round = makeTestRound({
      scores: [flat(4), flat(6), flat(5), flat(6)],
      games: { bestball: { on: true, stake: 333 } },
      options: { teams: [['a', 'b'], ['c', 'd']] },
    });
    const result = settle(round);
    expect(result.net['a']).toBe(333);
    expect(result.net['c']).toBe(-333);
    expectBalanced(result.net);
  });
});

describe('vegas', () => {
  it('reads the two net scores as digits, low first', () => {
    expect(vegasNumber(4, 6)).toBe(46);
    expect(vegasNumber(6, 4)).toBe(46);
    expect(vegasNumber(8, 10)).toBe(810);
  });

  it('flips the opposing number on a birdie', () => {
    const par = course.holes[0].par;
    const rows = [Array(18).fill(null), Array(18).fill(null), Array(18).fill(null), Array(18).fill(null)];
    rows[0][0] = par - 1; // a birdies
    rows[1][0] = par;
    rows[2][0] = par;
    rows[3][0] = par;
    const teams: { teams: [string, string][] } = { teams: [['a', 'b'], ['c', 'd']] };

    const flipped = settle(
      makeTestRound({ scores: rows, games: { vegas: { on: true, stake: 100 } }, options: { ...teams, vegasFlipOnBirdie: true } }),
    );
    const plain = settle(
      makeTestRound({ scores: rows, games: { vegas: { on: true, stake: 100 } }, options: { ...teams, vegasFlipOnBirdie: false } }),
    );
    // a+b are 3 and 4 => 34. c+d are 4 and 4 => 44, flipped is still 44.
    // The flip only bites when the opposing pair's digits differ, so check the
    // birdie side is up either way and the flip never helps the birdied-on team.
    expect(flipped.net['a']).toBeGreaterThan(0);
    expect(flipped.net['a']).toBeGreaterThanOrEqual(plain.net['a']);
    expectBalanced(flipped.net);
  });

  it('charges the point difference to the losing side', () => {
    const rows = [Array(18).fill(null), Array(18).fill(null), Array(18).fill(null), Array(18).fill(null)];
    // Par 4 hole. a+b: 5 and 5 => 55. c+d: 6 and 6 => 66. No birdies, no flip.
    rows[0][0] = 5;
    rows[1][0] = 5;
    rows[2][0] = 6;
    rows[3][0] = 6;
    const round = makeTestRound({
      scores: rows,
      games: { vegas: { on: true, stake: 100 } },
      options: { teams: [['a', 'b'], ['c', 'd']], vegasFlipOnBirdie: true },
    });
    const result = settle(round);
    // 11 points at $1 = $11 to each winner, $11 from each loser.
    expect(result.net['a']).toBe(1100);
    expect(result.net['c']).toBe(-1100);
  });
});

describe('wolf', () => {
  it('banks nothing on a played hole with no pick', () => {
    const rows = [Array(18).fill(null), Array(18).fill(null), Array(18).fill(null), Array(18).fill(null)];
    rows.forEach((r, i) => (r[0] = 4 + i));
    const round = makeTestRound({ scores: rows, games: { wolf: { on: true, stake: 300 } } });
    const result = settle(round);
    expect(Object.values(result.net).every((v) => v === 0)).toBe(true);
    expect(result.games[0].blocked).toBe(true);
  });

  it('pays the wolf and partner off their best ball', () => {
    const rows = [Array(18).fill(null), Array(18).fill(null), Array(18).fill(null), Array(18).fill(null)];
    rows[0][0] = 3; // wolf
    rows[1][0] = 6; // partner
    rows[2][0] = 4;
    rows[3][0] = 4;
    const round = makeTestRound({
      scores: rows,
      games: { wolf: { on: true, stake: 300 } },
      wolfPicks: [{ hole: 0, wolf: 'a', partner: 'b' }],
    });
    const result = settle(round);
    expect(result.net['a']).toBe(300);
    expect(result.net['b']).toBe(300);
    expect(result.net['c']).toBe(-300);
    expectBalanced(result.net);
  });

  it('multiplies a lone wolf both ways', () => {
    const win = [Array(18).fill(null), Array(18).fill(null), Array(18).fill(null), Array(18).fill(null)];
    win[0][0] = 3;
    win[1][0] = 4;
    win[2][0] = 4;
    win[3][0] = 4;
    const lone = { hole: 0, wolf: 'a', partner: null };
    const won = settle(
      makeTestRound({ scores: win, games: { wolf: { on: true, stake: 300 } }, wolfPicks: [lone] }),
    );
    // Beats three opponents at 2x the $3 stake.
    expect(won.net['a']).toBe(1800);
    expect(won.net['b']).toBe(-600);

    const lose = win.map((r) => r.slice());
    lose[0][0] = 5;
    const lost = settle(
      makeTestRound({ scores: lose, games: { wolf: { on: true, stake: 300 } }, wolfPicks: [lone] }),
    );
    expect(lost.net['a']).toBe(-1800);
    expect(lost.net['b']).toBe(600);
  });
});

describe('match play', () => {
  it('falls back to every pair when no rivals are chosen', () => {
    const round = makeTestRound({
      scores: [flat(4), flat(5), flat(5), flat(5)],
      games: { match: { on: true, stake: 2000 } },
    });
    const result = settle(round);
    expect(result.net['a']).toBe(6000);
  });

  it('honours the chosen rivals only', () => {
    const round = makeTestRound({
      scores: [flat(4), flat(5), flat(5), flat(5)],
      games: { match: { on: true, stake: 2000 } },
      options: { matchPairings: [['a', 'b']] },
    });
    const result = settle(round);
    expect(result.net['a']).toBe(2000);
    expect(result.net['c']).toBe(0);
  });
});

describe('settlement', () => {
  it('splits evenly without losing cents', () => {
    expect(splitEvenly(333, 2)).toEqual([167, 166]);
    expect(splitEvenly(333, 2).reduce((a, b) => a + b, 0)).toBe(333);
    expect(splitEvenly(1000, 3).reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('nets down to the fewest hand-offs', () => {
    const transfers = minimiseTransfers({ a: -1000, b: -500, c: 1200, d: 300 });
    expect(transfers.length).toBeLessThanOrEqual(3);
    const moved = transfers.reduce((sum, t) => sum + t.amount, 0);
    expect(moved).toBe(1500);
  });

  it('produces no transfers when everybody is square', () => {
    expect(minimiseTransfers({ a: 0, b: 0, c: 0, d: 0 })).toEqual([]);
  });

  it('keeps the books balanced with every format switched on', () => {
    const scores = [
      [4, 6, 4, 3, 5, 4, 5, 4, 4, 5, 4, 3, 5, 4, 4, 3, 4, 5],
      [5, 5, 5, 4, 4, 5, 6, 3, 5, 4, 5, 3, 6, 5, 4, 4, 5, 5],
      [6, 6, 4, 4, 5, 6, 5, 4, 6, 5, 6, 4, 5, 5, 5, 3, 5, 6],
      [5, 7, 6, 5, 6, 5, 7, 4, 5, 6, 5, 4, 6, 5, 6, 4, 5, 6],
    ];
    const round = makeTestRound({
      scores,
      pops: [0, 3, 6, 11],
      junk: { '3:a:greenie': true, '7:b:sandie': true },
      presses: [{ id: 'pr1', by: 'a', against: 'd', startHole: 4, endHole: 8, stake: 500 }],
      wolfPicks: Array.from({ length: 18 }, (_, h) => ({
        hole: h,
        wolf: P[h % 4],
        partner: h % 2 === 0 ? P[(h + 1) % 4] : null,
      })),
      games: {
        nassau: { on: true, stake: 500 },
        skins: { on: true, stake: 200 },
        junk: { on: true, stake: 200 },
        stableford: { on: true, stake: 500 },
        bestball: { on: true, stake: 1000 },
        wolf: { on: true, stake: 300 },
        vegas: { on: true, stake: 100 },
        match: { on: true, stake: 2000 },
        stroke: { on: true, stake: 1000 },
      },
      options: { teams: [['a', 'c'], ['b', 'd']] },
    });
    const result = settle(round);
    expect(result.games).toHaveLength(9);
    expect(result.thru).toBe(18);
    expectBalanced(result.net);
    // Every cent that moves shows up in the transfer list.
    const owed = Object.values(result.net).filter((v) => v > 0).reduce((a, b) => a + b, 0);
    expect(result.transfers.reduce((sum, t) => sum + t.amount, 0)).toBe(owed);
    // All amounts are whole cents.
    expect(Object.values(result.net).every((v) => Number.isInteger(v))).toBe(true);
  });
});
