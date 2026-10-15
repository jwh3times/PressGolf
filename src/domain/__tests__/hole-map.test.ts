import { featuresFromOsm } from '../../osm/features';
import { greensFromOsm, type OsmElement } from '../../osm/greens';
import torrey from '../../osm/__tests__/torrey-south.json';
import { metresBetween, yardsBetween } from '../geo';
import {
  aroundGreen,
  bearing,
  CORRIDOR_M,
  defaultTarget,
  edgesNear,
  frame,
  hazardsBetween,
  holePlan,
  ON_HOLE_M,
  pointShort,
  vantage,
} from '../hole-map';
import type { Course, CourseFeature, FeatureKind, Green, LatLng } from '../types';
import { makeTestCourse } from './helpers';

const ORIGIN: LatLng = { lat: 45.5, lng: -122.6 };
const flat = frame(ORIGIN, 0);
/** A point `north` and `east` metres from the origin. */
const at = (north: number, east = 0): LatLng => flat.toLatLng([east, north]);
/** A rectangle from `south` to `north`, `west` to `east`, in metres from the origin. */
const box = (south: number, north: number, west: number, east: number) => [at(south, west), at(south, east), at(north, east), at(north, west)];

let ids = 0;
const feature = (kind: FeatureKind, points: LatLng[], hole: number | null = null): CourseFeature => ({
  id: `f${ids++}`,
  kind,
  hole,
  points,
  source: 'osm',
});
const green = (number: number, middle: LatLng): Green => ({ number, middle, front: null, back: null, source: 'osm' });

/** A course of `features` and greens, on the test course's card. */
const courseWith = (features: CourseFeature[], greens: Green[] = []): Course => ({ ...makeTestCourse(), features, greens });

describe('frame', () => {
  it('turns the heading up the screen, with the right hand to the right, and back again', () => {
    const east = frame(ORIGIN, 90);
    const [x, y] = east.toXY(at(0, 100));
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(100, 6);
    expect(east.toXY(at(-50, 0))[0]).toBeCloseTo(50, 6);
    const back = east.toLatLng(east.toXY(at(37, -12)));
    expect(metresBetween(back, at(37, -12))).toBeLessThan(0.001);
  });

  it('measures bearings clockwise from north', () => {
    expect(bearing(ORIGIN, at(100))).toBeCloseTo(0, 3);
    expect(bearing(ORIGIN, at(0, 100))).toBeCloseTo(90, 3);
    expect(bearing(ORIGIN, at(-100))).toBeCloseTo(180, 3);
    expect(bearing(ORIGIN, at(0, -100))).toBeCloseTo(270, 3);
  });
});

describe('holePlan', () => {
  const line = feature('holeLine', [at(0), at(300)], 1);
  const near = feature('bunker', box(150, 160, 30, 45));
  const far = feature('bunker', box(150, 160, CORRIDOR_M + 20, CORRIDOR_M + 30));
  const fairway = feature('fairway', box(-50, 400, -40, 40));
  const edge = feature('courseEdge', box(-2000, 2000, -2000, 2000));
  const other = feature('holeLine', [at(0, 500), at(300, 500)], 2);

  it('keeps the hole\'s own line and green, what lies near it, and the course\'s edge', () => {
    const plan = holePlan(courseWith([line, near, far, fairway, edge, other], [green(1, at(300)), green(2, at(300, 500))]), 1);
    expect(plan.line).toEqual(line.points);
    expect(plan.tee).toEqual(at(0));
    expect(plan.green?.number).toBe(1);
    expect(plan.features.map((f) => f.id).sort()).toEqual([line.id, near.id, fairway.id, edge.id].sort());
  });

  it('keeps a lake whose shore runs beside the line though every corner is far from it', () => {
    const lake = feature('water', [at(100, 30), at(100, 400), at(200, 400), at(200, 30)]);
    expect(holePlan(courseWith([line, lake]), 1).features.map((f) => f.id)).toContain(lake.id);
  });

  it('centres on the green when the hole has no line, and is empty when it has neither', () => {
    const plan = holePlan(courseWith([feature('bunker', box(290, 300, 20, 30))], [green(1, at(300))]), 1);
    expect(plan).toMatchObject({ line: null, tee: null });
    expect(plan.features).toHaveLength(1);
    expect(holePlan(courseWith([near]), 1)).toEqual({ number: 1, line: null, tee: null, green: null, features: [] });
  });
});

