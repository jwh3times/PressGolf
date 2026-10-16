import { HAZARD_KINDS } from './course-map';
import { greenFor, metresBetween } from './geo';
import type { Course, CourseFeature, Green, LatLng } from './types';

/**
 * One hole of the course map (#125), and the distances a player needs on it:
 * to the green, to a target, and to the front of, and past, every hazard
 * between. Everything here is a distance between two points, which the Rules
 * of Golf allow a device to show during a round (Rule 4.3a): no club advice,
 * nothing adjusted for slope or wind.
 */

const METRES_PER_DEGREE = 111_320;
const METRES_PER_YARD = 0.9144;
const toYards = (metres: number) => Math.round(metres / METRES_PER_YARD);

/** Ground nearer a hole's line than this belongs on its map. */
export const CORRIDOR_M = 60;
/** A player further than this from the hole is not playing it: distances are from the tee. */
export const ON_HOLE_M = 1000;

export interface HolePlan {
  number: number;
  /** Tee to green, as mapped; null when the course map has no line for the hole. */
  line: LatLng[] | null;
  /** Where the line starts: the back of the tees, as mappers draw it. */
  tee: LatLng | null;
  green: Green | null;
  /** What lies near the hole, and the course's edge. */
  features: CourseFeature[];
}

export type XY = [number, number];

/**
 * A flat frame for one hole, in metres: `origin` at (0, 0), `heading` (degrees
 * clockwise from north) pointing up the y axis, x to the right. Good to
 * centimetres over a golf hole.
 */
export interface Frame {
  toXY(p: LatLng): XY;
  toLatLng(xy: XY): LatLng;
}

export function frame(origin: LatLng, heading: number): Frame {
  const scale = Math.cos((origin.lat * Math.PI) / 180) * METRES_PER_DEGREE;
  const theta = (heading * Math.PI) / 180;
  const [sin, cos] = [Math.sin(theta), Math.cos(theta)];
  return {
    toXY: (p) => {
      const east = (p.lng - origin.lng) * scale;
      const north = (p.lat - origin.lat) * METRES_PER_DEGREE;
      return [east * cos - north * sin, east * sin + north * cos];
    },
    toLatLng: ([x, y]) => {
      const east = x * cos + y * sin;
      const north = -x * sin + y * cos;
      return { lat: origin.lat + north / METRES_PER_DEGREE, lng: origin.lng + east / scale };
    },
  };
}

/** Degrees clockwise from north, from `a` towards `b`. */
export function bearing(a: LatLng, b: LatLng): number {
  const east = (b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180);
  const north = b.lat - a.lat;
  return ((Math.atan2(east, north) * 180) / Math.PI + 360) % 360;
}

/** The nearest point to `p` on the segment `a`–`b`, in a flat frame. */
export function nearestOnSegment(p: XY, a: XY, b: XY): XY {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const length2 = dx * dx + dy * dy;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length2));
  return [a[0] + t * dx, a[1] + t * dy];
}

const distance = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Segments of an outline: a ring closes on itself, a line doesn't. */
export function segments(points: XY[], closed: boolean): [XY, XY][] {
  const out: [XY, XY][] = [];
  for (let i = 1; i < points.length; i++) out.push([points[i - 1], points[i]]);
  if (closed && points.length > 2) out.push([points[points.length - 1], points[0]]);
  return out;
}

export const isLine = (f: CourseFeature) => f.kind === 'holeLine' || f.kind === 'outOfBounds';

export function inside([x, y]: XY, polygon: XY[]): boolean {
  let within = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}

/** The nearest point of a feature to `p`, and how far it is. Inside an area is no distance at all. */
export function nearestOf(p: XY, points: XY[], closed: boolean): { at: XY; metres: number } {
  if (closed && inside(p, points)) return { at: p, metres: 0 };
  let best = { at: points[0], metres: Infinity };
  for (const [a, b] of segments(points, closed)) {
    const at = nearestOnSegment(p, a, b);
    const metres = distance(p, at);
    if (metres < best.metres) best = { at, metres };
  }
  return best;
}

/**
 * How far an outline comes to a line, edge to edge: a lake's corners can all
 * be far from the line while its shore runs right beside it. Zero when the
 * line runs into an area.
 */
