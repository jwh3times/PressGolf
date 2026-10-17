import { featuresFromOsm } from '../../osm/features';
import { greensFromOsm, type OsmElement } from '../../osm/greens';
import torrey from '../../osm/__tests__/torrey-south.json';
import { usualScoreFor } from '../bag';
import { secondLine, suggestShot, suggestionLine, teeLine, type ShotOption, type SuggestionInput } from '../club-suggestion';
import { frame } from '../hole-map';
import type { Club, Course, CourseFeature, FeatureKind, Green, Group, LatLng, UsualScore } from '../types';
import { makeTestCourse, makeTestGroup } from './helpers';

const ORIGIN: LatLng = { lat: 45.5, lng: -122.6 };
const flat = frame(ORIGIN, 0);
const YARD = 0.9144;
/** A point `north` and `east` yards from the origin: every hole here plays due north from it. */
const at = (north: number, east = 0): LatLng => flat.toLatLng([east * YARD, north * YARD]);
const box = (south: number, north: number, west: number, east: number) => [at(south, west), at(south, east), at(north, east), at(north, west)];
/** A ring of `radius` yards around a point `north` yards up the line. */
const circle = (north: number, radius: number) =>
  Array.from({ length: 24 }, (_, i) => at(north + radius * Math.cos((i / 24) * 2 * Math.PI), radius * Math.sin((i / 24) * 2 * Math.PI)));

let ids = 0;
const feature = (kind: FeatureKind, points: LatLng[], number: number | null = null): CourseFeature => ({
  id: `f${ids++}`,
  kind,
  hole: number,
  points,
  source: 'osm',
});
const green = (number: number, middle: LatLng): Green => ({ number, middle, front: null, back: null, source: 'osm' });

/**
 * Hole `number` of the test card, `length` yards straight north, its green an
 * outline of a typical 6,000 square feet (about 29 yards across), a fairway
 * up to it unless `features` says otherwise.
 */
function hole(number: number, length: number, features: CourseFeature[], { fairway = true } = {}): Course {
  return {
    ...makeTestCourse(),
    greens: [green(number, at(length))],
    features: [
      feature('holeLine', [at(0), at(length)], number),
      feature('green', circle(length, 14.6)),
      ...(fairway ? [feature('fairway', box(20, length - 15, -18, 18))] : []),
      ...features,
    ],
  };
}

const club = (name: string, carry: number | null): Club => ({ id: `k-${name}`, name, carry });
/** A 90s golfer's bag, ten yards a club. */
const BAG: Club[] = [
  club('Driver', 225),
  club('3 wood', 205),
  club('5 wood', 190),
  club('4 hybrid', 178),
  club('5 iron', 167),
  club('6 iron', 156),
  club('7 iron', 145),
  club('8 iron', 134),
  club('9 iron', 123),
  club('PW', 112),
  club('GW', 100),
  club('SW', 85),
  club('LW', 70),
];

const input = (course: Course, number: number, extra: Partial<SuggestionInput> = {}): SuggestionInput => ({
  course,
  hole: number,
  from: null,
  bag: BAG,
  usualScore: '90s',
  seed: 7,
  ...extra,
});

describe('a club and an aim', () => {
  it('on a plain par 3 of 150, the club that carries about that far, at the middle', () => {
    const result = suggestShot(input(hole(4, 150, [], { fairway: false }), 4));
    expect(result.status).toBe('suggested');
    expect(result.best!.club).toBe('7 iron');
    expect(result.best!.aim.words).toBe('centre');
    expect(result.best!.odds).toBeNull();
    expect(result.second).toBeNull();
    expect(suggestionLine(result)).toBe('7 iron · aim centre');
  });

  it('takes more club over water short of the green', () => {
    const plain = suggestShot(input(hole(4, 150, [], { fairway: false }), 4));
    const wet = suggestShot(input(hole(4, 150, [feature('water', box(110, 136, -60, 60))], { fairway: false }), 4));
    const carry = (name: string) => BAG.find((c) => c.name === name)!.carry!;
    expect(carry(wet.best!.club)).toBeGreaterThan(carry(plain.best!.club));
  });

  it('aims away from out of bounds down the right', () => {
    const course = hole(4, 150, [{ ...feature('outOfBounds', [at(60, 18), at(220, 18)]), source: 'map' }], { fairway: false });
    const result = suggestShot(input(course, 4));
    expect(result.best!.aim.words).toMatch(/left/);
    expect(result.best!.aim.lean).toBe('left');
  });

  it('says how often the worst likely outcome happens, in words', () => {
    // A bunker hard against the front of the green, the width of it.
    const course = hole(4, 150, [feature('bunker', box(126, 136, -20, 20))], { fairway: false });
    const result = suggestShot(input(course, 4));
    expect(result.best!.odds).toMatch(/^about (half|1 in \d+) finds? a bunker$/);
    expect(suggestionLine(result)).toBe(`${result.best!.club} · aim ${result.best!.aim.words} · ${result.best!.odds}`);
  });

  it('is the same answer for the same spot and seed', () => {
    const course = hole(1, 400, [feature('water', box(200, 230, 10, 60)), feature('bunker', box(240, 255, -40, -15))]);
    expect(suggestShot(input(course, 1))).toEqual(suggestShot(input(course, 1)));
  });
});

