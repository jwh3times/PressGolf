import type { Green, LatLng } from './types';

/** Mean radius of the earth, metres. Close enough over a golf hole. */
const EARTH_RADIUS_M = 6_371_008.8;
const METRES_PER_YARD = 0.9144;

const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function metresBetween(a: LatLng, b: LatLng): number {
  const dLat = radians(b.lat - a.lat);
  const dLng = radians(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Whole yards between two points. GPS is good to a few metres, so nothing finer is honest. */
export function yardsBetween(a: LatLng, b: LatLng): number {
  return Math.round(metresBetween(a, b) / METRES_PER_YARD);
}

export interface GreenYards {
  front: number | null;
  middle: number;
  back: number | null;
}

/** Yards from where you stand to each known point on a green. */
export function yardsToGreen(from: LatLng, green: Green): GreenYards {
  return {
    front: green.front ? yardsBetween(from, green.front) : null,
    middle: yardsBetween(from, green.middle),
    back: green.back ? yardsBetween(from, green.back) : null,
  };
}

/**
 * The worst GPS accuracy, in metres, a green may be marked with. Consumer GPS
 * manages 3–5 m in the open; past this a mark would put the middle of the
 * green somewhere on its fringe.
 */
export const MARK_ACCURACY_M = 15;

/** Whether a fix is good enough to mark a green. Web may report no accuracy at all, which is not. */
export function goodEnoughToMark(accuracy: number | null | undefined): boolean {
  return accuracy != null && accuracy <= MARK_ACCURACY_M;
}

/** The course's green for a hole, if one is known. */
export function greenFor(greens: Green[], holeNumber: number): Green | null {
  return greens.find((g) => g.number === holeNumber) ?? null;
}

/** The greens with one replaced or added, kept in hole order. */
export function withGreen(greens: Green[], green: Green): Green[] {
  return [...greens.filter((g) => g.number !== green.number), green].sort((a, b) => a.number - b.number);
}

/**
 * Greens imported from OpenStreetMap, laid over the course's own. A green
 * someone marked on the course or placed on a map is kept: they stood there,
 * and the map may be years old. An earlier import is replaced. `kept` lists the
 * holes where the import had a green but the course's own was kept.
 */
export function withImported(existing: Green[], imported: Green[]): { greens: Green[]; kept: number[] } {
  const own = existing.filter((g) => g.source !== 'osm');
  const ownHoles = new Set(own.map((g) => g.number));
  const added = imported.filter((g) => !ownHoles.has(g.number));
  return {
    greens: [...own, ...added].sort((a, b) => a.number - b.number),
    kept: imported.filter((g) => ownHoles.has(g.number)).map((g) => g.number),
  };
}