function gap(points: XY[], closed: boolean, line: XY[]): number {
  if (closed && line.some((p) => inside(p, points))) return 0;
  const lineSegments = line.length === 1 ? [[line[0], line[0]] as [XY, XY]] : segments(line, false);
  let best = Infinity;
  for (const p of points) {
    for (const [a, b] of lineSegments) best = Math.min(best, distance(p, nearestOnSegment(p, a, b)));
  }
  for (const p of line) best = Math.min(best, nearestOf(p, points, closed).metres);
  return best;
}

/** Everything on the map for one hole: its line, its green, what lies near it, and the course's edge. */
export function holePlan(course: Course, number: number): HolePlan {
  const green = greenFor(course.greens, number);
  const line = course.features.find((f) => f.kind === 'holeLine' && f.hole === number)?.points ?? null;
  const spine = line ?? (green ? [green.middle] : []);
  if (spine.length === 0) return { number, line: null, tee: null, green, features: [] };

  const view = frame(spine[0], 0);
  const spineXY = spine.map(view.toXY);
  const features = course.features.filter((f) => {
    if (f.kind === 'courseEdge') return true;
    if (f.kind === 'holeLine') return f.hole === number;
    return gap(f.points.map(view.toXY), !isLine(f), spineXY) <= CORRIDOR_M;
  });
  return { number, line, tee: line ? line[0] : null, green, features };
}

/**
 * Where the distances are from. The phone, when it is on or near the hole;
 * otherwise the tee, so a hole can be looked over before playing it.
 */
export function vantage(plan: HolePlan, position: LatLng | null): { from: LatLng; fromTee: boolean } | null {
  const anchor = plan.green?.middle ?? plan.tee;
  if (position && anchor && metresBetween(position, anchor) <= ON_HOLE_M) return { from: position, fromTee: false };
  return plan.tee ? { from: plan.tee, fromTee: true } : null;
}

/**
 * Where to measure to when the player hasn't chosen: the next bend in the
 * hole's line ahead of them, as mappers draw the line through the landing
 * area, or the middle of the green. A dogleg's trouble is along its bend, not
 * along the straight line over the trees.
 */
export function defaultTarget(plan: HolePlan, from: LatLng): LatLng | null {
  const green = plan.green?.middle ?? plan.line?.at(-1) ?? null;
  if (!plan.line || plan.line.length < 3) return green;
  const view = frame(from, 0);
  const xy = plan.line.map(view.toXY);
  let at = 0;
  let best = Infinity;
  segments(xy, false).forEach(([a, b], i) => {
    const metres = distance([0, 0], nearestOnSegment([0, 0], a, b));
    if (metres < best) {
      best = metres;
      at = i;
    }
  });
  // The bends past the segment the player is on, ignoring one they are all but standing at.
  for (let i = at + 1; i < xy.length - 1; i++) {
    if (distance([0, 0], xy[i]) >= 40) return plan.line[i];
  }
  return green;
}

/**
 * The point on the hole's line `metres` short of the green, measured back
 * along the line: "150 out". Without a line, along the straight from `from`.
 */
export function pointShort(plan: HolePlan, from: LatLng, metres: number): LatLng | null {
  const green = plan.green?.middle ?? plan.line?.at(-1);
  if (!green) return null;
  const path = plan.line ? [...plan.line.slice(0, -1), green] : [from, green];
  const view = frame(green, 0);
  const xy = path.map(view.toXY);
  let left = metres;
  for (let i = xy.length - 1; i > 0; i--) {
    const length = distance(xy[i], xy[i - 1]);
    if (left <= length) {
      const t = left / length;
      return view.toLatLng([xy[i][0] + (xy[i - 1][0] - xy[i][0]) * t, xy[i][1] + (xy[i - 1][1] - xy[i][1]) * t]);
    }
    left -= length;
  }
  return null;
}

export type Side = 'left' | 'right' | 'across';

export interface HazardReading {
  feature: CourseFeature;
  /** Seen along the line from where you are to the target. */
  side: Side;
  /** Yards to the nearest part of it. Zero when you are in it. */
  front: number;
  /** Yards to the far end of it, in the direction of play. */
  back: number;
  /** Yards to clear it, flying along the line to the target. Only for a hazard across the line. */
  carry: number | null;
}

/** Hazards this far past the target still matter: a ball doesn't stop on a point. */
const PAST_TARGET_M = 30;
/** Hazards this far either side of the line are in play. */
const BESIDE_M = 40;

