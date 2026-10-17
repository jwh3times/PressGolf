import type { UsualScore } from './types';

/**
 * How a golfer's shots spread, and what each finish is worth (#146): the
 * figures the club suggestions simulate with. Every number is published unless
 * it says it is an estimate, and each says where it comes from.
 *
 * - Broadie 2008: M. Broadie, "Assessing Golfer Performance Using Golfmetrics",
 *   Science and Golf V (2008), pp. 253–262. Groups by usual score: Am1 70–83,
 *   Am2 84–97, Am3 97–120.
 * - Broadie & Ko 2009: M. Broadie and S. Ko, "A simulation model to analyze the
 *   impact of distance and direction on golf scores", Proc. 2009 Winter
 *   Simulation Conference, pp. 3109–3120. The model's form: a normal error in
 *   direction, and a distance error proportional to the shot.
 * - Broadie 2012: M. Broadie, "Assessing Golfer Performance on the PGA TOUR",
 *   Interfaces 42(2), pp. 146–165, Appendix B, Table B.1.
 */

export type Lie = 'tee' | 'fairway' | 'rough' | 'sand';

export interface Golfer {
  /** Standard deviation of direction, degrees (Broadie 2008, Table 1, long tee shots). */
  directionSd: number;
  /**
   * Standard deviation of distance, as a share of the shot. Fitted so the
   * simulated median leave from 125 yards in the fairway is Broadie 2008's
   * Table 2 (8.7%, 12.0%, 17.3% for Am1–Am3); the tests hold it there.
   */
  distanceSd: number;
  /**
   * The share of swings that are mishits: Broadie 2008's awful shots a round,
   * A = 0.24 S − 17.1 (eq. 2), over the S − 36 swings that aren't putts.
   */
  mishit: number;
  /** How much wider shots spread from the rough: Broadie 2008, Table 2, rough over fairway median leave, 100–150 yards. */
  rough: number;
  /** The usual score the group stands for, which scales its strokes to hole out. */
  score: number;
  /** Putting: the feet from which half are holed, and from which two putts are average (Broadie 2008, Table 1). */
  putts: { half: number; two: number };
}

const AM1: Golfer = { directionSd: 5.4, distanceSd: 0.05, mishit: 0.034, rough: 10.4 / 8.7, score: 77, putts: { half: 5.8, two: 25 } };
const AM2: Golfer = { directionSd: 6.4, distanceSd: 0.083, mishit: 0.083, rough: 13.5 / 12.0, score: 90, putts: { half: 5.1, two: 19 } };
const AM3: Golfer = { directionSd: 8.1, distanceSd: 0.131, mishit: 0.122, rough: 18.4 / 17.3, score: 108, putts: { half: 3.8, two: 12 } };

const blend = (a: Golfer, b: Golfer): Golfer => {
  const mid = (x: number, y: number) => (x + y) / 2;
  return {
    directionSd: mid(a.directionSd, b.directionSd),
    distanceSd: mid(a.distanceSd, b.distanceSd),
    mishit: mid(a.mishit, b.mishit),
    rough: mid(a.rough, b.rough),
    score: mid(a.score, b.score),
    putts: { half: mid(a.putts.half, b.putts.half), two: mid(a.putts.two, b.putts.two) },
  };
};

/** The 70s are Broadie's 70–83 group, the 90s 84–97, the 100s 97–120; the 80s are halfway between the first two. */
export const GOLFERS: Record<UsualScore, Golfer> = { '70s': AM1, '80s': blend(AM1, AM2), '90s': AM2, '100s': AM3 };

/** A mishit flies this share of the club's carry, evenly anywhere between. An estimate. */
export const MISHIT_CARRY: [number, number] = [0.4, 0.8];
/** And strays this many times as far off line. An estimate. */
export const MISHIT_DIRECTION = 2;
/** A fairway bunker spreads full shots this much wider than the fairway. An estimate: Broadie publishes only greenside sand. */
export const SAND_SPREAD = 1.5;

export type ClubKind = 'wood' | 'long' | 'short' | 'wedge';

/**
 * Roll after landing on fairway, as a share of carry. Estimates, for tracked
 * shots (phase 5) to replace: about 7% for a driver is the one figure found
 * (TrackMan, second-hand), and the rest step down with the landing angle
 * TrackMan publishes for each club. Half that in rough, and a quarter on the
 * green, which holds a ball better than either.
 */
export const ROLL: Record<ClubKind, number> = { wood: 0.07, long: 0.05, short: 0.03, wedge: 0.01 };
export const ROLL_IN_ROUGH = 0.5;
export const ROLL_ON_GREEN = 0.25;

/** What kind of club a name is, for its roll: by name, or by carry for a name the bag doesn't know. */
export function clubKind(name: string, carry: number): ClubKind {
  const n = name.toLowerCase();
  if (n.includes('driver') || n.includes('wood')) return 'wood';
  if (n.includes('hybrid')) return 'long';
  const iron = n.match(/^(\d) iron$/);
  if (iron) return Number(iron[1]) <= 5 ? 'long' : 'short';
  if (['pw', 'gw', 'sw', 'lw'].includes(n) || n.includes('wedge')) return 'wedge';
  return carry >= 200 ? 'wood' : carry >= 165 ? 'long' : carry >= 115 ? 'short' : 'wedge';
}

