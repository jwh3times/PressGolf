import { frame } from '../hole-map';
import { trackedShots, whyNot, type TrackedInput } from '../tracked-shots';
import type { Club, Course, CourseFeature, FeatureKind, LatLng, Mark, MarkHit, Round, RoundStatus } from '../types';
import { makeTestCourse, makeTestRound } from './helpers';

const ORIGIN: LatLng = { lat: 45.5, lng: -122.6 };
const flat = frame(ORIGIN, 0);
const YARD = 0.9144;
/** A point `north` and `east` yards from the origin: every hole here plays due north from it. */
const at = (north: number, east = 0): LatLng => flat.toLatLng([east * YARD, north * YARD]);
const box = (south: number, north: number, west: number, east: number) => [at(south, west), at(south, east), at(north, east), at(north, west)];

let ids = 0;
const feature = (kind: FeatureKind, points: LatLng[], number: number | null = null): CourseFeature => ({
  id: `f${ids++}`,
  kind,
  hole: number,
  points,
  source: 'osm',
});

/**
 * Holes 1 and 2 both play 400 yards due north from the origin, on top of each
 * other, which no course does but keeps the yards easy: a tee box at 0–10, a
 * fairway 40 yards wide from 20 to 380, a bunker in it from 200 to 220 on the
 * left, a pond on the right from 240 to 260, and a green 30 yards across at 400.
 */
const COURSE: Course = {
  ...makeTestCourse(),
  id: 'course1',
  greens: [1, 2].map((number) => ({ number, middle: at(400), front: null, back: null, source: 'osm' as const })),
  features: [
    feature('holeLine', [at(0), at(400)], 1),
    feature('holeLine', [at(0), at(400)], 2),
    feature('tee', box(0, 10, -8, 8)),
    feature('fairway', box(20, 380, -20, 20)),
    feature('bunker', box(200, 220, -20, -5)),
    feature('water', box(240, 260, 5, 20)),
    feature('green', box(385, 415, -15, 15)),
  ],
};

const club = (name: string, carry: number | null): Club => ({ id: `k-${name}`, name, carry });
const SEVEN = club('7 iron', 150);
const DRIVER = club('Driver', 240);
const BAG: Club[] = [DRIVER, SEVEN];

const round = (id: string, status: RoundStatus = 'completed'): Round => ({ ...makeTestRound({ scores: [[]] }), id, courseId: COURSE.id, status });

let marked = 0;
/** A mark on hole `hole` of `roundId`, `north` yards up it, made after every mark before it. */
const mark = (roundId: string, hole: number, north: number, hit: MarkHit, extra: Partial<Mark> = {}): Mark => ({
  id: `m${++marked}`,
  roundId,
  hole,
  position: at(north),
  accuracy: 4,
  at: 1_000_000 + marked * 60_000,
  kind: hit.kind,
  clubId: hit.kind === 'full' ? hit.clubId : null,
  ...extra,
});
const full = (clubId: string): MarkHit => ({ kind: 'full', clubId });
const PARTIAL: MarkHit = { kind: 'partial' };
const GREEN: MarkHit = { kind: 'green' };

const input = (marks: Mark[], rounds: Round[] = [round('r1')], bag: Club[] = BAG): TrackedInput => ({
  marks,
  rounds,
  courses: [COURSE],
  clubs: bag,
});

