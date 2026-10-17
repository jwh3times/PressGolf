import { rank } from './bag';
import { bearing, frame, holePlan, inside, nearestOnSegment, segments, type Frame, type HolePlan, type XY } from './hole-map';
import { boundaries, teeForward } from './hole-strategy';
import {
  clubKind,
  GOLFERS,
  MISHIT_CARRY,
  MISHIT_DIRECTION,
  ROLL,
  ROLL_IN_ROUGH,
  ROLL_ON_GREEN,
  SAND_SPREAD,
  strokesToHoleOut,
  type Golfer,
  type Lie,
} from './shot-model';
import type { Club, Course, LatLng, TeeId, UsualScore } from './types';

/**
 * Club suggestions for a practice round (#146): which club to hit and where to
 * aim, from the bag's carries and the course map. Each club is simulated from
 * where the player stands, a few aim points across the target, with the
 * spread of shots of a golfer of their usual score; every finish is scored by
 * the strokes it leaves to hole out, with the Rules' penalties for water and
 * out of bounds; and the fewest expected strokes wins.
 *
 * This is club advice, which the Rules of Golf don't allow a device to give in
 * a round that counts (Rule 4.3a): callers show it only in a practice round,
 * or looking a course over outside one.
 */

export type { Lie } from './shot-model';

export interface SuggestionInput {
  course: Course;
  hole: number;
  /** The tee being played; the course's first when missing. */
  teeId?: TeeId | null;
  /** Where the shot is from; null for the tee. */
  from: LatLng | null;
  /** The lie, when the player has said; read from the map otherwise. */
  lie?: Lie;
  bag: Club[];
  usualScore: UsualScore;
  /** The same seed for the same spot gives the same answer, so it doesn't flicker. */
  seed: number;
}

/** Going for the green, laying up short of it, or off the tee, the driver or less. */
export type Approach = 'go' | 'layUp' | 'driver' | 'less';
export type Finish = 'green' | 'fairway' | 'rough' | 'sand' | 'water' | 'outOfBounds';

export interface AimPoint {
  lean: 'left' | 'centre' | 'right';
  /** "left-centre", across the green or the fairway; "10 yards left" where neither is mapped. */
  words: string;
  across: 'green' | 'fairway' | 'line';
}

export interface ShotOption {
  club: string;
  approach: Approach;
  aim: AimPoint;
  /** Where the club is aimed. */
  target: LatLng;
  /** Average strokes to hole out from here, this shot included. */
  expected: number;
  /** The worst likely outcome in words, "about 1 in 5 finds water"; null when nothing is likely enough. */
  odds: string | null;
  /** The share of shots finishing on each. */
  finishes: Record<Finish, number>;
  /** Yards past (positive) or short (negative) of the hole, on average along the line to it. */
  depthMiss: number;
  /** The median yards from the hole that shots finish. */
  medianLeave: number;
  /** Laying up, the yards the target leaves to the hole; null going for the green. */
  leaves: number | null;
  /** A ring around where about two in three shots finish. */
  pattern: LatLng[];
}

export type Caveat = 'trees' | 'littleMapped';

export interface ClubSuggestion {
  status: 'suggested' | 'partial' | 'noGreen' | 'noTee' | 'fewCarries' | 'onGreen';
  /** Where the shot is from: the given point, or the tee. */
  from: LatLng | null;
  lie: Lie;
  /** The player's lie rather than the map's. */
  liePicked: boolean;
  best: ShotOption | null;
  /** A different approach that costs little more, to choose your own risk. */
  second: ShotOption | null;
  /** Inside the shortest full swing: that club. */
  partial: string | null;
  /** A club with no carry that might suit the shot better. */
  missing: string | null;
  caveats: Caveat[];
}

