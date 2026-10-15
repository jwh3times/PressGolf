import { featuresFromOsm, kindOf, MAX_POINTS, outerRings, simplify } from '../features';
import type { OsmElement } from '../greens';
// Holes 3 and 8 of Torrey Pines South and what's mapped around them, with the
// course's outline, from OpenStreetMap (© OpenStreetMap contributors, ODbL).
import torrey from './torrey-south.json';

const elements = torrey.elements as unknown as OsmElement[];

/** `metres` north and east of (0, 0) at the equator, as OpenStreetMap gives a point. */
const at = (north: number, east = 0) => ({ lat: north / 111_320, lon: east / 111_320 });

describe('featuresFromOsm on a real course', () => {
  const features = featuresFromOsm(elements, 18);
  const count = (kind: string) => features.filter((f) => f.kind === kind).length;

  it('reads every hazard, fairway, green and tee, the two hole lines, and the course edge', () => {
    const mapped = (golf: string) => elements.filter((e) => e.tags?.golf === golf).length;
    expect(count('bunker')).toBe(mapped('bunker'));
    expect(count('tee')).toBe(mapped('tee'));
    expect(count('green')).toBe(mapped('green'));
    // Every fairway here is a multipolygon relation: their rings come from the members.
    expect(count('fairway')).toBe(mapped('fairway'));
    expect(features.filter((f) => f.kind === 'holeLine').map((f) => f.hole).sort()).toEqual([3, 8]);
    expect(count('courseEdge')).toBe(1);
    expect(features.every((f) => f.source === 'osm')).toBe(true);
  });

  it('keeps ids stable, so importing again replaces rather than adds', () => {
    expect(featuresFromOsm(elements, 18).map((f) => f.id)).toEqual(features.map((f) => f.id));
    expect(features.find((f) => f.kind === 'courseEdge')?.id).toBe('osm:way/35679036');
    expect(features.find((f) => f.kind === 'fairway')?.id).toMatch(/^osm:relation\/\d+#0$/);
  });

  it('stores rings without their closing point, to six places, and only as many points as the shape needs', () => {
    for (const feature of features.filter((f) => f.kind !== 'holeLine')) {
      const [first, last] = [feature.points[0], feature.points.at(-1)!];
      expect(first.lat === last.lat && first.lng === last.lng).toBe(false);
      expect(feature.points.length).toBeGreaterThanOrEqual(3);
    }
    for (const { lat, lng } of features.flatMap((f) => f.points)) {
      expect(Math.round(lat * 1e6) / 1e6).toBe(lat);
      expect(Math.round(lng * 1e6) / 1e6).toBe(lng);
    }
    const raw = elements.reduce((n, e) => n + (e.geometry?.length ?? 0) + (e.members ?? []).reduce((m, x) => m + (x.geometry?.length ?? 0), 0), 0);
    const kept = features.reduce((n, f) => n + f.points.length, 0);
    expect(kept).toBeLessThan(raw * 0.8);
  });

  it('can be reused for a nine-hole course, which has no eighth hole line… but does have its third', () => {
    expect(featuresFromOsm(elements, 5).filter((f) => f.kind === 'holeLine').map((f) => f.hole)).toEqual([3]);
  });
});

describe('kindOf', () => {
  it.each([
    [{ golf: 'bunker' }, 'bunker'],
    [{ golf: 'water_hazard' }, 'water'],
    [{ golf: 'lateral_water_hazard' }, 'lateralWater'],
    [{ golf: 'penalty_area' }, 'water'],
    [{ golf: 'lateral_water_hazard', natural: 'water' }, 'lateralWater'],
    [{ natural: 'water' }, 'water'],
    [{ leisure: 'golf_course' }, 'courseEdge'],
    [{ golf: 'out_of_bounds' }, 'outOfBounds'],
    [{ golf: 'rough' }, null],
    [{ golf: 'cartpath' }, null],
    [undefined, null],
  ])('%j is %s', (tags, kind) => {
    expect(kindOf(tags as Record<string, string> | undefined)).toBe(kind);
  });
});

describe('outerRings', () => {
  it('joins a ring split across ways, whichever way each runs, and leaves out the inner rings', () => {
    const [a, b, c, d] = [at(0, 0), at(0, 50), at(50, 50), at(50, 0)];
    const rings = outerRings({
      type: 'relation',
      id: 1,
      members: [
        { type: 'way', role: 'outer', geometry: [a, b] },
        { type: 'way', role: 'inner', geometry: [at(10, 10), at(10, 20), at(20, 20), at(10, 10)] },
        { type: 'way', role: 'outer', geometry: [d, c] },
        { type: 'way', role: 'outer', geometry: [b, c] },
        { type: 'way', role: 'outer', geometry: [d, a] },
      ],
    });
    expect(rings).toEqual([[a, b, c, d, a]]);
  });

  it('drops a ring that never closes, and a relation with no outer ring', () => {
    expect(outerRings({ type: 'relation', id: 1, members: [{ type: 'way', role: 'outer', geometry: [at(0), at(10), at(20)] }] })).toEqual([]);
    expect(outerRings({ type: 'relation', id: 1, members: [{ type: 'way', role: 'inner', geometry: [at(0), at(10), at(10, 10), at(0)] }] })).toEqual([]);
    expect(outerRings({ type: 'relation', id: 1 })).toEqual([]);
  });
});

describe('simplify', () => {
  it('drops points that stray less than the tolerance from the line, and keeps a corner', () => {
    const line = [at(0), at(10, 0.1), at(20, -0.2), at(30), at(30, 30)];
    expect(simplify(line, 0.5)).toEqual([at(0), at(30), at(30, 30)]);
    expect(simplify(line, 0.05)).toHaveLength(5);
  });

  it('keeps a closed ring a ring', () => {
    const ring = [at(0), at(0, 40), at(0.1, 80), at(40, 80), at(40, 0), at(0)];
    expect(simplify(ring, 0.5)).toEqual([at(0), at(0.1, 80), at(40, 80), at(40, 0), at(0)]);
  });
});

describe('featuresFromOsm on edge cases', () => {
  const square = (id: number, tags: Record<string, string>): OsmElement => ({
    type: 'way',
    id,
    tags,
    geometry: [at(0), at(0, 20), at(20, 20), at(20), at(0)],
  });

  it('leaves out a hole line two ways claim, one past the last hole, and points', () => {
    const line = (id: number, ref: string): OsmElement => ({ type: 'way', id, tags: { golf: 'hole', ref }, geometry: [at(0), at(300)] });
    const features = featuresFromOsm(
      [line(1, '1'), line(2, '1'), line(3, '2'), line(4, '19'), line(5, 'A'), { type: 'node', id: 6, tags: { golf: 'tee' } }],
      18,
    );
    expect(features.map((f) => [f.id, f.hole])).toEqual([['osm:way/3', 2]]);
  });

  it('keeps an out-of-bounds line open, and drops an area whose outline doesn\'t close', () => {
    const open: OsmElement = { type: 'way', id: 7, tags: { golf: 'out_of_bounds' }, geometry: [at(0), at(100), at(100, 5)] };
    const unclosed: OsmElement = { type: 'way', id: 8, tags: { golf: 'bunker' }, geometry: [at(0), at(0, 20), at(20, 20)] };
    const features = featuresFromOsm([open, unclosed, square(9, { golf: 'bunker' })], 18);
    expect(features.map((f) => [f.kind, f.points.length])).toEqual([
      ['outOfBounds', 3],
      ['bunker', 4],
    ]);
  });

  it('gives each outer ring of a multipolygon its own feature', () => {
    const ring = (east: number) => [at(0, east), at(0, east + 20), at(20, east + 20), at(20, east), at(0, east)];
    const features = featuresFromOsm(
      [{ type: 'relation', id: 5, tags: { golf: 'fairway' }, members: [{ type: 'way', role: 'outer', geometry: ring(0) }, { type: 'way', role: 'outer', geometry: ring(100) }] }],
      18,
    );
    expect(features.map((f) => f.id)).toEqual(['osm:relation/5#0', 'osm:relation/5#1']);
  });

  it('simplifies harder until a huge outline fits what the database keeps', () => {
    // A circle with a point every few centimetres, wobbling a metre either side.
    const n = MAX_POINTS * 3;
    const geometry = Array.from({ length: n + 1 }, (_, i) => {
      const angle = (2 * Math.PI * (i % n)) / n;
      const r = 500 + (i % 2 ? 1 : -1);
      return at(r * Math.sin(angle), r * Math.cos(angle));
    });
    const [edge] = featuresFromOsm([{ type: 'way', id: 1, tags: { leisure: 'golf_course' }, geometry }], 18);
    expect(edge.points.length).toBeLessThanOrEqual(MAX_POINTS);
    expect(edge.points.length).toBeGreaterThan(20);
  });
});
