import {
  EDGE_NOTICE_M,
  GREENSIDE_M,
  ON_HOLE_M,
  bearing,
  frame,
  holePlan,
  inside,
  nearestOf,
  nearestOnSegment,
  segments,
  type HolePlan,
  type XY,
} from './hole-map';
import { metresBetween } from './geo';
import type { Course, CourseFeature, LatLng, TeeId } from './types';

/**
 * How a hole plays (#136): where the trouble is, read from the course map
 * alone, the same for everyone, like a yardage book. Nothing here depends on
 * where a player is or how their round is going, which is what lets the Rules
 * of Golf allow it during a counted round (Rule 4.3a).
 */

export type Zone = 'teeShot' | 'secondShot' | 'green';
export type StrategySide = 'short' | 'long' | 'left' | 'right' | 'across';
/** Worst first. */
export type Grade = 'worst' | 'bad' | 'someTrouble' | 'clear' | 'nothingMapped';
export type TroubleKind = 'outOfBounds' | 'courseEdge' | 'water' | 'lateralWater' | 'bunker';

export interface Cause {
  kind: TroubleKind;
  /** Yards from its nearest part to its furthest, the zone's way: off the tee, or to the green. Null around the green. */
  yards: [number, number] | null;
}

export interface SideReading {
  side: StrategySide;
  grade: Grade;
  /** What made the grade, worst first. Empty for a clear side. */
  causes: Cause[];
}

/**
 * Where to aim, from the grades alone: away from the worse side, and, around
 * the green, whether long or short is the safer miss. Line-of-play advice, so
 * only given when looking a course over or in a practice round.
 */
export interface Aim {
  lean: 'left' | 'centre' | 'right';
  /** Around the green only, when long and short differ. */
  safer: 'long' | 'short' | null;
}

export interface ZoneReading {
  zone: Zone;
  sides: SideReading[];
  /** Null unless advice was asked for, or when the map is silent on the zone. */
  aim: Aim | null;
}

export interface HoleStrategy {
  hole: number;
  zones: ZoneReading[];
}

const GRADE_OF: Record<TroubleKind, Grade> = {
  outOfBounds: 'worst',
  courseEdge: 'worst',
  water: 'bad',
  lateralWater: 'bad',
  bunker: 'someTrouble',
};
const RANK: Record<Grade, number> = { worst: 0, bad: 1, someTrouble: 2, clear: 3, nothingMapped: 4 };
/** Worst first; out of bounds someone drew before the course's edge, which is only likely. */
const KIND_ORDER: TroubleKind[] = ['outOfBounds', 'courseEdge', 'water', 'lateralWater', 'bunker'];

const HAZARDS = new Set(['bunker', 'water', 'lateralWater']);
const isHazard = (f: CourseFeature) => HAZARDS.has(f.kind);

function side(sideName: StrategySide, causes: Cause[], mapped: boolean): SideReading {
  if (causes.length === 0) return { side: sideName, grade: mapped ? 'clear' : 'nothingMapped', causes };
  const sorted = [...causes].sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  return { side: sideName, grade: GRADE_OF[sorted[0].kind], causes: sorted };
}

/**
 * The out-of-bounds that counts on this hole: its lines, less any limited to
 * other holes, and the course's edge unless the owner has drawn lines for it.
 */
function boundaries(plan: HolePlan): CourseFeature[] {
  const lines = plan.features.filter((f) => f.kind === 'outOfBounds' && (!f.holes?.length || f.holes.includes(plan.number)));
  if (lines.some((f) => f.source === 'map')) return lines;
  return [...lines, ...plan.features.filter((f) => f.kind === 'courseEdge')];
}

/** Short, long, left or right of a point seen from the green's middle, looking along the approach. */
function around([x, y]: XY): StrategySide {
  if (Math.abs(y) >= Math.abs(x)) return y < 0 ? 'short' : 'long';
  return x < 0 ? 'left' : 'right';
}

function greenZone(plan: HolePlan): ZoneReading | null {
  if (!plan.green || !plan.line) return null;
  const middle = plan.green.middle;
  const approach = plan.line.length > 2 ? plan.line[plan.line.length - 2] : plan.line[0];
  const view = frame(middle, bearing(approach, middle));
  const causes: Record<'short' | 'long' | 'left' | 'right', Cause[]> = { short: [], long: [], left: [], right: [] };
  let mapped = false;

  for (const f of plan.features) {
    if (!isHazard(f) && f.kind !== 'fairway') continue;
    const nearest = nearestOf([0, 0], f.points.map(view.toXY), true);
    if (nearest.metres > GREENSIDE_M) continue;
    mapped = true;
    if (isHazard(f) && nearest.metres > 0) causes[around(nearest.at) as keyof typeof causes].push({ kind: f.kind as TroubleKind, yards: null });
  }
  for (const f of boundaries(plan)) {
    const points = f.points.map(view.toXY);
    let best = { at: points[0], metres: Infinity };
    for (const [a, b] of segments(points, f.kind === 'courseEdge')) {
      const near = nearestOf([0, 0], [a, b], false);
      if (near.metres < best.metres) best = near;
    }
    if (best.metres <= EDGE_NOTICE_M) causes[around(best.at) as keyof typeof causes].push({ kind: f.kind as TroubleKind, yards: null });
  }

  return {
    zone: 'green',
    sides: (['short', 'long', 'left', 'right'] as const).map((s) => side(s, causes[s], mapped)),
    aim: null,
  };
}