/**
 * Every bunker and penalty area in play between `from` and `target`, nearest
 * first. In play means within 40 m of the line and short of 30 m past the
 * target. Out of bounds is measured separately, from the target, by `edgesNear`.
 */
export function hazardsBetween(from: LatLng, target: LatLng, features: CourseFeature[]): HazardReading[] {
  const view = frame(from, bearing(from, target));
  const reach = view.toXY(target)[1];
  const out: HazardReading[] = [];
  for (const feature of features) {
    if (!HAZARD_KINDS.has(feature.kind) || feature.kind === 'outOfBounds') continue;
    const points = feature.points.map(view.toXY);
    const edges = segments(points, true);
    // Where the line of play, x = 0, crosses the outline, short of 30 m past the target.
    const crossings = edges
      .filter(([a, b]) => (a[0] <= 0) !== (b[0] <= 0))
      .map(([a, b]) => a[1] + ((b[1] - a[1]) * (0 - a[0])) / (b[0] - a[0]))
      .filter((y) => y >= 0 && y <= reach + PAST_TARGET_M);
    const inPlay = crossings.length > 0 || points.some(([x, y]) => Math.abs(x) <= BESIDE_M && y >= 0 && y <= reach + PAST_TARGET_M);
    if (!inPlay) continue;
    const nearest = nearestOf([0, 0], points, true);
    const far = points.reduce((best, p) => (p[1] > best[1] ? p : best));
    out.push({
      feature,
      side: crossings.length ? 'across' : nearest.at[0] < 0 ? 'left' : 'right',
      front: toYards(nearest.metres),
      back: toYards(distance([0, 0], far)),
      carry: crossings.length ? toYards(Math.max(...crossings)) : null,
    });
  }
  return out.sort((a, b) => a.front - b.front || a.back - b.back);
}

/** A hazard this close to the middle of the green guards it. */
export const GREENSIDE_M = 35;

/**
 * The bunkers and penalty areas guarding the green, read from `from`: what a
 * player weighing a go at the green needs, whatever they are aiming at now.
 */
export function aroundGreen(plan: HolePlan, from: LatLng): HazardReading[] {
  if (!plan.green) return [];
  const view = frame(plan.green.middle, 0);
  const guarding = plan.features.filter(
    (f) =>
      HAZARD_KINDS.has(f.kind) &&
      f.kind !== 'outOfBounds' &&
      nearestOf([0, 0], f.points.map(view.toXY), true).metres <= GREENSIDE_M,
  );
  return hazardsBetween(from, plan.green.middle, guarding);
}

export interface EdgeReading {
  kind: 'courseEdge' | 'outOfBounds';
  side: 'left' | 'right';
  /** Yards from the target to it. Zero when the target is past it. */
  yards: number;
}

/** Out of bounds this close to the target is worth knowing about. */
export const EDGE_NOTICE_M = 55;

/**
 * How close the course's edge and any out-of-bounds line come to the target,
 * and which side, looking from `from`. Nearest first, one reading per side and
 * kind. A target past the course's edge reads zero.
 */
export function edgesNear(from: LatLng, target: LatLng, features: CourseFeature[]): EdgeReading[] {
  const view = frame(from, bearing(from, target));
  const at = view.toXY(target);
  const found = new Map<string, EdgeReading>();
  for (const feature of features) {
    if (feature.kind !== 'courseEdge' && feature.kind !== 'outOfBounds') continue;
    const points = feature.points.map(view.toXY);
    const ring = feature.kind === 'courseEdge';
    // The boundary itself, not the ground it encloses: from inside a ring, the nearest point of its edge.
    let nearest = { at: points[0], metres: Infinity };
    for (const [a, b] of segments(points, ring)) {
      const point = nearestOnSegment(at, a, b);
      if (distance(at, point) < nearest.metres) nearest = { at: point, metres: distance(at, point) };
    }
    const metres = ring && !inside(at, points) ? 0 : nearest.metres;
    if (metres > EDGE_NOTICE_M) continue;
    const side = nearest.at[0] < at[0] ? 'left' : 'right';
    const key = `${feature.kind}/${side}`;
    const reading: EdgeReading = { kind: feature.kind, side, yards: toYards(metres) };
    if (!found.has(key) || found.get(key)!.yards > reading.yards) found.set(key, reading);
  }
  return [...found.values()].sort((a, b) => a.yards - b.yards);
}