describe('a tracked shot', () => {
  it('is a full swing to the next mark on the hole: 150 yards fairway to fairway is a 146-yard carry with a 7 iron', () => {
    const start = mark('r1', 1, 150, full(SEVEN.id));
    const finish = mark('r1', 1, 300, PARTIAL);
    const { shots } = trackedShots(input([start, finish]))[SEVEN.id];
    expect(shots).toHaveLength(1);
    expect(shots[0].start).toBe(start);
    expect(shots[0].finish).toBe(finish);
    expect(shots[0].yards).toBeCloseTo(150, 0);
    expect(shots[0].finishLie).toBe('fairway');
    // A short iron rolls 3% on fairway: 150 / 1.03.
    expect(shots[0].carry).toBeCloseTo(145.6, 1);
    expect(shots[0].status).toBe('counts');
  });

  it('pairs each full swing with the next mark on its own hole of its own round, newest first', () => {
    const tee = mark('r1', 1, 5, full(DRIVER.id));
    const second = mark('r1', 1, 265, full(SEVEN.id));
    const onGreen = mark('r1', 1, 400, GREEN);
    // The next hole's tee shot, then a mark on the same hole of another round, then nothing more on hole 2.
    const nextTee = mark('r1', 2, 5, full(DRIVER.id));
    const elsewhere = mark('r2', 2, 255, PARTIAL);
    const result = trackedShots(input([elsewhere, onGreen, nextTee, second, tee], [round('r1'), round('r2')]));

    expect(result[DRIVER.id].shots.map((s) => [s.start, s.finish])).toEqual([
      [nextTee, null],
      [tee, second],
    ]);
    expect(result[SEVEN.id].shots.map((s) => [s.start, s.finish])).toEqual([[second, onGreen]]);
  });

  it('has no finish, and doesn’t count, with no later mark on its hole', () => {
    const [shot] = trackedShots(input([mark('r1', 3, 150, full(SEVEN.id)), mark('r1', 4, 5, PARTIAL)]))[SEVEN.id].shots;
    expect(shot).toMatchObject({ finish: null, yards: null, carry: null, finishLie: null, status: 'noFinish' });
  });

  it.each([
    // A short iron rolls 3% on fairway, half that in rough, a quarter of it on the green.
    // 150 yards up and 30 across is 153 yards.
    ['rough, off the fairway', mark('r1', 1, 300, PARTIAL, { position: at(300, 30) }), 'rough', 153 / 1.015],
    ['the green, by the map', mark('r1', 1, 300, PARTIAL, { position: at(400) }), 'green', 250 / 1.0075],
    ['the green, marked On the green', mark('r1', 1, 300, GREEN), 'green', 150 / 1.0075],
  ] as const)('finishing in %s takes off that lie’s roll', (_, finish, lie, carry) => {
    const [shot] = trackedShots(input([mark('r1', 1, 150, full(SEVEN.id), { at: 0 }), finish]))[SEVEN.id].shots;
    expect(shot.finishLie).toBe(lie);
    expect(shot.carry).toBeCloseTo(carry, 0);
  });

  it('reads rough at both ends on a course with no map, and counts', () => {
    const bare: Course = { ...makeTestCourse(), id: 'bare' };
    const marks = [mark('r1', 1, 150, full(SEVEN.id)), mark('r1', 1, 300, PARTIAL)];
    const [shot] = trackedShots({ ...input(marks, [{ ...round('r1'), courseId: 'bare' }]), courses: [bare] })[SEVEN.id].shots;
    expect(shot).toMatchObject({ startLie: 'rough', finishLie: 'rough', status: 'counts' });
    expect(shot.carry).toBeCloseTo(150 / 1.015, 0);
  });

  it('takes off a driver’s roll, which is more than an iron’s: 260 yards on fairway is a 243-yard carry', () => {
    const [shot] = trackedShots(input([mark('r1', 1, 5, full(DRIVER.id)), mark('r1', 1, 265, PARTIAL)]))[DRIVER.id].shots;
    expect(shot.carry).toBeCloseTo(243, 0);
  });

  it('starts nothing from a mark that wasn’t a full swing, or a club no longer in the bag', () => {
    const marks = [mark('r1', 1, 150, PARTIAL), mark('r1', 1, 300, GREEN), mark('r1', 2, 150, full('k-gone')), mark('r1', 2, 300, GREEN)];
    const result = trackedShots(input(marks));
    expect(Object.keys(result)).toEqual([DRIVER.id, SEVEN.id]);
    expect(result[DRIVER.id].shots).toEqual([]);
    expect(result[SEVEN.id].shots).toEqual([]);
  });
});