describe('laying up', () => {
  it("lays up short of water the bag can't carry, leaving a full swing", () => {
    // Hole 2 is a par 5: from 260 out, water across the front of the green that takes 245 to carry.
    const course = hole(2, 500, [feature('water', box(430, 488, -70, 70))]);
    const result = suggestShot(input(course, 2, { from: at(240) }));
    expect(result.best!.approach).toBe('layUp');
    // What's left is a full swing with a club in the bag, not a part-wedge.
    expect(result.best!.leaves!).toBeGreaterThanOrEqual(65);
    expect(secondLine(result)).toBeNull();
  });

  it('offers laying up as well, when going for it is only a little better', () => {
    // 200 out on a par 5, water across short of the green.
    const course = hole(2, 500, [feature('water', box(470, 484, -40, 40))]);
    const result = suggestShot(input(course, 2, { from: at(300), usualScore: '80s' }));
    expect(result.best!.approach).toBe('go');
    expect(result.second!.approach).toBe('layUp');
    expect(result.second!.expected - result.best!.expected).toBeLessThanOrEqual(0.33);
    expect(secondLine(result)).toBe(`or lay up: ${result.second!.club} to ${result.second!.leaves}`);
    // To a full swing with a club in the bag, not a part-wedge.
    expect(result.second!.leaves!).toBeGreaterThanOrEqual(65);
  });

  it('offers going for it as well, when laying up is only a little better', () => {
    const course = hole(2, 500, [feature('water', box(470, 484, -40, 40))]);
    const result = suggestShot(input(course, 2, { from: at(260), usualScore: '80s' }));
    expect(result.best!.approach).toBe('layUp');
    expect(result.second!.approach).toBe('go');
    expect(secondLine(result)).toBe(`or go for the green: ${result.second!.club}`);
  });

  it('says less than a full wedge inside the shortest full swing', () => {
    const result = suggestShot(input(hole(4, 150, []), 4, { from: at(100) }));
    expect(result.status).toBe('partial');
    expect(suggestionLine(result)).toBe('Less than a full LW');
  });
});

describe('off the tee', () => {
  it('suggests a tee shot down the fairway on a par 4, said across the fairway', () => {
    const course = hole(1, 400, [feature('water', box(200, 240, 18, 70))]);
    const result = suggestShot(input(course, 1));
    expect(result.status).toBe('suggested');
    expect(['driver', 'less']).toContain(result.best!.approach);
    expect(result.best!.aim.words).toMatch(/^(left edge|left-centre|centre|right-centre|right edge)$/);
    expect(teeLine(result)).toBe(`Off the tee: ${result.best!.club}, aim ${result.best!.aim.words}`);
  });

  it('calls a shorter club a lay-up off the tee of a hole the bag can reach', () => {
    // A long par 4 of 240: the driver gets there, so anything shorter lays up.
    const course = hole(1, 240, [feature('water', box(200, 222, -40, 40))]);
    const result = suggestShot(input(course, 1));
    const approaches = [result.best!, ...(result.second ? [result.second] : [])].map((o) => o.approach);
    expect(approaches.every((a) => a === 'go' || a === 'layUp')).toBe(true);
  });

  it('says the aim in yards off the line where no fairway is mapped', () => {
    const course = hole(1, 400, [feature('water', box(180, 260, 5, 70))], { fairway: false });
    const result = suggestShot(input(course, 1));
    expect(result.best!.aim.words).toMatch(/^(\d+ yards (left|right)|down the line)$/);
  });
});

