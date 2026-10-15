import { bearing, frame, holePlan } from '../../domain/hole-map';
import type { Course, LatLng } from '../../domain/types';
import { makeTestCourse } from '../../domain/__tests__/helpers';
import { fit, holeView } from '../HoleDiagram';

const ORIGIN: LatLng = { lat: 45.5, lng: -122.6 };
// A 400 m hole running north-east.
const toGreen = frame(ORIGIN, 45).toLatLng([0, 400]);
const course: Course = {
  ...makeTestCourse(),
  greens: [{ number: 1, middle: toGreen, front: null, back: null, source: 'osm' }],
  features: [{ id: 'line', kind: 'holeLine', hole: 1, points: [ORIGIN, toGreen], source: 'osm' }],
};
const plan = holePlan(course, 1);

describe('holeView', () => {
  it('plays up the drawing by default, tee at the bottom', () => {
    const view = holeView(plan, [])!;
    expect(view.heading).toBeCloseTo(bearing(ORIGIN, toGreen), 6);
    const [, teeY] = view.frame.toXY(ORIGIN);
    const [, greenY] = view.frame.toXY(toGreen);
    expect(greenY - teeY).toBeCloseTo(400, 0);
    expect(view.maxY - view.minY).toBeGreaterThan(view.maxX - view.minX);
  });

  it('plays left to right across, tee on the left, for a short, wide drawing', () => {
    const view = holeView(plan, [], true)!;
    expect(view.heading).toBeCloseTo((bearing(ORIGIN, toGreen) - 90 + 360) % 360, 6);
    const [teeX, teeY] = view.frame.toXY(ORIGIN);
    const [greenX, greenY] = view.frame.toXY(toGreen);
    expect(greenX - teeX).toBeCloseTo(400, 0);
    expect(greenY - teeY).toBeCloseTo(0, 6);
    expect(view.maxX - view.minX).toBeGreaterThan(view.maxY - view.minY);
    // Across a wide drawing the hole fills the width, so the tee is left of the green on screen.
    const { toPx } = fit(view, 360, 150);
    expect(toPx(view.frame.toXY(ORIGIN))[0]).toBeLessThan(toPx(view.frame.toXY(toGreen))[0]);
  });

  it('has nothing to frame without a green or a line', () => {
    expect(holeView(holePlan({ ...course, greens: [], features: [] }, 1), [])).toBeNull();
  });
});