describe('which tracked shots count', () => {
  /** A 7 iron on hole 1 from `from` to `to`, each `north` yards up it, or a point. */
  const shot = (roundId: string, from: number | LatLng, to: number | LatLng, starting: Partial<Mark> = {}, finishing: Partial<Mark> = {}) => [
    mark(roundId, 1, 0, full(SEVEN.id), { position: typeof from === 'number' ? at(from) : from, ...starting }),
    mark(roundId, 1, 0, PARTIAL, { position: typeof to === 'number' ? at(to) : to, ...finishing }),
  ];
  const statusOf = (marks: Mark[], rounds: Round[] = [round('r1')], bag: Club[] = BAG) =>
    trackedShots(input(marks, rounds, bag))[SEVEN.id].shots.map((s) => s.status);

  it('counts from the tee, fairway or rough', () => {
    expect(statusOf([...shot('r1', 5, 150), ...shot('r1', 150, 300), ...shot('r1', at(150, 30), 300)])).toEqual(['counts', 'counts', 'counts']);
  });

  it('doesn’t count while the round is still being played, before anything else', () => {
    const fromSandWithNoFinish = mark('r1', 1, 0, full(SEVEN.id), { position: at(210, -12) });
    expect(statusOf([...shot('r1', 150, 300), fromSandWithNoFinish], [round('r1', 'active')])).toEqual(['roundOpen', 'roundOpen']);
  });

  it('counts once the round is posted or abandoned, and stops again when it is reopened', () => {
    const marks = shot('r1', 150, 300);
    expect(statusOf(marks, [round('r1', 'completed')])).toEqual(['counts']);
    expect(statusOf(marks, [round('r1', 'abandoned')])).toEqual(['counts']);
    expect(statusOf(marks, [round('r1', 'active')])).toEqual(['roundOpen']);
  });

  it.each([
    ['sand', at(210, -12)],
    ['water', at(250, 12)],
  ])('doesn’t count from %s, and says where it was from', (lie, from) => {
    const [result] = trackedShots(input(shot('r1', from, 350)))[SEVEN.id].shots;
    expect(result).toMatchObject({ status: 'lie', startLie: lie });
  });

  it('doesn’t count unless both fixes are within 10 m', () => {
    expect(
      statusOf([
        ...shot('r1', 150, 300, { accuracy: 10 }, { accuracy: 10 }),
        ...shot('r1', 150, 300, { accuracy: 10.5 }),
        ...shot('r1', 150, 300, {}, { accuracy: 11 }),
        ...shot('r1', 150, 300, {}, { accuracy: null }),
      ]),
    ).toEqual(['roughFix', 'roughFix', 'roughFix', 'counts']);
  });

  it('doesn’t count a tracked shot that went under 40% of the typed carry: 55 yards of a 150-yard 7 iron, against 65', () => {
    expect(statusOf([...shot('r1', 150, 205), ...shot('r1', 150, 215)])).toEqual(['counts', 'short']);
  });

  it('skips the 40% check for a club with no typed carry', () => {
    expect(statusOf(shot('r1', 150, 200), [round('r1')], [club('7 iron', null)].map((c) => ({ ...c, id: SEVEN.id })))).toEqual(['counts']);
  });

  const counting = (n: number) => Array.from({ length: n }, () => shot('r1', 150, 300)).flat();

  it('counts only the latest 20 tracked shots that pass every other rule', () => {
    // Two shots, then one from sand, which takes no place in the twenty, then twenty more.
    const marks = [...counting(2), ...shot('r1', at(210, -12), 350), ...counting(20)];
    expect(statusOf(marks)).toEqual([...Array(20).fill('counts'), 'lie', 'older', 'older']);
  });

  it('says why each one doesn’t count, in words, and nothing for one that does', () => {
    const marks = [
      ...counting(19),
      ...shot('r1', 150, 300, { accuracy: 30 }),
      ...shot('r1', 150, 205),
      ...shot('r1', 150, 215),
      ...shot('r1', at(210, -12), 350),
      ...shot('r1', at(250, 12), 350),
      ...shot('r1', 400, 405),
      ...counting(2),
      mark('r1', 1, 150, full(SEVEN.id)),
    ];
    expect(trackedShots(input(marks))[SEVEN.id].shots.map(whyNot)).toEqual([
      'no finish',
      null,
      null,
      'from the green',
      'from a penalty area',
      'from sand',
      null,
      'under 40% of carry',
      'GPS too rough',
      ...Array(17).fill(null),
      'older than the latest 20',
      'older than the latest 20',
    ]);
    expect(trackedShots(input(shot('r1', 150, 300), [round('r1', 'active')]))[SEVEN.id].shots.map(whyNot)).toEqual(['round still open']);
  });

  it('says a shot from beyond the course’s edge was from out of bounds', () => {
    const fenced: Course = { ...COURSE, features: [...COURSE.features, feature('courseEdge', box(-20, 420, -40, 40))] };
    const marks = shot('r1', at(150, 60), 300);
    const [result] = trackedShots({ ...input(marks), courses: [fenced] })[SEVEN.id].shots;
    expect(whyNot(result)).toBe('from out of bounds');
  });
});

describe('a club’s tracked carry', () => {
  /** A 7 iron on hole 1 that went `yards` along the fairway. */
  const shotOf = (yards: number) => [mark('r1', 1, 50, full(SEVEN.id)), mark('r1', 1, 50 + yards, PARTIAL)];
  const sevenOf = (...yards: number[]) => trackedShots(input(yards.flatMap(shotOf)))[SEVEN.id];

  it('waits for 5 counting shots', () => {
    expect(sevenOf(140, 150, 155, 160)).toMatchObject({ counting: 4, trackedCarry: null });
  });

  it('is the median inferred carry from 5, to the yard', () => {
    // Inferred carries 135.9, 145.6, 150.5, 155.3 and 165.0: the middle one is 150.5.
    expect(sevenOf(170, 140, 155, 150, 160)).toMatchObject({ counting: 5, trackedCarry: 150 });
  });

  it('is halfway between the middle two of an even count, so one wild shot barely moves it', () => {
    // 150.5 and 155.3 in the middle: 152.9.
    expect(sevenOf(140, 150, 155, 160, 170, 290)).toMatchObject({ counting: 6, trackedCarry: 153 });
  });

  it('leaves out shots that don’t count', () => {
    const seven = trackedShots(input([...[140, 150, 155, 160].flatMap(shotOf), mark('r1', 1, 50, full(SEVEN.id))]))[SEVEN.id];
    expect(seven).toMatchObject({ counting: 4, trackedCarry: null });
  });
});
