import { metresBetween, yardsBetween } from '../../domain/geo';
import { greensFromOsm, type OsmElement } from '../greens';
// Holes 3 and 8 of Torrey Pines South and their greens, from OpenStreetMap
// (© OpenStreetMap contributors, ODbL). The card gives 200 and 175 yards.
import torrey from './torrey-south.json';

const elements = torrey.elements as unknown as OsmElement[];

/** A square green `size` metres across, centred `north` metres north of (0, 0) at the equator. */
function square(id: number, north: number, size = 30): OsmElement {
  const d = (m: number) => m / 111_320;
  const h = size / 2;
  const ring = [
    { lat: d(north - h), lon: d(-h) },
    { lat: d(north - h), lon: d(h) },
    { lat: d(north + h), lon: d(h) },
    { lat: d(north + h), lon: d(-h) },
    { lat: d(north - h), lon: d(-h) },
  ];
  return { type: 'way', id, tags: { golf: 'green' }, geometry: ring };
}

/** A straight hole due north from the origin, ending `to` metres up. */
function hole(id: number, ref: string, to: number): OsmElement {
  return {
    type: 'way',
    id,
    tags: { golf: 'hole', ref },
    geometry: [{ lat: 0, lon: 0 }, { lat: to / 111_320, lon: 0 }],
  };
}

describe('greensFromOsm on a real course', () => {
  const { greens, missing, ambiguous } = greensFromOsm(elements, 18);
  const [third, eighth] = greens;
  const tee = (ref: string) => {
    const line = elements.find((e) => e.tags?.ref === ref)!.geometry![0];
    return { lat: line.lat, lng: line.lon };
  };

  it('finds the two mapped holes and says the rest are missing', () => {
    expect(greens.map((g) => g.number)).toEqual([3, 8]);
    expect(missing).toEqual([1, 2, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]);
    expect(ambiguous).toEqual([]);
    expect(greens.every((g) => g.source === 'osm')).toBe(true);
  });

  it('puts the middles where the card says', () => {
    expect(Math.abs(yardsBetween(tee('3'), third.middle) - 200)).toBeLessThanOrEqual(5);
    expect(Math.abs(yardsBetween(tee('8'), eighth.middle) - 175)).toBeLessThanOrEqual(5);
  });

  it('puts the front nearer the tee than the middle, and the back further, a green\'s depth apart', () => {
    for (const [ref, green] of [['3', third], ['8', eighth]] as const) {
      const from = tee(ref);
      expect(yardsBetween(from, green.front!)).toBeLessThan(yardsBetween(from, green.middle));
      expect(yardsBetween(from, green.back!)).toBeGreaterThan(yardsBetween(from, green.middle));
      const depth = metresBetween(green.front!, green.back!);
      expect(depth).toBeGreaterThan(15);
      expect(depth).toBeLessThan(45);
    }
  });
});

describe('greensFromOsm', () => {
  it('reads front, middle and back along the line of play', () => {
    const { greens } = greensFromOsm([hole(1, '1', 300), square(2, 300)], 1);
    expect(metresBetween({ lat: 0, lng: 0 }, greens[0].middle)).toBeCloseTo(300, 0);
    expect(metresBetween({ lat: 0, lng: 0 }, greens[0].front!)).toBeCloseTo(285, 0);
    expect(metresBetween({ lat: 0, lng: 0 }, greens[0].back!)).toBeCloseTo(315, 0);
  });

  it('takes a green the line stops just short of, but not one well away from it', () => {
    expect(greensFromOsm([hole(1, '1', 270), square(2, 300)], 1).greens).toHaveLength(1);
    expect(greensFromOsm([hole(1, '1', 200), square(2, 300)], 1).missing).toEqual([1]);
  });

  it('takes the green the line ends in over a nearer one beside it', () => {
    const { greens } = greensFromOsm([hole(1, '1', 300), square(2, 270, 20), square(3, 300, 20)], 1);
    expect(metresBetween({ lat: 0, lng: 0 }, greens[0].middle)).toBeCloseTo(300, 0);
  });

  it('reads a green mapped as a multipolygon from its outer ring', () => {
    const ring = square(2, 300).geometry!;
    const relation: OsmElement = {
      type: 'relation',
      id: 2,
      tags: { golf: 'green' },
      members: [{ type: 'way', role: 'inner', geometry: [] }, { type: 'way', role: 'outer', geometry: ring }],
    };
    expect(greensFromOsm([hole(1, '1', 300), relation], 1).greens).toHaveLength(1);
  });

  it('leaves out a hole two lines claim, rather than guess', () => {
    const { greens, ambiguous } = greensFromOsm([hole(1, '1', 300), hole(2, '1', 300), square(3, 300)], 1);
    expect(greens).toEqual([]);
    expect(ambiguous).toEqual([1]);
  });

  it('ignores lines whose number is not a hole on this course', () => {
    const { greens, missing } = greensFromOsm(
      [hole(1, 'Red 1', 300), hole(2, '19', 300), hole(3, '', 300), { ...hole(4, '1', 300), tags: { golf: 'hole' } }, square(5, 300)],
      18,
    );
    expect(greens).toEqual([]);
    expect(missing).toHaveLength(18);
  });

  it('gives only a middle when the line of play misses the outline either side', () => {
    // An outline drawn as a flat line across the hole has no area: a middle, but nothing to cross.
    const flat: OsmElement = {
      type: 'way',
      id: 2,
      tags: { golf: 'green' },
      geometry: [
        { lat: 300 / 111_320, lon: -1e-4 },
        { lat: 300 / 111_320, lon: 1e-4 },
        { lat: 300 / 111_320, lon: 2e-4 },
        { lat: 300 / 111_320, lon: -1e-4 },
      ],
    };
    const { greens } = greensFromOsm([hole(1, '1', 300), flat], 1);
    expect(greens[0].front).toBeNull();
    expect(greens[0].back).toBeNull();
  });

  it('skips a line too short to have a direction, and an outline too small to be one', () => {
    const stub: OsmElement = { type: 'way', id: 1, tags: { golf: 'hole', ref: '1' }, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 0 }] };
    expect(greensFromOsm([stub, square(2, 0)], 1).missing).toEqual([1]);
    const sliver: OsmElement = { type: 'way', id: 2, tags: { golf: 'green' }, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 0 }] };
    expect(greensFromOsm([hole(1, '1', 300), sliver], 1).missing).toEqual([1]);
  });
});