describe('when there is no suggestion', () => {
  it('needs a green', () => {
    const course: Course = { ...hole(4, 150, []), greens: [], features: [] };
    expect(suggestShot(input(course, 4)).status).toBe('noGreen');
  });

  it('needs three carries', () => {
    const result = suggestShot(input(hole(4, 150, []), 4, { bag: [club('Driver', 230), club('7 iron', 145), club('PW', null)] }));
    expect(result.status).toBe('fewCarries');
    expect(suggestionLine(result)).toBe('Add carries in your bag');
  });

  it('names a club with no carry that might be the better one', () => {
    const bag = BAG.map((c) => (c.name === '7 iron' ? { ...c, carry: null } : c));
    const result = suggestShot(input(hole(4, 150, [], { fairway: false }), 4, { bag }));
    expect(result.status).toBe('suggested');
    expect(result.missing).toBe('7 iron');
  });

  it("has nothing to say on the green", () => {
    expect(suggestShot(input(hole(4, 150, []), 4, { from: at(146) })).status).toBe('onGreen');
  });
});

describe('the lie', () => {
  it('reads sand from a bunker, and takes the player\'s word over the map', () => {
    const course = hole(1, 400, [feature('bunker', box(230, 245, -10, 10))]);
    expect(suggestShot(input(course, 1, { from: at(238) })).lie).toBe('sand');
    expect(suggestShot(input(course, 1, { from: at(150) })).lie).toBe('fairway');
    expect(suggestShot(input(course, 1, { from: at(150, 40) })).lie).toBe('rough');
    expect(suggestShot(input(course, 1)).lie).toBe('tee');
    const picked = suggestShot(input(course, 1, { from: at(238), lie: 'fairway' }));
    expect(picked.lie).toBe('fairway');
    expect(picked.liePicked).toBe(true);
  });

  it('spreads shots wider from the rough than the fairway', () => {
    const course = hole(4, 150, []);
    const lie = (l: 'fairway' | 'rough') => suggestShot(input(course, 4, { from: at(0), lie: l })).best!.finishes.green;
    expect(lie('rough')).toBeLessThan(lie('fairway'));
  });
});

describe('caveats', () => {
  it('always says trees are not mapped, and says little is mapped without a fairway', () => {
    expect(suggestShot(input(hole(1, 400, []), 1)).caveats).toEqual(['trees']);
    expect(suggestShot(input(hole(1, 400, [], { fairway: false }), 1)).caveats).toEqual(['trees', 'littleMapped']);
  });
});

describe('the course edge', () => {
  it('is out of bounds outside every part of it, not outside any one: a course can be mapped in pieces', () => {
    const here = feature('courseEdge', box(-30, 200, -60, 60));
    const elsewhere = feature('courseEdge', box(1000, 1300, 500, 800));
    const result = suggestShot(input(hole(4, 150, [here, elsewhere], { fairway: false }), 4));
    expect(result.best!.finishes.outOfBounds).toBe(0);
    // Close down the right, the edge of the part the hole is in still counts.
    const tight = feature('courseEdge', box(-30, 200, -60, 10));
    expect(suggestShot(input(hole(4, 150, [tight, elsewhere], { fairway: false }), 4, { usualScore: '100s' })).best!.finishes.outOfBounds).toBeGreaterThan(0);
  });
});

describe('a green with no outline', () => {
  it('is as deep as its front and back, or about 25 yards across', () => {
    const marked = (front: number, back: number): Course => ({
      ...makeTestCourse(),
      greens: [{ number: 4, middle: at(150), front: at(front), back: at(back), source: 'marked' }],
      features: [feature('holeLine', [at(0), at(150)], 4)],
    });
    const deep = suggestShot(input(marked(130, 170), 4));
    const plain = suggestShot(input({ ...marked(130, 170), greens: [green(4, at(150))] }, 4));
    expect(deep.status).toBe('suggested');
    expect(deep.best!.finishes.green).toBeGreaterThan(plain.best!.finishes.green);
  });
});

