import { featuresFromOsm } from '../../osm/features';
import { greensFromOsm, type OsmElement } from '../../osm/greens';
import torrey from '../../osm/__tests__/torrey-south.json';
import { frame } from '../hole-map';
import { facingZone, holeStrategy, sideSentence, zoneSummary } from '../hole-strategy';
import type { Course, CourseFeature, FeatureKind, Green, LatLng } from '../types';
import { makeTestCourse, withTee } from './helpers';

const ORIGIN: LatLng = { lat: 45.5, lng: -122.6 };
const flat = frame(ORIGIN, 0);
const YARD = 0.9144;
/** A point `north` and `east` yards from the origin: every hole here plays due north from it. */
const at = (north: number, east = 0): LatLng => flat.toLatLng([east * YARD, north * YARD]);
/** A rectangle from `south` to `north`, `west` to `east`, in yards from the origin. */
const box = (south: number, north: number, west: number, east: number) => [at(south, west), at(south, east), at(north, east), at(north, west)];

let ids = 0;
const feature = (kind: FeatureKind, points: LatLng[], number: number | null = null): CourseFeature => ({
  id: `f${ids++}`,
  kind,
  hole: number,
  points,
  source: 'osm',
});
const green = (number: number, middle: LatLng): Green => ({ number, middle, front: null, back: null, source: 'osm' });

/** Hole `number` of the test card, `length` yards straight north, with `features` around it. */
function hole(number: number, length: number, features: CourseFeature[]): Course {
  return {
    ...makeTestCourse(),
    greens: [green(number, at(length))],
    features: [feature('holeLine', [at(0), at(length)], number), ...features],
  };
}

const grades = (course: Course, number: number, zone: string) =>
  Object.fromEntries(
    holeStrategy(course, number)!
      .zones.find((z) => z.zone === zone)!
      .sides.map((s) => [s.side, s.grade]),
  );

describe('around the green', () => {
  it('grades each side of the green by the trouble there', () => {
    // Hole 4 is a par 3: the green is all there is to it.
    const course = hole(4, 160, [
      feature('bunker', box(150, 170, 14, 26)),
      feature('water', box(140, 175, -40, -18)),
      feature('fairway', box(40, 145, -15, 15)),
    ]);
    expect(holeStrategy(course, 4)!.zones.map((z) => z.zone)).toEqual(['green']);
    expect(grades(course, 4, 'green')).toEqual({ short: 'clear', long: 'clear', left: 'bad', right: 'someTrouble' });
  });
});

describe('grading', () => {
  const bunkerShort = () => feature('bunker', box(130, 142, -8, 8));
  const edge = () => feature('courseEdge', box(-100, 175, -300, 300));

  it('ranks out of bounds over water, and water over a bunker, naming every cause worst first', () => {
    const course = hole(4, 160, [
      bunkerShort(),
      feature('water', box(125, 140, -6, 6)),
      edge(),
    ]);
    const short = holeStrategy(course, 4)!.zones[0].sides.find((s) => s.side === 'short')!;
    expect(short.grade).toBe('bad');
    expect(short.causes.map((c) => c.kind)).toEqual(['water', 'bunker']);
    // The course's edge, 15 yards past the middle, is likely out of bounds.
    expect(grades(course, 4, 'green').long).toBe('worst');
  });

  it("lets the owner's out-of-bounds lines stand in for the course's edge", () => {
    const owner: CourseFeature = { ...feature('outOfBounds', [at(100, 35), at(220, 35)]), source: 'map' };
    expect(grades(hole(4, 160, [bunkerShort(), edge(), owner]), 4, 'green')).toMatchObject({ long: 'clear', right: 'worst' });
    // A line from OpenStreetMap is out of bounds too, but leaves the edge counting.
    const imported = feature('outOfBounds', [at(100, 35), at(220, 35)]);
    expect(grades(hole(4, 160, [bunkerShort(), edge(), imported]), 4, 'green')).toMatchObject({ long: 'worst', right: 'worst' });
  });

  it('calls a side clear only where something around the green is mapped', () => {
    const bare = hole(4, 160, [edge(), feature('bunker', box(60, 70, 0, 10))]);
    expect(grades(bare, 4, 'green')).toEqual({ short: 'nothingMapped', long: 'worst', left: 'nothingMapped', right: 'nothingMapped' });
  });

  it('has nothing to say about a hole with nothing mapped near it but the edge, or no line', () => {
    expect(holeStrategy(hole(4, 160, [edge()]), 4)).toBeNull();
    const noLine = { ...hole(4, 160, [bunkerShort()]), features: [bunkerShort()] };
    expect(holeStrategy(noLine, 4)).toBeNull();
  });
});

const zone = (course: Course, number: number, name: string, teeId?: string) =>
  holeStrategy(course, number, { teeId })?.zones.find((z) => z.zone === name);
const sideOf = (course: Course, number: number, name: string, which: string, teeId?: string) =>
  zone(course, number, name, teeId)?.sides.find((s) => s.side === which);