const YARD = 0.9144;
const ORIGIN_XY: XY = [0, 0];
const SAMPLES = 400;
/** Fewer carries than this, and there is too little of the bag to choose from. */
export const MIN_CARRIES = 3;
/** A shot this much shorter than the shortest full swing is a part-swing, which isn't simulated. */
const PARTIAL_YARDS = 10;
/** A green without an outline: as deep as its front and back, or about 25 yards across. */
const DEFAULT_GREEN_RADIUS = 12.5 * YARD;
/** Clubs that would fly further than this past the green aren't worth trying. */
const PAST_GREEN = 40 * YARD;
/** Options this close in strokes count as level, and one leaving a full swing is preferred. */
const LEVEL = 0.1;
/** A second option costs at most this many strokes more. */
const SECOND_WITHIN = 0.33;
/** Aims this close in strokes are the same to the simulation's accuracy: the middlemost is said. */
const SAME_AIM = 0.03;
/** Odds below this aren't worth saying. */
const ODDS_FROM = 0.1;
/** A ring of 1.48 standard deviations holds about two in three of a two-dimensional normal. */
const TWO_IN_THREE = Math.sqrt(-2 * Math.log(1 / 3));
/** A yellow penalty area's drop: this far back on the line from the hole through where the ball crossed. */
const BACK_ON_LINE = 5;
/** How close a club's distance must come to the shot for no missing club to be worth mentioning. */
const NEAR_ENOUGH_YARDS = 5;

// ─── Random numbers ─────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The same draws for every club and aim, so they are compared on the same luck. */
function draws(seed: number): { direction: number; distance: number; mishit: number; mishitCarry: number }[] {
  const random = mulberry32(seed);
  return Array.from({ length: SAMPLES }, () => {
    const [u1, u2] = [random() || 1e-12, random()];
    const r = Math.sqrt(-2 * Math.log(u1));
    return { direction: r * Math.cos(2 * Math.PI * u2), distance: r * Math.sin(2 * Math.PI * u2), mishit: random(), mishitCarry: random() };
  });
}

// ─── The hole, flattened ────────────────────────────────────────────────────

interface Area {
  kind: string;
  ring: XY[];
  box: [number, number, number, number];
}

const boxOf = (ring: XY[]): Area['box'] => [
  Math.min(...ring.map((p) => p[0])),
  Math.min(...ring.map((p) => p[1])),
  Math.max(...ring.map((p) => p[0])),
  Math.max(...ring.map((p) => p[1])),
];
// The functions run for every simulated shot index their pairs, never destructure them: see `inside`.
const within = (p: XY, a: Area) => p[0] >= a.box[0] && p[0] <= a.box[2] && p[1] >= a.box[1] && p[1] <= a.box[3] && inside(p, a.ring);
const distance = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);

interface Ground {
  view: Frame;
  hole: XY;
  greenRadius: number;
  green: (p: XY) => boolean;
  areas: Area[];
  edges: Area[];
  outLines: [XY, XY][];
  path: XY[];
  /** What each square metre is, once asked: shots land in clusters, and outlines can run to hundreds of points. */
  known: Map<number, Surface>;
}

function groundFor(plan: HolePlan, start: LatLng): Ground {
  const middle = plan.green!.middle;
  const view = frame(start, bearing(start, middle));
  const hole = view.toXY(middle);
  const areas = plan.features
    .filter((f) => ['bunker', 'water', 'lateralWater', 'fairway', 'tee', 'green'].includes(f.kind))
    .map((f) => {
      const ring = f.points.map(view.toXY);
      return { kind: f.kind, ring, box: boxOf(ring) };
    });
  // The green's own outline, if it is mapped: the one the middle is in.
  const outline = areas.find((a) => a.kind === 'green' && within(hole, a));
  const { front, back } = plan.green!;
  const greenRadius = outline
    ? Math.max(...outline.ring.map((p) => distance(p, hole)))
    : front && back
      ? distance(view.toXY(front), view.toXY(back)) / 2
      : DEFAULT_GREEN_RADIUS;
  const lines = boundaries(plan);
  return {
    view,
    hole,
    greenRadius: outline ? Math.min(greenRadius, (outline.box[2] - outline.box[0] + outline.box[3] - outline.box[1]) / 4) : greenRadius,
    green: outline ? (p) => within(p, outline) : (p) => distance(p, hole) <= greenRadius,
    areas: areas.filter((a) => a.kind !== 'green'),
    edges: lines.filter((f) => f.kind === 'courseEdge').map((f) => {
      const ring = f.points.map(view.toXY);
      return { kind: 'courseEdge', ring, box: boxOf(ring) };
    }),
    outLines: lines.filter((f) => f.kind === 'outOfBounds').flatMap((f) => segments(f.points.map(view.toXY), false)),
    path: plan.line ? [...plan.line.slice(0, -1), middle].map(view.toXY) : [[0, 0], hole],
    known: new Map(),
  };
}