// ─── Strokes to hole out ───────────────────────────────────────────────────

/** Yards, then tee, fairway, rough, sand: Broadie 2012, Table B.1 (PGA TOUR, 2003–2010). Tee starts at 100. */
const TOUR: [number, number | null, number, number, number][] = [
  [10, null, 2.18, 2.34, 2.43],
  [20, null, 2.4, 2.59, 2.53],
  [30, null, 2.52, 2.7, 2.66],
  [40, null, 2.6, 2.78, 2.82],
  [50, null, 2.66, 2.87, 2.92],
  [60, null, 2.7, 2.91, 3.15],
  [70, null, 2.72, 2.93, 3.21],
  [80, null, 2.75, 2.96, 3.24],
  [90, null, 2.77, 2.99, 3.24],
  [100, 2.92, 2.8, 3.02, 3.23],
  [120, 2.99, 2.85, 3.08, 3.21],
  [140, 2.97, 2.91, 3.15, 3.22],
  [160, 2.99, 2.98, 3.23, 3.28],
  [180, 3.05, 3.08, 3.31, 3.4],
  [200, 3.12, 3.19, 3.42, 3.55],
  [220, 3.17, 3.32, 3.53, 3.7],
  [240, 3.25, 3.45, 3.64, 3.84],
  [260, 3.45, 3.58, 3.74, 3.93],
  [280, 3.65, 3.69, 3.83, 4.0],
  [300, 3.71, 3.78, 3.9, 4.04],
  [320, 3.79, 3.84, 3.95, 4.12],
  [340, 3.86, 3.88, 4.02, 4.26],
  [360, 3.92, 3.95, 4.11, 4.41],
  [380, 3.96, 4.03, 4.21, 4.55],
  [400, 3.99, 4.11, 4.3, 4.69],
  [420, 4.02, 4.19, 4.4, 4.83],
  [440, 4.08, 4.27, 4.49, 4.97],
  [460, 4.17, 4.34, 4.58, 5.11],
  [480, 4.28, 4.42, 4.68, 5.25],
  [500, 4.41, 4.5, 4.77, 5.4],
  [520, 4.54, 4.58, 4.87, 5.54],
  [540, 4.65, 4.66, 4.96, 5.68],
  [560, 4.74, 4.74, 5.06, 5.82],
  [580, 4.79, 4.82, 5.15, 5.96],
  [600, 4.82, 4.89, 5.25, 6.1],
];
const COLUMN: Record<Lie, 1 | 2 | 3 | 4> = { tee: 1, fairway: 2, rough: 3, sand: 4 };

function tour(yards: number, lie: Lie): number {
  // The tee column starts at 100 yards; shorter, a tee shot plays like the fairway.
  const column = lie === 'tee' && yards < 100 ? 2 : COLUMN[lie];
  const value = (row: (typeof TOUR)[number]) => (row[column] ?? row[2]) as number;
  const d = Math.max(TOUR[0][0], Math.min(TOUR[TOUR.length - 1][0], yards));
  const i = Math.max(1, TOUR.findIndex((row) => row[0] >= d));
  // Indexed, not destructured: this runs for every simulated shot (see `inside` in the hole map).
  const a = TOUR[i - 1];
  const b = TOUR[i];
  return value(a) + ((value(b) - value(a)) * (d - a[0])) / (b[0] - a[0]);
}

/**
 * What a golfer adds to the tour's average from `yards`: Broadie 2012, p. 150,
 * from the tee, 2.38 + 0.0041d for the tour against 2.79 + 0.0066d for a
 * 90-golfer, scaled by how far the golfer's usual score is from 72, the score
 * the tour table stands for here. Applied from every lie: an estimate where
 * only the tee was published.
 */
const extra = (golfer: Golfer, yards: number) => ((golfer.score - 72) / (90 - 72)) * (0.41 + 0.0025 * yards);

/**
 * Average putts from `feet`, through Broadie 2008's two published points for
 * the golfer (half holed; two putts on average) and two further points for
 * long putts, twice and three times the two-putt distance, at 2.2 and 2.35:
 * estimates.
 */
function putts(golfer: Golfer, feet: number): number {
  const { half, two } = golfer.putts;
  const points: [number, number][] = [
    [0, 1],
    [half, 1.5],
    [two, 2],
    [two * 2, 2.2],
    [two * 3, 2.35],
  ];
  if (feet >= points[points.length - 1][0]) return 2.35;
  const i = points.findIndex((point) => point[0] >= feet);
  if (i <= 0) return 1;
  const a = points[i - 1];
  const b = points[i];
  return a[1] + ((b[1] - a[1]) * (feet - a[0])) / (b[0] - a[0]);
}

/** Average strokes to hole out: on the green from `yards` away by putting, otherwise from the lie. */
export function strokesToHoleOut(golfer: Golfer, yards: number, lie: Lie | 'green'): number {
  if (lie === 'green') return putts(golfer, yards * 3);
  return tour(yards, lie) + extra(golfer, yards);
}