describe('the shot pattern', () => {
  it('draws a ring around where the club is aimed', () => {
    const result = suggestShot(input(hole(4, 150, [], { fairway: false }), 4));
    const ring = result.best!.pattern.map((p) => flat.toXY(p));
    expect(ring.length).toBeGreaterThanOrEqual(16);
    const north = ring.map(([, y]) => y / YARD);
    const east = ring.map(([x]) => x / YARD);
    // Longer than it is wide for a 90s golfer, and centred near the green.
    expect(Math.max(...north) - Math.min(...north)).toBeGreaterThan(20);
    expect((Math.max(...north) + Math.min(...north)) / 2).toBeGreaterThan(135);
    expect(Math.abs((Math.max(...east) + Math.min(...east)) / 2)).toBeLessThan(5);
  });
});

/**
 * Checks against Broadie's published figures. Medians: "Assessing Golfer
 * Performance Using Golfmetrics", Science and Golf V (2008), Table 2, median
 * leave from 100–150 yards in the fairway. The 90s golfer from 150: Broadie,
 * quoted by GOLF.com on 2 January 2015, 35% of greens.
 */
describe('against Broadie', () => {
  /** One 150-yard club, between two that are no use from 150. */
  const bag = (carry: number) => [club('Driver', 240), club('7 iron', carry), club('LW', 55)];

  /** The best option from a fairway `yards` from the green, averaged over twenty seeds: one seed's 400 shots are too few to judge by. */
  const average = (yards: number, carry: number, usualScore: UsualScore) => {
    const options = Array.from({ length: 20 }, (_, seed) =>
      suggestShot(input(hole(4, yards, []), 4, { from: at(0), lie: 'fairway', bag: bag(carry), usualScore, seed })).best!,
    );
    expect(options.every((o) => o.club === '7 iron')).toBe(true);
    const mean = (f: (o: ShotOption) => number) => options.reduce((t, o) => t + f(o), 0) / options.length;
    return { green: mean((o) => o.finishes.green), depth: mean((o) => o.depthMiss), leave: mean((o) => o.medianLeave) / yards };
  };

  it('a 90s golfer from 150 in the fairway hits about 35% of greens, and misses short on average', () => {
    // A 146 carry, which with its roll comes to about 150.
    const { green: hit, depth } = average(150, 146, '90s');
    expect(hit).toBeGreaterThan(0.3);
    expect(hit).toBeLessThan(0.4);
    expect(depth).toBeLessThan(0);
  });

  it.each([
    ['70s', 0.087],
    ['90s', 0.12],
    ['100s', 0.173],
  ] as const)('a %s golfer from 125 in the fairway leaves a median of about %s of the distance', (usualScore, published) => {
    const { leave } = average(125, 121, usualScore);
    expect(leave).toBeGreaterThan(published - 0.01);
    expect(leave).toBeLessThan(published + 0.01);
  });
});

describe('on a real course', () => {
  const elements = torrey.elements as unknown as OsmElement[];
  const course: Course = { ...makeTestCourse(), greens: greensFromOsm(elements, 18).greens, features: featuresFromOsm(elements, 18) };

  it('suggests a club from the tee of each mapped hole', () => {
    for (const number of [3, 8]) {
      const result = suggestShot(input(course, number));
      expect(result.status).toBe('suggested');
      expect(suggestionLine(result)).toMatch(/^.+ · aim .+/);
    }
  });
});

describe('usual score', () => {
  const withYou = (index: number | null): Group[] => {
    const group = makeTestGroup(2);
    group.youId = group.players[0].id;
    group.players[0].handicapIndex = index;
    return [group];
  };

  it('is what the player chose', () => {
    expect(usualScoreFor('80s', withYou(2))).toEqual({ score: '80s', from: 'chosen' });
  });

  it('starts from the handicap index of you in the first group: about 72 plus the index', () => {
    expect(usualScoreFor(null, withYou(18))).toEqual({ score: '90s', from: 'handicap' });
    expect(usualScoreFor(null, withYou(4.2))).toEqual({ score: '70s', from: 'handicap' });
    expect(usualScoreFor(null, withYou(12))).toEqual({ score: '80s', from: 'handicap' });
    expect(usualScoreFor(null, withYou(31))).toEqual({ score: '100s', from: 'handicap' });
  });

  it('is a starting guess of the 90s with no handicap', () => {
    expect(usualScoreFor(null, withYou(null))).toEqual({ score: '90s', from: 'guess' });
    expect(usualScoreFor(null, [])).toEqual({ score: '90s', from: 'guess' });
  });
});