const YARD = 0.9144;
/** Where tee shots land, in yards off the tee being played: most drives, without needing the player's bag. */
export const TEE_SHOT_YARDS: [number, number] = [180, 280];
/** Where a par 5's second shot comes down, in yards short of the middle of the green: where to lay up. */
export const SECOND_SHOT_YARDS: [number, number] = [80, 200];
/** The tee-shot zone stops this far short of the green, where the green's own reading takes over. */
const SHORT_OF_GREEN_YARDS = 40;
/** Hazards this far either side of the line of play are in play; the course edge, a little further. */
const BESIDE_M = 40;
/** Outlines are walked in steps this long, so a long straight shore is measured along its length, not at its corners. */
const STEP_M = 5;

/** The hole's line of play in a flat frame from its tee, ending at the middle of the green. */
interface Path {
  toXY: (p: { lat: number; lng: number }) => XY;
  points: XY[];
  /** Metres along the line to each point. */
  at: number[];
  length: number;
}

function pathOf(plan: HolePlan): Path | null {
  if (!plan.line || !plan.green) return null;
  const view = frame(plan.line[0], 0);
  const points = [...plan.line.slice(0, -1), plan.green.middle].map(view.toXY);
  const at = [0];
  for (let i = 1; i < points.length; i++) at.push(at[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return { toXY: view.toXY, points, at, length: at[at.length - 1] };
}

/** How far along the line `p` is, and how far off it: positive to the right, looking down the hole. */
function project(path: Path, p: XY): { along: number; off: number } {
  let best = { along: 0, off: Infinity };
  for (let i = 1; i < path.points.length; i++) {
    const [a, b] = [path.points[i - 1], path.points[i]];
    const q = nearestOnSegment(p, a, b);
    const metres = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (metres >= Math.abs(best.off)) continue;
    const cross = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    best = { along: path.at[i - 1] + Math.hypot(q[0] - a[0], q[1] - a[1]), off: cross > 0 ? -metres : metres };
  }
  return best;
}

/** Points along the line from `from` to `to` metres, a step apart. */
function walk(path: Path, from: number, to: number): XY[] {
  const out: XY[] = [];
  for (let along = from; along <= to; along += STEP_M) {
    const i = Math.max(1, path.at.findIndex((m) => m >= along));
    const [a, b] = [path.points[i - 1], path.points[i]];
    const t = (along - path.at[i - 1]) / (path.at[i] - path.at[i - 1] || 1);
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

/** An outline with a point at least every step along it. */
function densify(points: XY[], closed: boolean): XY[] {
  const out: XY[] = [];
  for (const [a, b] of segments(points, closed)) {
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / STEP_M));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  if (!closed && points.length) out.push(points[points.length - 1]);
  return out;
}

/**
 * The trouble left, right and across a stretch of the line of play, from
 * `from` to `to` metres along it. `yardsAt` turns metres along the line into
 * the yards the zone is read in.
 */
function laneZone(plan: HolePlan, path: Path, zone: Zone, [from, to]: [number, number], yardsAt: (along: number) => number): ZoneReading {
  const causes: Record<'left' | 'right' | 'across', Cause[]> = { left: [], right: [], across: [] };
  const line = walk(path, from, to);
  const within = (along: number) => along >= from && along <= to;
  const span = (alongs: number[]): [number, number] => {
    const [a, b] = [yardsAt(Math.min(...alongs)), yardsAt(Math.max(...alongs))];
    return a <= b ? [a, b] : [b, a];
  };
  let mapped = false;

  for (const f of plan.features) {
    if (!isHazard(f) && f.kind !== 'fairway') continue;
    const ring = f.points.map(path.toXY);
    const near = densify(ring, true)
      .map((p) => project(path, p))
      .filter((p) => Math.abs(p.off) <= BESIDE_M);
    const across = line.some((p) => inside(p, ring));
    const inBand = near.filter((p) => within(p.along));
    if (!across && inBand.length === 0) continue;
    mapped = true;
    if (!isHazard(f)) continue;
    const closest = inBand.reduce((best, p) => (Math.abs(p.off) < Math.abs(best.off) ? p : best), inBand[0] ?? near[0]);
    const which = across ? 'across' : closest.off < 0 ? 'left' : 'right';
    causes[which].push({ kind: f.kind as TroubleKind, yards: span(near.map((p) => p.along)) });
  }

  for (const f of boundaries(plan)) {
    const ring = f.kind === 'courseEdge';
    const points = f.points.map(path.toXY);
    const outside = ring ? line.filter((p) => !inside(p, points)) : [];
    if (outside.length) {
      causes.across.push({ kind: f.kind as TroubleKind, yards: span(outside.map((p) => project(path, p).along)) });
      continue;
    }
    const near = densify(points, ring)
      .map((p) => project(path, p))
      .filter((p) => Math.abs(p.off) <= EDGE_NOTICE_M);
    const inBand = near.filter((p) => within(p.along));
    if (inBand.length === 0) continue;
    for (const which of ['left', 'right'] as const) {
      const onSide = (p: { off: number }) => (p.off < 0) === (which === 'left');
      if (!inBand.some(onSide)) continue;
      const alongs = near.filter(onSide).map((p) => p.along);
      causes[which].push({ kind: f.kind as TroubleKind, yards: span([Math.max(from, Math.min(...alongs)), Math.min(to, Math.max(...alongs))]) });
    }
  }

  return { zone, sides: (['left', 'right', 'across'] as const).map((s) => side(s, causes[s], mapped)), aim: null };
}

/**
 * Metres from the back of the tees (where the hole's line starts, as mappers
 * draw it) to the tee being played: the longest tee's yards less this tee's.
 */
function teeForward(course: Course, number: number, teeId: TeeId | null | undefined): number {
  const tee = course.tees.find((t) => t.id === teeId) ?? course.tees[0];
  const yards = tee.holes.find((h) => h.number === number)?.yards ?? 0;
  const longest = Math.max(...course.tees.map((t) => t.holes.find((h) => h.number === number)?.yards ?? 0));
  return yards > 0 ? Math.max(0, longest - yards) * YARD : 0;
}

export interface StrategyOptions {
  /** The tee being played; the course's first tee when missing. */
  teeId?: TeeId | null;
  /** Include where to aim. Only outside a round, or in a practice round. */
  advice?: boolean;
}

/** The better of two sides, or neither when they are graded alike. */
function safer<T extends StrategySide>(zone: ZoneReading, a: T, b: T): T | null {
  const [ga, gb] = [zone.sides.find((s) => s.side === a)!.grade, zone.sides.find((s) => s.side === b)!.grade];
  if (RANK[ga] === RANK[gb]) return null;
  return RANK[ga] > RANK[gb] ? a : b;
}

function aimFor(zone: ZoneReading): Aim | null {
  if (zone.sides.every((s) => s.grade === 'nothingMapped')) return null;
  return {
    lean: safer(zone, 'left', 'right') ?? 'centre',
    safer: zone.zone === 'green' ? safer(zone, 'long', 'short') : null,
  };
}

/** How hole `number` plays, or null when the map has too little of it to say. */
export function holeStrategy(course: Course, number: number, { teeId, advice = false }: StrategyOptions = {}): HoleStrategy | null {
  const plan = holePlan(course, number);
  if (!plan.features.some((f) => isHazard(f) || f.kind === 'fairway')) return null;
  const green = greenZone(plan);
  const path = pathOf(plan);
  if (!green || !path) return null;

  const tee = course.tees.find((t) => t.id === teeId) ?? course.tees[0];
  const par = tee.holes.find((h) => h.number === number)?.par ?? 4;
  const forward = teeForward(course, number, teeId);
  const zones: ZoneReading[] = [];
  if (par >= 4) {
    const from = forward + TEE_SHOT_YARDS[0] * YARD;
    const to = Math.min(forward + TEE_SHOT_YARDS[1] * YARD, path.length - SHORT_OF_GREEN_YARDS * YARD);
    if (to > from) zones.push(laneZone(plan, path, 'teeShot', [from, to], (along) => Math.round((along - forward) / YARD)));
  }
  if (par >= 5) {
    const from = Math.max(forward, path.length - SECOND_SHOT_YARDS[1] * YARD);
    const to = path.length - SECOND_SHOT_YARDS[0] * YARD;
    if (to > from) zones.push(laneZone(plan, path, 'secondShot', [from, to], (along) => Math.round((path.length - along) / YARD)));
  }
  zones.push(green);
  return { hole: number, zones: advice ? zones.map((z) => ({ ...z, aim: aimFor(z) })) : zones };
}

const ZONES: Zone[] = ['teeShot', 'secondShot', 'green'];
/** Past this far from the tee, the tee shot has been played. */
export const OFF_THE_TEE_YARDS = 100;

/**
 * The zone whose reading fits the shot a player faces on hole `number`, for
 * the Score screen's one line: the tee shot until they are 100 yards off the
 * tee, then on a par 5 the second shot while 200 yards or more from the green,
 * then the green. Never earlier than `previous`, so a jumpy fix can't flick it
 * back; with no fix, or one far from the hole, it stays where it was. The
 * position only chooses which fixed reading to show. Null when the hole has
 * no strategy.
 */
export function facingZone(
  course: Course,
  number: number,
  position: LatLng | null,
  previous: Zone | null,
  options: StrategyOptions = {},
): Zone | null {
  const strategy = holeStrategy(course, number, options);
  if (!strategy) return null;
  const plan = holePlan(course, number);
  const has = new Set(strategy.zones.map((z) => z.zone));
  const green = plan.green!.middle;
  let wanted: Zone = 'teeShot';
  if (position && metresBetween(position, green) <= ON_HOLE_M) {
    if (metresBetween(position, plan.tee!) <= OFF_THE_TEE_YARDS * YARD) wanted = 'teeShot';
    else if (has.has('secondShot') && metresBetween(position, green) >= SECOND_SHOT_YARDS[1] * YARD) wanted = 'secondShot';
    else wanted = 'green';
  } else if (previous) {
    wanted = previous;
  }
  const from = Math.max(ZONES.indexOf(wanted), previous ? ZONES.indexOf(previous) : 0);
  return ZONES.slice(from).find((z) => has.has(z)) ?? 'green';
}

const ZONE_NAMES: Record<Zone, string> = { teeShot: 'Tee shot', secondShot: 'Second shot', green: 'Green' };
const SHORT_NAMES: Record<TroubleKind, string> = {
  outOfBounds: 'OB',
  courseEdge: 'likely OB',
  water: 'water',
  lateralWater: 'water',
  bunker: 'bunker',
};

/**
 * One line for a zone, worst trouble first and the clear sides last:
 * "Green: likely OB long · water short, left · bunker right".
 */
export function zoneSummary(zone: ZoneReading): string {
  const groups = new Map<string, StrategySide[]>();
  const graded = [...zone.sides].filter((s) => s.grade !== 'nothingMapped').sort((a, b) => RANK[a.grade] - RANK[b.grade]);
  for (const s of graded) {
    const label = s.grade === 'clear' ? 'clear' : SHORT_NAMES[s.causes[0].kind];
    groups.set(label, [...(groups.get(label) ?? []), s.side]);
  }
  const parts = [...groups].map(([label, sides]) => `${label} ${sides.join(', ')}`);
  return `${ZONE_NAMES[zone.zone]}: ${parts.length ? parts.join(' · ') : 'nothing mapped'}`;
}

const GRADE_NAMES: Record<Grade, string> = {
  worst: 'worst',
  bad: 'bad',
  someTrouble: 'some trouble',
  clear: 'clear',
  nothingMapped: 'nothing mapped',
};
const CAUSE_NAMES: Record<TroubleKind, string> = {
  outOfBounds: 'out of bounds',
  courseEdge: 'likely out of bounds (the course edge)',
  water: 'water',
  lateralWater: 'red penalty area',
  bunker: 'bunker',
};
const YARDS_WAY: Record<Zone, string> = { teeShot: 'off the tee', secondShot: 'to the green', green: '' };

export const gradeName = (grade: Grade) => GRADE_NAMES[grade];
export const zoneName = (zone: Zone) => ZONE_NAMES[zone];

/** What makes a side's grade, without the side: "Bunker, 230–250 off the tee". Empty for a clear side. */
export function sideCauses(zone: Zone, reading: SideReading): string {
  const text = reading.causes
    .map((c) => (c.yards ? `${CAUSE_NAMES[c.kind]}, ${c.yards[0]}–${c.yards[1]} ${YARDS_WAY[zone]}` : CAUSE_NAMES[c.kind]))
    .join('; ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A side as one sentence, for reading aloud: "Right: bad. Water, 260–290 off the tee." */
export function sideSentence(zone: Zone, reading: SideReading): string {
  const name = reading.side.charAt(0).toUpperCase() + reading.side.slice(1);
  const causes = sideCauses(zone, reading);
  return `${name}: ${GRADE_NAMES[reading.grade]}.${causes ? ` ${causes}.` : ''}`;
}

/** Where to aim, in words: "Favour the right half of the green. Long is safer than short." */
export function aimSentence(zone: Zone, aim: Aim): string {
  const where =
    zone === 'green'
      ? aim.lean === 'centre'
        ? 'Aim at the middle of the green.'
        : `Favour the ${aim.lean} half of the green.`
      : aim.lean === 'centre'
        ? 'Down the middle.'
        : `Favour the ${aim.lean} side.`;
  const depth = aim.safer ? ` ${aim.safer === 'long' ? 'Long is safer than short.' : 'Short is safer than long.'}` : '';
  return where + depth;
}
