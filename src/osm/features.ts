import type { CourseFeature, FeatureKind, LatLng } from '../domain/types';
import type { OsmElement } from './greens';

/**
 * Reading a course map out of OpenStreetMap (#125): bunkers, water, fairways,
 * greens and tees as outlines, each hole's line from tee to green, and the
 * course's own boundary. Kept free of the network so it can be tested on real
 * data, like `greensFromOsm`.
 */

interface OsmPoint {
  lat: number;
  lon: number;
}

const GOLF_KINDS: Record<string, FeatureKind> = {
  bunker: 'bunker',
  water_hazard: 'water',
  lateral_water_hazard: 'lateralWater',
  // The newer name for either; a mapper who used it said nothing about the stakes' colour.
  penalty_area: 'water',
  fairway: 'fairway',
  green: 'green',
  tee: 'tee',
  out_of_bounds: 'outOfBounds',
  hole: 'holeLine',
};

/** What an element is on the map, or null for anything the hole map doesn't draw. */
export function kindOf(tags: Record<string, string> = {}): FeatureKind | null {
  if (tags.golf && GOLF_KINDS[tags.golf]) return GOLF_KINDS[tags.golf];
  // A pond nobody tagged as a hazard is still water to a ball.
  if (tags.natural === 'water') return 'water';
  if (tags.leisure === 'golf_course') return 'courseEdge';
  return null;
}

/** Kinds drawn as a line rather than an area. */
export const LINE_KINDS: ReadonlySet<FeatureKind> = new Set(['holeLine', 'outOfBounds']);

/** Detail finer than this, in metres, is dropped: GPS can't place a ball closer. */
export const SIMPLIFY_M = 0.5;
/** The most points one feature may keep, as the database allows. */
export const MAX_POINTS = 5000;

const METRES_PER_DEGREE = 111_320;
/** Six decimal places is about ten centimetres. */
const round = (degrees: number) => Math.round(degrees * 1e6) / 1e6;
const same = (a: OsmPoint, b: OsmPoint) => a.lat === b.lat && a.lon === b.lon;

/**
 * A multipolygon's outer rings, joined up. OpenStreetMap often splits one ring
 * across several ways, end to end, in either direction. A ring that never
 * closes is dropped: there is no telling what it encloses.
 */
export function outerRings(element: OsmElement): OsmPoint[][] {
  const pieces = (element.members ?? [])
    .filter((m) => m.role === 'outer' && (m.geometry?.length ?? 0) >= 2)
    .map((m) => [...m.geometry!]);
  const rings: OsmPoint[][] = [];
  while (pieces.length) {
    let ring = pieces.shift()!;
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      const end = ring[ring.length - 1];
      for (let i = 0; i < pieces.length; i++) {
        const piece = pieces[i];
        if (same(piece[0], end)) ring = [...ring, ...piece.slice(1)];
        else if (same(piece[piece.length - 1], end)) ring = [...ring, ...piece.slice(0, -1).reverse()];
        else continue;
        pieces.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (same(ring[0], ring[ring.length - 1]) && ring.length >= 4) rings.push(ring);
  }
  return rings;
}

/** Douglas–Peucker in metres, about the line's first point. Keeps both ends. */
export function simplify(points: OsmPoint[], toleranceM: number): OsmPoint[] {
  if (points.length <= 2) return points;
  const origin = points[0];
  const scale = Math.cos((origin.lat * Math.PI) / 180) * METRES_PER_DEGREE;
  const xy = points.map((p) => [(p.lon - origin.lon) * scale, (p.lat - origin.lat) * METRES_PER_DEGREE]);
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [from, to] = stack.pop()!;
    const [ax, ay] = xy[from];
    const [bx, by] = xy[to];
    const length = Math.hypot(bx - ax, by - ay);
    let worst = -1;
    let at = -1;
    for (let i = from + 1; i < to; i++) {
      const [px, py] = xy[i];
      const off = length < 1e-9
        ? Math.hypot(px - ax, py - ay)
        : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (off > worst) {
        worst = off;
        at = i;
      }
    }
    if (worst > toleranceM) {
      keep[at] = true;
      stack.push([from, at], [at, to]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** A ring or line, simplified until it fits, as the app stores it. */
function stored(points: OsmPoint[], area: boolean): LatLng[] | null {
  let tolerance = SIMPLIFY_M;
  let kept = simplify(points, tolerance);
  while (kept.length > MAX_POINTS + (area ? 1 : 0)) {
    tolerance *= 2;
    kept = simplify(points, tolerance);
  }
  // A ring is stored without repeating its first point.
  if (area && kept.length > 1 && same(kept[0], kept[kept.length - 1])) kept = kept.slice(0, -1);
  if (kept.length < (area ? 3 : 2)) return null;
  return kept.map((p) => ({ lat: round(p.lat), lng: round(p.lon) }));
}

const holeRef = (tags: Record<string, string> = {}) => (/^\d{1,2}$/.test(tags.ref?.trim() ?? '') ? Number(tags.ref.trim()) : null);

/**
 * Everything on a course's map that the hole map draws, for a course of
 * `holeCount` holes. A hole line two ways claim, as at a 27-hole club, is left
 * out, as `greensFromOsm` leaves out its green. Ids are stable across imports,
 * so importing again replaces a feature rather than adding a second one.
 */
export function featuresFromOsm(elements: OsmElement[], holeCount: number): CourseFeature[] {
  const refs = new Map<number, number>();
  for (const e of elements) {
    const ref = e.tags?.golf === 'hole' && e.type === 'way' ? holeRef(e.tags) : null;
    if (ref != null) refs.set(ref, (refs.get(ref) ?? 0) + 1);
  }

  const out: CourseFeature[] = [];
  for (const element of elements) {
    if (element.type === 'node') continue;
    const kind = kindOf(element.tags);
    if (!kind) continue;
    let hole: number | null = null;
    if (kind === 'holeLine') {
      hole = holeRef(element.tags);
      if (element.type !== 'way' || hole == null || hole < 1 || hole > holeCount || refs.get(hole) !== 1) continue;
    }
    const line = LINE_KINDS.has(kind);
    const rings = element.type === 'relation'
      ? outerRings(element)
      : element.geometry && (line || same(element.geometry[0], element.geometry[element.geometry.length - 1]))
        ? [element.geometry]
        : [];
    rings.forEach((ring, i) => {
      const points = stored(ring, !line);
      if (!points) return;
      const id = element.type === 'relation' ? `osm:relation/${element.id}#${i}` : `osm:way/${element.id}`;
      out.push({ id, kind, hole, points, source: 'osm' });
    });
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