describe('the tee shot', () => {
  // Hole 1 is a par 4 of 400 yards on the test card, played here from its back tee.
  const fairway = () => feature('fairway', box(150, 380, -18, 18));

  it('reads trouble 180 to 280 yards off the tee on each side, with its yards off the tee', () => {
    const course = hole(1, 400, [
      fairway(),
      feature('bunker', box(230, 250, 20, 35)),
      feature('water', box(260, 290, -45, -25)),
      feature('bunker', box(120, 140, 20, 30)),
    ]);
    expect(holeStrategy(course, 1)!.zones.map((z) => z.zone)).toEqual(['teeShot', 'green']);
    expect(sideOf(course, 1, 'teeShot', 'right')).toEqual({ side: 'right', grade: 'someTrouble', causes: [{ kind: 'bunker', yards: [230, 250] }] });
    expect(sideOf(course, 1, 'teeShot', 'left')).toEqual({ side: 'left', grade: 'bad', causes: [{ kind: 'water', yards: [260, 290] }] });
    expect(sideOf(course, 1, 'teeShot', 'across')?.grade).toBe('clear');
  });

  it('reads water across the landing area, and the course edge beside it', () => {
    const course = hole(1, 400, [
      fairway(),
      feature('water', box(200, 212, -60, 60)),
      feature('courseEdge', box(-100, 500, -300, 50)),
    ]);
    expect(sideOf(course, 1, 'teeShot', 'across')).toEqual({ side: 'across', grade: 'bad', causes: [{ kind: 'water', yards: [200, 212] }] });
    expect(sideOf(course, 1, 'teeShot', 'right')).toEqual({ side: 'right', grade: 'worst', causes: [{ kind: 'courseEdge', yards: [180, 280] }] });
  });

  it('reads from the tee being played: a tee 40 yards forward plays everything 40 yards shorter', () => {
    const course = withTee(hole(1, 400, [fairway(), feature('bunker', box(300, 312, 20, 35))]), 'red', (h) => ({ yards: h.yards - 40 }));
    expect(sideOf(course, 1, 'teeShot', 'right', 'white')?.grade).toBe('clear');
    expect(sideOf(course, 1, 'teeShot', 'right', 'red')?.causes).toEqual([{ kind: 'bunker', yards: [260, 272] }]);
  });

  it("reads from the course's first tee for anyone without one", () => {
    const base = hole(1, 400, [fairway(), feature('bunker', box(300, 312, 20, 35))]);
    const forward = withTee(base, 'red', (h) => ({ yards: h.yards - 40 }));
    const course = { ...forward, tees: [forward.tees[1], forward.tees[0]] };
    expect(sideOf(course, 1, 'teeShot', 'right')?.causes).toEqual([{ kind: 'bunker', yards: [260, 272] }]);
  });

  it('stops short of the green on a short par 4, and says nothing mapped where nothing is', () => {
    const course = hole(1, 290, [feature('bunker', box(262, 272, -10, 10)), feature('bunker', box(236, 246, 20, 30))]);
    expect(sideOf(course, 1, 'teeShot', 'across')?.grade).toBe('clear');
    expect(sideOf(course, 1, 'teeShot', 'right')?.causes).toEqual([{ kind: 'bunker', yards: [236, 246] }]);
    expect(sideOf(course, 1, 'green', 'short')?.grade).toBe('someTrouble');

    const bare = hole(1, 400, [feature('bunker', box(380, 390, 20, 30))]);
    expect(zone(bare, 1, 'teeShot')!.sides.map((s) => s.grade)).toEqual(['nothingMapped', 'nothingMapped', 'nothingMapped']);
  });

  it('is not part of a par 3', () => {
    expect(zone(hole(4, 160, [feature('bunker', box(150, 170, 14, 26))]), 4, 'teeShot')).toBeUndefined();
  });
});

describe('the second shot on a par 5', () => {
  // Hole 2 is a par 5 on the test card.
  it('reads trouble 80 to 200 yards short of the green, in yards to the green', () => {
    const course = hole(2, 520, [
      feature('fairway', box(150, 500, -18, 18)),
      feature('bunker', box(400, 420, -30, -18)),
      feature('water', box(330, 350, 20, 40)),
    ]);
    expect(holeStrategy(course, 2)!.zones.map((z) => z.zone)).toEqual(['teeShot', 'secondShot', 'green']);
    expect(sideOf(course, 2, 'secondShot', 'left')?.causes).toEqual([{ kind: 'bunker', yards: [100, 120] }]);
    expect(sideOf(course, 2, 'secondShot', 'right')?.causes).toEqual([{ kind: 'water', yards: [170, 190] }]);
    expect(sideOf(course, 2, 'teeShot', 'right')?.grade).toBe('clear');
  });

  it('is only part of a par 5', () => {
    expect(zone(hole(1, 400, [feature('fairway', box(150, 380, -18, 18))]), 1, 'secondShot')).toBeUndefined();
  });
});