type Surface = 'green' | 'fairway' | 'tee' | 'rough' | 'sand' | 'water' | 'lateralWater' | 'outOfBounds';

/** What a point is, to the nearest metre. */
function groundAt(ground: Ground, p: XY): Surface {
  const i = Math.round(p[0]);
  const j = Math.round(p[1]);
  const key = i * 100_003 + j;
  let found = ground.known.get(key);
  if (found === undefined) {
    found = classify(ground, [i, j]);
    ground.known.set(key, found);
  }
  return found;
}

const isWater = (surface: string) => surface === 'water' || surface === 'lateralWater';

/**
 * What a point is: out of bounds first, then water, sand, the green, fairway
 * or tee; anything else is rough. Out of bounds is outside every part of the
 * course's edge: an import keeps each part of a course in pieces as its own.
 */
function classify(ground: Ground, p: XY): Surface {
  if (ground.edges.length > 0 && !ground.edges.some((e) => within(p, e))) return 'outOfBounds';
  let found: Surface = 'rough';
  for (const a of ground.areas) {
    if (!within(p, a)) continue;
    if (isWater(a.kind)) return a.kind as Surface;
    if (a.kind === 'bunker') found = 'sand';
    else if (found === 'rough') found = a.kind === 'tee' ? 'tee' : 'fairway';
  }
  if (found !== 'sand' && ground.green(p)) return 'green';
  return found;
}