describe('vantage', () => {
  const plan = holePlan(courseWith([feature('holeLine', [at(0), at(300)], 1)], [green(1, at(300))]), 1);

  it('measures from the phone on the hole, and from the tee anywhere else', () => {
    expect(vantage(plan, at(120, 10))).toEqual({ from: at(120, 10), fromTee: false });
    expect(vantage(plan, at(300 + ON_HOLE_M + 10))).toEqual({ from: at(0), fromTee: true });
    expect(vantage(plan, null)).toEqual({ from: at(0), fromTee: true });
  });

  it('has nowhere to measure from with no tee and the phone away', () => {
    const noLine = holePlan(courseWith([], [green(1, at(300))]), 1);
    expect(vantage(noLine, null)).toBeNull();
    expect(vantage(noLine, at(250))).toEqual({ from: at(250), fromTee: false });
  });
});

describe('defaultTarget', () => {
  // A dogleg right: 250 m north, then 150 m east to the green.
  const dogleg = holePlan(courseWith([feature('holeLine', [at(0), at(250), at(250, 150)], 1)], [green(1, at(252, 150))]), 1);

  it('aims at the bend of a dogleg from the tee, and at the green once past it', () => {
    expect(defaultTarget(dogleg, at(0))).toEqual(at(250));
    expect(defaultTarget(dogleg, at(230, 5))).toEqual(at(252, 150));
    expect(defaultTarget(dogleg, at(255, 60))).toEqual(at(252, 150));
  });

  it('aims at the green on a straight hole, or the line\'s end with no green', () => {
    const straight = holePlan(courseWith([feature('holeLine', [at(0), at(300)], 1)]), 1);
    expect(defaultTarget(straight, at(0))).toEqual(at(300));
  });
});

describe('pointShort', () => {
  const dogleg = holePlan(courseWith([feature('holeLine', [at(0), at(250), at(250, 150)], 1)], [green(1, at(250, 150))]), 1);

  it('measures back along the line of play, round the bend', () => {
    expect(metresBetween(pointShort(dogleg, at(0), 100)!, at(250, 50))).toBeLessThan(0.01);
    expect(metresBetween(pointShort(dogleg, at(0), 200)!, at(200))).toBeLessThan(0.01);
  });

  it('measures along the straight with no line, and finds nothing past the tee', () => {
    const noLine = holePlan(courseWith([], [green(1, at(300))]), 1);
    expect(metresBetween(pointShort(noLine, at(0), 100)!, at(200))).toBeLessThan(0.01);
    expect(pointShort(dogleg, at(0), 1000)).toBeNull();
    expect(pointShort(holePlan(courseWith([]), 1), at(0), 100)).toBeNull();
  });
});

describe('hazardsBetween', () => {
  const yards = (m: number) => Math.round(m / 0.9144);
  const target = at(300);

  it('reads a bunker beside the line: its side, its front and its far end', () => {
    const [reading] = hazardsBetween(at(0), target, [feature('bunker', box(200, 230, 15, 30))]);
    expect(reading).toMatchObject({ side: 'right', front: yards(Math.hypot(200, 15)), back: yards(Math.hypot(230, 30)), carry: null });
    expect(hazardsBetween(at(0), target, [feature('bunker', box(200, 230, -30, -15))])[0].side).toBe('left');
  });

  it('gives the carry over water across the line', () => {
    const [reading] = hazardsBetween(at(0), target, [feature('water', box(180, 210, -60, 60))]);
    expect(reading).toMatchObject({ side: 'across', front: yards(180), carry: yards(210) });
  });

  it('leaves out what is behind, too far either side, or well past the target', () => {
    expect(
      hazardsBetween(at(0), target, [
        feature('bunker', box(-40, -20, -5, 5)),
        feature('bunker', box(100, 120, 45, 60)),
        feature('water', box(340, 360, -30, 30)),
      ]),
    ).toEqual([]);
    expect(hazardsBetween(at(0), target, [feature('bunker', box(310, 325, -10, 10))])).toHaveLength(1);
  });

  it('reads zero to the front from inside a bunker, and leaves fairways and the edge to others', () => {
    const [reading] = hazardsBetween(at(0), target, [
      feature('bunker', box(-5, 10, -5, 5)),
      feature('fairway', box(0, 300, -30, 30)),
      feature('courseEdge', box(-500, 500, -500, 500)),
      feature('outOfBounds', [at(0, 20), at(300, 20)]),
    ]);
    expect(reading).toMatchObject({ front: 0, side: 'across' });
    expect(hazardsBetween(at(0), target, [feature('fairway', box(0, 300, -30, 30))])).toEqual([]);
  });

  it('keeps nearest first', () => {
    const readings = hazardsBetween(at(0), target, [
      feature('bunker', box(250, 260, 10, 20), null),
      feature('lateralWater', box(100, 280, -50, -20)),
    ]);
    expect(readings.map((r) => r.feature.kind)).toEqual(['lateralWater', 'bunker']);
  });
});