describe('the zone a player faces', () => {
  const par4 = hole(1, 400, [feature('fairway', box(150, 380, -18, 18))]);
  const par5 = hole(2, 520, [feature('fairway', box(150, 500, -18, 18))]);
  const walk = (course: Course, number: number, steps: (number | null)[]) => {
    let last: ReturnType<typeof facingZone> = null;
    return steps.map((north) => (last = facingZone(course, number, north == null ? null : at(north, 5), last)));
  };

  it('follows a par 4 from the tee to the green, and never steps back', () => {
    expect(walk(par4, 1, [null, 20, 90, 150, 60, 300])).toEqual(['teeShot', 'teeShot', 'teeShot', 'green', 'green', 'green']);
  });

  it('lays up on a par 5 until 200 yards out', () => {
    expect(walk(par5, 2, [10, 150, 310, 330, 100])).toEqual(['teeShot', 'secondShot', 'secondShot', 'green', 'green']);
  });

  it('is the green on a par 3, and on a par 4 too short to read a tee shot', () => {
    expect(walk(hole(4, 160, [feature('bunker', box(150, 170, 14, 26))]), 4, [null, 0])).toEqual(['green', 'green']);
    expect(walk(hole(1, 200, [feature('bunker', box(190, 200, 14, 26))]), 1, [null])).toEqual(['green']);
  });

  it('keeps its zone with no fix, or a fix far from the hole', () => {
    expect(walk(par4, 1, [150, null, -5000])).toEqual(['green', 'green', 'green']);
    expect(walk(par4, 1, [-5000])).toEqual(['teeShot']);
  });

  it('has no zone on a hole with no strategy', () => {
    expect(facingZone(hole(1, 400, []), 1, at(10), null)).toBeNull();
  });
});

describe('the summary of a zone', () => {
  const read = (course: Course, number: number, name: string) => zoneSummary(zone(course, number, name)!);

  it('names the trouble on each side, worst first, then the clear sides', () => {
    const course = hole(4, 160, [
      feature('bunker', box(150, 170, 14, 26)),
      feature('water', box(140, 175, -40, -18)),
      feature('water', box(120, 135, -10, 10)),
      feature('courseEdge', box(-100, 175, -300, 300)),
    ]);
    expect(read(course, 4, 'green')).toBe('Green: likely OB long · water short, left · bunker right');
    expect(read(hole(4, 160, [feature('bunker', box(150, 170, 14, 26))]), 4, 'green')).toBe('Green: bunker right · clear short, long, left');
  });

  it('reads across the line on the tee shot, and says when nothing is mapped', () => {
    const course = hole(1, 400, [feature('fairway', box(150, 380, -18, 18)), feature('water', box(200, 212, -60, 60))]);
    expect(read(course, 1, 'teeShot')).toBe('Tee shot: water across · clear left, right');
    expect(read(hole(1, 400, [feature('bunker', box(380, 390, 20, 30))]), 1, 'teeShot')).toBe('Tee shot: nothing mapped');
  });
});

describe('a side, in words', () => {
  it('names each cause with its yards the zone\'s way, and the grade first', () => {
    const tee = hole(1, 400, [
      feature('fairway', box(150, 380, -18, 18)),
      feature('bunker', box(230, 250, 20, 35)),
      feature('courseEdge', box(-100, 500, -300, 50)),
    ]);
    expect(sideSentence('teeShot', sideOf(tee, 1, 'teeShot', 'right')!)).toBe(
      'Right: worst. Likely out of bounds (the course edge), 180–280 off the tee; bunker, 230–250 off the tee.',
    );
    const five = hole(2, 520, [feature('fairway', box(150, 500, -18, 18)), feature('lateralWater', box(330, 350, 20, 40))]);
    expect(sideSentence('secondShot', sideOf(five, 2, 'secondShot', 'right')!)).toBe('Right: bad. Red penalty area, 170–190 to the green.');
    expect(sideSentence('secondShot', sideOf(five, 2, 'secondShot', 'left')!)).toBe('Left: clear.');
    const three = hole(4, 160, [feature('water', box(140, 175, -40, -18))]);
    expect(sideSentence('green', sideOf(three, 4, 'green', 'left')!)).toBe('Left: bad. Water.');
    expect(sideSentence('teeShot', { side: 'across', grade: 'nothingMapped', causes: [] })).toBe('Across: nothing mapped.');
  });
});

describe('a real hole: Torrey Pines South, the third', () => {
  it('reads the bunkers short of the green and the course edge behind it', () => {
    const elements = torrey.elements as unknown as OsmElement[];
    const course: Course = { ...makeTestCourse(), features: featuresFromOsm(elements, 18), greens: greensFromOsm(elements, 18).greens };
    const strategy = holeStrategy(course, 3)!;
    expect(strategy.zones.map((z) => z.zone)).toEqual(['green']);
    expect(grades(course, 3, 'green')).toEqual({ short: 'someTrouble', long: 'worst', left: 'clear', right: 'clear' });
  });
});
