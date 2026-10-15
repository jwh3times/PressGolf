import type { Green, LatLng } from '../domain/types';

/**
 * Reading greens out of OpenStreetMap (#8).
 *
 * Mapped golf courses carry two things this needs: each hole as a line from tee
 * to green (`golf=hole`, numbered by `ref`), and each green as an outline
 * (`golf=green`). The middle of a green is its outline's centre; front and back
 * are where the line of play, carried on through that centre, crosses the
 * outline. Kept free of the network so it can be tested on real data.
 */

interface OsmPoint {
  lat: number;
  lon: number;
}

/** An element as Overpass returns it with `out geom tags`. */
export interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  tags?: Record<string, string>;
  geometry?: OsmPoint[];
  members?: { type: string; role: string; geometry?: OsmPoint[] }[];
}

export interface ImportedGreens {
  greens: Green[];
  /** Holes with no numbered line, or whose line doesn't reach a green. */
  missing: number[];
  /** Holes with more than one line carrying their number, such as at a 27-hole club. */
  ambiguous: number[];
}

/** A green whose outline is this far from the end of the hole's line is not that hole's. */
const NEAREST_GREEN_M = 30;

const METRES_PER_DEGREE = 111_320;

type XY = [number, number];

/** A flat projection in metres around `origin`. Good to centimetres over a golf hole. */
function projector(origin: OsmPoint) {
  const scale = Math.cos((origin.lat * Math.PI) / 180) * METRES_PER_DEGREE;
  return {
    to: (p: OsmPoint): XY => [(p.lon - origin.lon) * scale, (p.lat - origin.lat) * METRES_PER_DEGREE],
    from: ([x, y]: XY): LatLng => ({
      lat: round(origin.lat + y / METRES_PER_DEGREE),
      lng: round(origin.lon + x / scale),
    }),
  };
}

/** Seven decimal places is about a centimetre: all the precision there is. */
const round = (degrees: number) => Math.round(degrees * 1e7) / 1e7;

function holeNumber(element: OsmElement): number | null {
  const ref = element.tags?.ref?.trim() ?? '';
  return /^\d{1,2}$/.test(ref) ? Number(ref) : null;
}

/** A green's outline: a way's own, or a multipolygon's first outer ring. */
function outline(element: OsmElement): OsmPoint[] | null {
  const ring = element.type === 'relation'
    ? element.members?.find((m) => m.role === 'outer' && (m.geometry?.length ?? 0) >= 4)?.geometry
    : element.geometry;
  return ring && ring.length >= 4 ? ring : null;
}

function inside([x, y]: XY, polygon: XY[]): boolean {
  let within = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}

/** The area-weighted centre of an outline, or the average of its corners if it has no area. */
function centroid(polygon: XY[]): XY {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [x0, y0] = polygon[j];
    const [x1, y1] = polygon[i];
    const cross = x0 * y1 - x1 * y0;
    area += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area) < 1e-9) {
    return [
      polygon.reduce((sum, [x]) => sum + x, 0) / polygon.length,
      polygon.reduce((sum, [, y]) => sum + y, 0) / polygon.length,
    ];
  }
  return [cx / (3 * area), cy / (3 * area)];
}

/** Distances along the line `from + t·dir` at which it crosses the outline. */
function crossings(from: XY, dir: XY, polygon: XY[]): number[] {
  const out: number[] = [];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[j];
    const [bx, by] = polygon[i];
    const ex = bx - ax;
    const ey = by - ay;
    const denominator = dir[0] * ey - dir[1] * ex;
    if (Math.abs(denominator) < 1e-12) continue;
    const wx = ax - from[0];
    const wy = ay - from[1];
    const t = (wx * ey - wy * ex) / denominator;
    const u = (wx * dir[1] - wy * dir[0]) / denominator;
    if (u >= 0 && u <= 1) out.push(t);
  }
  return out;
}

/** The direction of play as the line arrives at the green: its last leg. */
function arrival(line: XY[]): XY | null {
  const end = line[line.length - 1];
  for (let i = line.length - 2; i >= 0; i--) {
    const dx = end[0] - line[i][0];
    const dy = end[1] - line[i][1];
    const length = Math.hypot(dx, dy);
    if (length > 1) return [dx / length, dy / length];
  }
  return null;
}

/**
 * Every hole's green that the map can account for, by hole number, for a
 * course of `holeCount` holes.
 */
export function greensFromOsm(elements: OsmElement[], holeCount: number): ImportedGreens {
  const lines = new Map<number, OsmPoint[][]>();
  for (const element of elements) {
    if (element.tags?.golf !== 'hole' || element.type !== 'way') continue;
    const number = holeNumber(element);
    if (number == null || number < 1 || number > holeCount || (element.geometry?.length ?? 0) < 2) continue;
    lines.set(number, [...(lines.get(number) ?? []), element.geometry!]);
  }
  const outlines = elements
    .filter((e) => e.tags?.golf === 'green')
    .map(outline)
    .filter((ring): ring is OsmPoint[] => ring != null);

  const result: ImportedGreens = { greens: [], missing: [], ambiguous: [] };
  for (let number = 1; number <= holeCount; number++) {
    const found = lines.get(number) ?? [];
    if (found.length > 1) {
      result.ambiguous.push(number);
      continue;
    }
    const green = found.length === 1 ? greenAtEnd(number, found[0], outlines) : null;
    if (green) result.greens.push(green);
    else result.missing.push(number);
  }
  return result;
}

function greenAtEnd(number: number, points: OsmPoint[], outlines: OsmPoint[][]): Green | null {
  const project = projector(points[points.length - 1]);
  const line = points.map(project.to);
  const end: XY = [0, 0];
  const dir = arrival(line);
  if (!dir) return null;

  let polygon: XY[] | null = null;
  let nearest = NEAREST_GREEN_M;
  for (const ring of outlines) {
    const candidate = ring.map(project.to);
    if (inside(end, candidate)) {
      polygon = candidate;
      break;
    }
    const gap = Math.min(...candidate.map(([x, y]) => Math.hypot(x, y)));
    if (gap < nearest) {
      nearest = gap;
      polygon = candidate;
    }
  }
  if (!polygon) return null;

  const middle = centroid(polygon);
  const along = crossings(middle, dir, polygon);
  const before = along.filter((t) => t < 0);
  const after = along.filter((t) => t > 0);
  const at = (t: number): XY => [middle[0] + t * dir[0], middle[1] + t * dir[1]];
  const edges = before.length && after.length
    ? { front: project.from(at(Math.max(...before))), back: project.from(at(Math.min(...after))) }
    : { front: null, back: null };
  return { number, middle: project.from(middle), ...edges, source: 'osm' };
}
