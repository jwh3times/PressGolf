import type { CourseFeature, FeatureKind } from './types';

/**
 * The course map (#125): what is where on the ground, for the hole map and the
 * distances to trouble. Greens' yardage points live apart, in `geo.ts`.
 */

const byId = (a: CourseFeature, b: CourseFeature) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * An import from OpenStreetMap laid over the course's map. What was drawn in
 * the app is kept, as greens marked on the course are: someone put it there on
 * purpose. An earlier import is replaced whole, so a bunker since grassed over
 * goes. Kept in id order, as the server returns it.
 */
export function withImportedFeatures(existing: CourseFeature[], imported: CourseFeature[]): CourseFeature[] {
  const drawn = existing.filter((f) => f.source !== 'osm');
  const drawnIds = new Set(drawn.map((f) => f.id));
  return [...drawn, ...imported.filter((f) => !drawnIds.has(f.id))].sort(byId);
}

/** Kinds a player plays around, as against the ground they play on. */
export const HAZARD_KINDS: ReadonlySet<FeatureKind> = new Set(['bunker', 'water', 'lateralWater', 'outOfBounds']);

const NAMES: Partial<Record<FeatureKind, [string, string]>> = {
  bunker: ['bunker', 'bunkers'],
  water: ['water hazard', 'water hazards'],
  lateralWater: ['red penalty area', 'red penalty areas'],
  fairway: ['fairway', 'fairways'],
  green: ['green outline', 'green outlines'],
  tee: ['tee', 'tees'],
  holeLine: ['hole line', 'hole lines'],
  outOfBounds: ['out-of-bounds line', 'out-of-bounds lines'],
};

/** What a map holds, for a sentence: "82 bunkers, 1 water hazard, 18 fairways and the course edge". */
export function describeFeatures(features: CourseFeature[]): string {
  const counts = new Map<FeatureKind, number>();
  for (const f of features) counts.set(f.kind, (counts.get(f.kind) ?? 0) + 1);
  const parts = (Object.keys(NAMES) as FeatureKind[])
    .filter((kind) => counts.has(kind))
    .map((kind) => {
      const n = counts.get(kind)!;
      return `${n} ${NAMES[kind]![n === 1 ? 0 : 1]}`;
    });
  if (counts.has('courseEdge')) parts.push('the course edge');
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}