describe('aroundGreen', () => {
  it('reads the hazards guarding the green from where you are, and nothing else', () => {
    const pond = feature('water', box(270, 290, -30, 30));
    const greenside = feature('bunker', box(300, 315, 18, 28));
    const fairwayBunker = feature('bunker', box(150, 170, 15, 25));
    const plan = holePlan(courseWith([feature('holeLine', [at(0), at(300)], 1), pond, greenside, fairwayBunker], [green(1, at(300))]), 1);
    const readings = aroundGreen(plan, at(50));
    expect(readings.map((r) => r.feature.id)).toEqual([pond.id, greenside.id]);
    expect(readings[0]).toMatchObject({ side: 'across', front: Math.round(220 / 0.9144), carry: Math.round(240 / 0.9144) });
  });

  it('has nothing to say without a green', () => {
    expect(aroundGreen(holePlan(courseWith([feature('holeLine', [at(0), at(300)], 1)]), 1), at(0))).toEqual([]);
  });
});

describe('edgesNear', () => {
  const target = at(250);

  it('says how far the course edge and an out-of-bounds line are from the target, and which side', () => {
    const readings = edgesNear(at(0), target, [
      feature('courseEdge', box(-100, 400, -200, 25)),
      feature('outOfBounds', [at(100, -30), at(400, -30)]),
    ]);
    expect(readings).toEqual([
      { kind: 'courseEdge', side: 'right', yards: Math.round(25 / 0.9144) },
      { kind: 'outOfBounds', side: 'left', yards: Math.round(30 / 0.9144) },
    ]);
  });

  it('reads zero for a target past the edge, and nothing for an edge well away', () => {
    expect(edgesNear(at(0), target, [feature('courseEdge', box(-100, 200, -100, 100))])).toEqual([
      { kind: 'courseEdge', side: expect.any(String), yards: 0 },
    ]);
    expect(edgesNear(at(0), target, [feature('courseEdge', box(-500, 500, -500, 500))])).toEqual([]);
  });
});

describe('a real hole: Torrey Pines South, the third', () => {
  const elements = torrey.elements as unknown as OsmElement[];
  const course = courseWith(featuresFromOsm(elements, 18), greensFromOsm(elements, 18).greens);
  const plan = holePlan(course, 3);
  const from = plan.tee!;
  const target = defaultTarget(plan, from)!;

  it('plays a straight par three from the tee to the middle of the green', () => {
    expect(target).toEqual(plan.green!.middle);
    expect(yardsBetween(from, target)).toBeGreaterThan(180);
    expect(yardsBetween(from, target)).toBeLessThan(215);
  });

  it('reads the greenside bunkers short of and beside the green, none behind the tee', () => {
    const readings = hazardsBetween(from, target, plan.features);
    expect(readings.length).toBeGreaterThan(0);
    for (const reading of readings) {
      expect(reading.feature.kind).toBe('bunker');
      expect(reading.front).toBeGreaterThan(100);
      expect(reading.back).toBeGreaterThanOrEqual(reading.front);
      expect(reading.back).toBeLessThan(yardsBetween(from, target) + 40);
    }
  });
});