function crosses(a: XY, b: XY, c: XY, d: XY): boolean {
  const side = (p: XY, q: XY, r: XY) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/** Where the flight from `a` to `b` first enters a penalty area: where a drop is taken from. */
function entry(ground: Ground, a: XY, b: XY): XY {
  let best = b;
  let nearest = Infinity;
  for (const area of ground.areas) {
    if (!isWater(area.kind)) continue;
    for (const [c, d] of segments(area.ring, true)) {
      if (!crosses(a, b, c, d)) continue;
      const den = (b[0] - a[0]) * (d[1] - c[1]) - (b[1] - a[1]) * (d[0] - c[0]);
      const t = ((c[0] - a[0]) * (d[1] - c[1]) - (c[1] - a[1]) * (d[0] - c[0])) / den;
      if (t < nearest) {
        nearest = t;
        best = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      }
    }
  }
  return best;
}

/** The point on the way ahead `metres` from the start in a straight line, or the hole when it is nearer than that. */
function ahead(ground: Ground, metres: number): XY {
  if (distance([0, 0], ground.hole) <= metres) return ground.hole;
  // The line of play ahead of the player: from where they are nearest it, on.
  let at = 0;
  let best = Infinity;
  segments(ground.path, false).forEach(([a, b], i) => {
    const m = distance([0, 0], nearestOnSegment([0, 0], a, b));
    if (m < best) [best, at] = [m, i];
  });
  const route: XY[] = [[0, 0], ...ground.path.slice(at + 1)];
  for (const [a, b] of segments(route, false)) {
    if (distance([0, 0], b) < metres) continue;
    // The point on a–b at `metres` from the start.
    let [lo, hi] = [0, 1];
    for (let k = 0; k < 30; k++) {
      const mid = (lo + hi) / 2;
      const p: XY = [a[0] + (b[0] - a[0]) * mid, a[1] + (b[1] - a[1]) * mid];
      if (distance([0, 0], p) < metres) lo = mid;
      else hi = mid;
    }
    return [a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo];
  }
  return ground.hole;
}

// ─── Aim points ─────────────────────────────────────────────────────────────

const WORDS = ['left edge', 'left-centre', 'centre', 'right-centre', 'right edge'];
const LEANS: AimPoint['lean'][] = ['left', 'left', 'centre', 'right', 'right'];

/** Where the fairway runs across the line through `base` square to `along`, as offsets right of it; null with none there. */
function fairwayAcross(ground: Ground, base: XY, along: XY): [number, number] | null {
  const right: XY = [along[1], -along[0]];
  const offsets: number[] = [];
  for (const area of ground.areas) {
    if (area.kind !== 'fairway') continue;
    for (const [c, d] of segments(area.ring, true)) {
      // Where the line base + s·right meets c–d.
      const den = right[0] * (d[1] - c[1]) - right[1] * (d[0] - c[0]);
      if (Math.abs(den) < 1e-9) continue;
      const s = ((c[0] - base[0]) * (d[1] - c[1]) - (c[1] - base[1]) * (d[0] - c[0])) / den;
      const t = right[0] !== 0 || right[1] !== 0 ? ((c[0] - base[0]) * right[1] - (c[1] - base[1]) * right[0]) / den : 0;
      if (t >= 0 && t <= 1) offsets.push(s);
    }
  }
  offsets.sort((a, b) => a - b);
  // The stretch of fairway the base is on, or the nearest one within 30 yards.
  let best: [number, number] | null = null;
  for (let i = 0; i + 1 < offsets.length; i += 2) {
    const [l, r] = [offsets[i], offsets[i + 1]];
    const gap = l > 0 ? l : r < 0 ? -r : 0;
    if (gap <= 30 * YARD && (!best || gap < (best[0] > 0 ? best[0] : best[1] < 0 ? -best[1] : 0))) best = [l, r];
  }
  return best;
}

function aimPoints(ground: Ground, base: XY, going: boolean): { at: XY; aim: AimPoint }[] {
  const length = distance([0, 0], base) || 1;
  const along: XY = [base[0] / length, base[1] / length];
  const right: XY = [along[1], -along[0]];
  const offset = (s: number): XY => [base[0] + right[0] * s, base[1] + right[1] * s];
  if (going) {
    const w = ground.greenRadius;
    return [-0.75, -0.4, 0, 0.4, 0.75].map((f, i) => ({ at: offset(f * w), aim: { lean: LEANS[i], words: WORDS[i], across: 'green' } }));
  }
  const fairway = fairwayAcross(ground, base, along);
  if (fairway) {
    const [l, r] = fairway;
    return [0.15, 0.33, 0.5, 0.67, 0.85].map((f, i) => ({ at: offset(l + (r - l) * f), aim: { lean: LEANS[i], words: WORDS[i], across: 'fairway' } }));
  }
  return [-20, -10, 0, 10, 20].map((yards, i) => ({
    at: offset(yards * YARD),
    aim: { lean: LEANS[i], words: yards === 0 ? 'down the line' : `${Math.abs(yards)} yards ${yards < 0 ? 'left' : 'right'}`, across: 'line' },
  }));
}

// ─── Simulating a shot ──────────────────────────────────────────────────────

/** A club with its carry typed: the only clubs a suggestion can use. */
type CarriedClub = Club & { carry: number };

interface Candidate {
  club: CarriedClub;
  approach: Approach;
  at: XY;
  aim: AimPoint;
}

const FINISHES: Finish[] = ['green', 'fairway', 'rough', 'sand', 'water', 'outOfBounds'];

function simulate(
  ground: Ground,
  golfer: Golfer,
  lie: Lie,
  candidate: Candidate,
  luck: ReturnType<typeof draws>,
): Omit<ShotOption, 'club' | 'approach' | 'aim' | 'odds'> {
  const spread = lie === 'rough' ? golfer.rough : lie === 'sand' ? SAND_SPREAD : 1;
  const carry = candidate.club.carry * YARD;
  const roll = ROLL[clubKind(candidate.club.name, candidate.club.carry)];
  const heading = Math.atan2(candidate.at[0], candidate.at[1]);
  const fromHere = strokesToHoleOut(golfer, distance([0, 0], ground.hole) / YARD, lie);
  const toHole: XY = [ground.hole[0] / (distance([0, 0], ground.hole) || 1), ground.hole[1] / (distance([0, 0], ground.hole) || 1)];
  const counts: Record<Finish, number> = { green: 0, fairway: 0, rough: 0, sand: 0, water: 0, outOfBounds: 0 };
  let total = 0;
  let depth = 0;
  const leaves: number[] = [];

  for (const d of luck) {
    const mishit = d.mishit < golfer.mishit;
    const angle = heading + (((mishit ? MISHIT_DIRECTION : 1) * golfer.directionSd * spread * d.direction) * Math.PI) / 180;
    const flight = mishit
      ? carry * (MISHIT_CARRY[0] + (MISHIT_CARRY[1] - MISHIT_CARRY[0]) * d.mishitCarry)
      : carry * (1 + golfer.distanceSd * spread * d.distance);
    const way: XY = [Math.sin(angle), Math.cos(angle)];
    const landing: XY = [way[0] * flight, way[1] * flight];
    const landed = groundAt(ground, landing);
    const share =
      landed === 'fairway' || landed === 'tee' ? roll : landed === 'rough' ? roll * ROLL_IN_ROUGH : landed === 'green' ? roll * ROLL_ON_GREEN : 0;
    const end: XY = [landing[0] + way[0] * flight * share, landing[1] + way[1] * flight * share];
    const ends = share > 0 ? groundAt(ground, end) : landed;
    const out = ends === 'outOfBounds' || ground.outLines.some((line) => crosses(ORIGIN_XY, end, line[0], line[1]));
    const wet = !out && (isWater(landed) || isWater(ends));

    let value: number;
    let finish: Finish;
    let rest = end;
    if (out) {
      // Stroke and distance: the penalty, and this shot again from here.
      value = 2 + fromHere;
      finish = 'outOfBounds';
    } else if (wet) {
      const crossed = entry(ground, ORIGIN_XY, isWater(landed) ? landing : end);
      const red = landed === 'lateralWater' || ends === 'lateralWater';
      // Red: beside where it crossed. Yellow: back on the line from the hole through it.
      const away = distance(crossed, ground.hole) || 1;
      const drop: XY = red
        ? crossed
        : [crossed[0] + ((crossed[0] - ground.hole[0]) / away) * BACK_ON_LINE, crossed[1] + ((crossed[1] - ground.hole[1]) / away) * BACK_ON_LINE];
      value = 2 + strokesToHoleOut(golfer, distance(drop, ground.hole) / YARD, 'rough');
      finish = 'water';
      rest = crossed;
    } else {
      finish = ends === 'tee' ? 'fairway' : (ends as Finish);
      value = 1 + strokesToHoleOut(golfer, distance(end, ground.hole) / YARD, lieOf(ends) === 'tee' ? 'fairway' : lieOf(ends));
    }
    counts[finish] += 1;
    total += value;
    depth += (rest[0] - ground.hole[0]) * toHole[0] + (rest[1] - ground.hole[1]) * toHole[1];
    leaves.push(distance(rest, ground.hole) / YARD);
  }

  leaves.sort((a, b) => a - b);
  const centre = carry * (1 + roll);
  const acrossR = TWO_IN_THREE * centre * Math.tan((golfer.directionSd * spread * Math.PI) / 180);
  const alongR = TWO_IN_THREE * golfer.distanceSd * spread * carry;
  const pattern = Array.from({ length: 24 }, (_, i) => {
    const t = (i / 24) * 2 * Math.PI;
    const [x, y] = [acrossR * Math.cos(t), centre + alongR * Math.sin(t)];
    const [s, c] = [Math.sin(heading), Math.cos(heading)];
    return ground.view.toLatLng([x * c + y * s, -x * s + y * c]);
  });
  const going = candidate.approach === 'go';
  return {
    target: ground.view.toLatLng(candidate.at),
    expected: total / luck.length,
    finishes: Object.fromEntries(FINISHES.map((f) => [f, counts[f] / luck.length])) as Record<Finish, number>,
    depthMiss: depth / luck.length / YARD,
    medianLeave: leaves[leaves.length >> 1],
    leaves: going ? null : Math.round(distance(candidate.at, ground.hole) / YARD),
    pattern,
  };
}

/** The worst outcome likely enough to say, in words. */
function oddsOf(finishes: Record<Finish, number>): string | null {
  const said: [Finish, string, string][] = [
    ['outOfBounds', 'goes out of bounds', 'go out of bounds'],
    ['water', 'finds water', 'find water'],
    ['sand', 'finds a bunker', 'find a bunker'],
  ];
  for (const [finish, one, many] of said) {
    const share = finishes[finish];
    if (share < ODDS_FROM) continue;
    if (share >= 0.45) return `about half ${many}`;
    return `about 1 in ${Math.max(2, Math.round(1 / share))} ${one}`;
  }
  return null;
}

// ─── Choosing ───────────────────────────────────────────────────────────────

/** The lie a ball has on a surface: the green, sand, a tee, fairway, or rough for anything else that isn't a penalty. */
function lieOf(surface: Surface): Lie | 'green' {
  return surface === 'green' || surface === 'sand' || surface === 'tee' || surface === 'fairway' ? surface : 'rough';
}

function startOf(input: SuggestionInput, plan: HolePlan): LatLng | null {
  if (input.from) return input.from;
  if (!plan.line) return null;
  // The tee being played, forward of the back of the tees by the difference in yards.
  const forward = teeForward(input.course, input.hole, input.teeId);
  const view = frame(plan.line[0], 0);
  const xy = plan.line.map(view.toXY);
  let left = forward;
  for (const [a, b] of segments(xy, false)) {
    const length = distance(a, b);
    if (left <= length) return view.toLatLng([a[0] + ((b[0] - a[0]) * left) / length, a[1] + ((b[1] - a[1]) * left) / length]);
    left -= length;
  }
  return plan.line[0];
}

/** The option with the fewest expected strokes. */
const cheapest = (options: ShotOption[]) => options.reduce((a, b) => (b.expected < a.expected ? b : a));

/** Which club to hit and where to aim, for the shot from `input.from`, or the tee. */
export function suggestShot(input: SuggestionInput): ClubSuggestion {
  const plan = holePlan(input.course, input.hole);
  const fairwayMapped = plan.features.some((f) => f.kind === 'fairway');
  const outcome = (status: ClubSuggestion['status'], from: LatLng | null, lie: Lie = 'tee', extra: Partial<ClubSuggestion> = {}): ClubSuggestion => ({
    status,
    from,
    lie,
    liePicked: input.lie != null,
    best: null,
    second: null,
    partial: null,
    missing: null,
    caveats: fairwayMapped ? ['trees'] : ['trees', 'littleMapped'],
    ...extra,
  });
  if (!plan.green) return outcome('noGreen', input.from);
  const start = startOf(input, plan);
  if (!start) return outcome('noTee', null);

  const ground = groundFor(plan, start);
  const read = input.from ? lieOf(groundAt(ground, ORIGIN_XY)) : 'tee';
  if (read === 'green') return outcome('onGreen', start, 'fairway');
  const lie = input.lie ?? read;

  const carried = input.bag.filter((c): c is CarriedClub => c.carry != null);
  if (carried.length < MIN_CARRIES) return outcome('fewCarries', start, lie);
  const toHole = distance([0, 0], ground.hole);
  const shortest = carried.reduce((a, b) => (b.carry < a.carry ? b : a));
  if (toHole / YARD < shortest.carry - PARTIAL_YARDS) return outcome('partial', start, lie, { partial: shortest.name });

  const golfer = GOLFERS[input.usualScore];
  const card = (input.course.tees.find((t) => t.id === input.teeId) ?? input.course.tees[0]).holes.find((h) => h.number === input.hole);
  const offTheTee = !input.from && (card?.par ?? 4) >= 4;
  const longest = carried.reduce((a, b) => (b.carry > a.carry ? b : a));
  const luck = draws(input.seed);

  const reachOf = (club: CarriedClub) => club.carry * YARD * (1 + ROLL[clubKind(club.name, club.carry)]);
  // Off the tee of a hole no club reaches, the choice is the driver or less; otherwise short of the green is laying up.
  const driverOrLess = offTheTee && reachOf(longest) < toHole - ground.greenRadius;
  const options: ShotOption[] = [];
  for (const club of carried) {
    const reach = reachOf(club);
    if (reach > toHole + ground.greenRadius + PAST_GREEN) continue;
    const going = reach >= toHole - ground.greenRadius;
    const base = going ? ground.hole : ahead(ground, reach);
    const approach: Approach = going ? 'go' : driverOrLess ? (club === longest ? 'driver' : 'less') : 'layUp';
    const aims = aimPoints(ground, base, going).map(({ at, aim }) => {
      const result = simulate(ground, golfer, lie, { club, approach, at, aim }, luck);
      return { club: club.name, approach, aim, odds: oddsOf(result.finishes), ...result };
    });
    // The club's best aim, the middlemost of those level with it.
    const top = Math.min(...aims.map((a) => a.expected));
    const middle = Math.floor(aims.length / 2);
    const levelAims = aims.map((a, i) => ({ a, i })).filter(({ a }) => a.expected <= top + SAME_AIM);
    options.push(levelAims.reduce((x, y) => (Math.abs(y.i - middle) < Math.abs(x.i - middle) ? y : x)).a);
  }
  if (options.length === 0) return outcome('fewCarries', start, lie);

  const lowest = Math.min(...options.map((o) => o.expected));
  // Among options level with the best, one that leaves a full swing next, or goes for the green.
  const fullSwing = (o: ShotOption) => o.leaves == null || o.leaves >= shortest.carry - NEAR_ENOUGH_YARDS;
  const level = options.filter((o) => o.expected <= lowest + LEVEL);
  const pool = level.some(fullSwing) ? level.filter(fullSwing) : level;
  const best = cheapest(pool);
  // A second option is another way to play it: never a lay-up to a part-swing.
  const others = options.filter((o) => o.approach !== best.approach && o.expected <= best.expected + SECOND_WITHIN && fullSwing(o));
  const second = others.length ? cheapest(others) : null;

  return {
    ...outcome('suggested', start, lie),
    best,
    second,
    missing: best.approach === 'go' ? missingClub(input.bag, carried, toHole / YARD, best.club) : null,
  };
}

/** A club with no carry, between the carried clubs either side of the shot, when the best club is some way off it. */
function missingClub(bag: Club[], carried: CarriedClub[], yards: number, chosen: string): string | null {
  const reach = (c: CarriedClub) => c.carry * (1 + ROLL[clubKind(c.name, c.carry)]);
  const picked = carried.find((c) => c.name === chosen)!;
  if (Math.abs(reach(picked) - yards) <= NEAR_ENOUGH_YARDS) return null;
  const longer = carried.filter((c) => reach(c) >= yards).sort((a, b) => reach(a) - reach(b))[0];
  const shorter = carried.filter((c) => reach(c) < yards).sort((a, b) => reach(b) - reach(a))[0];
  const [from, to] = [longer ? rank(longer.name) : -1, shorter ? rank(shorter.name) : Infinity];
  const gap = bag.find((c) => c.carry == null && rank(c.name) > from && rank(c.name) < to);
  return gap?.name ?? null;
}

// ─── In words ───────────────────────────────────────────────────────────────

/** The Score screen's line: "7 iron · aim left-centre · about 1 in 5 finds a bunker", or why there is none. */
export function suggestionLine(result: ClubSuggestion): string | null {
  if (result.status === 'suggested' && result.best) {
    const { club, aim, odds } = result.best;
    return [club, `aim ${aim.words}`, ...(odds ? [odds] : [])].join(' · ');
  }
  if (result.status === 'partial') return `Less than a full ${result.partial}`;
  if (result.status === 'fewCarries') return 'Add carries in your bag';
  if (result.status === 'noGreen') return 'Mark the green for suggestions';
  return null;
}

/** The second option's line: "or lay up: 9 iron to 100". */
export function secondLine(result: ClubSuggestion): string | null {
  const s = result.second;
  if (!s) return null;
  if (s.approach === 'go') return `or go for the green: ${s.club}`;
  if (s.approach === 'layUp') return `or lay up: ${s.club} to ${s.leaves}`;
  return `or ${s.club} off the tee`;
}

/** The course guide's line from the tee: "Off the tee: 3 wood, aim left-centre". */
export function teeLine(result: ClubSuggestion): string | null {
  if (result.status !== 'suggested' || !result.best) return null;
  return `Off the tee: ${result.best.club}, aim ${result.best.aim.words}`;
}

const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

/** Where to aim, as a sentence: "Aim at the left-centre of the green.", "Aim 10 yards left of the line." */
export function aimPhrase(aim: AimPoint): string {
  if (aim.across === 'line') return aim.words === 'down the line' ? 'Aim down the line.' : `Aim ${aim.words} of the line.`;
  return `Aim at the ${aim.words} of the ${aim.across}.`;
}

/** The odds, or the second option, as a sentence of their own: "About 1 in 5 finds a bunker." */
export const asSentence = (text: string | null) => (text ? sentence(text) : null);
