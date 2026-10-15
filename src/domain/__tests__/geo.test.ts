import {
  goodEnoughToMark,
  greenFor,
  MARK_ACCURACY_M,
  metresBetween,
  withGreen,
  withImported,
  yardsBetween,
  yardsToGreen,
} from '../geo';
import type { Green } from '../types';

// Torrey Pines South, 3rd: where OpenStreetMap's line for the hole starts, and
// the middle of its green there. The card says 200 yards from the back tee.
const TEE = { lat: 32.899236, lng: -117.249958 };
const GREEN_MIDDLE = { lat: 32.89773, lng: -117.250716 };

const green = (number: number, extra: Partial<Green> = {}): Green => ({
  number,
  middle: GREEN_MIDDLE,
  front: null,
  back: null,
  source: 'marked',
  ...extra,
});

describe('distances', () => {
  it('is nothing from a point to itself', () => {
    expect(metresBetween(TEE, TEE)).toBe(0);
  });

  it('measures a degree of latitude as about 111 km', () => {
    expect(metresBetween({ lat: 0, lng: 0 }, { lat: 1, lng: 0 })).toBeCloseTo(111_195, -1);
  });

  it('shrinks a degree of longitude towards the poles', () => {
    const atEquator = metresBetween({ lat: 0, lng: 0 }, { lat: 0, lng: 1 });
    const at60 = metresBetween({ lat: 60, lng: 0 }, { lat: 60, lng: 1 });
    expect(at60 / atEquator).toBeCloseTo(0.5, 3);
  });

  it('is the same both ways', () => {
    expect(metresBetween(TEE, GREEN_MIDDLE)).toBe(metresBetween(GREEN_MIDDLE, TEE));
  });

  it('gives a real par 3 the length on its card, in whole yards', () => {
    const yards = yardsBetween(TEE, GREEN_MIDDLE);
    expect(Number.isInteger(yards)).toBe(true);
    expect(Math.abs(yards - 200)).toBeLessThanOrEqual(5);
  });
});

describe('yards to a green', () => {
  it('gives only the middle when that is all that is known', () => {
    expect(yardsToGreen(TEE, green(3))).toEqual({ front: null, middle: yardsBetween(TEE, GREEN_MIDDLE), back: null });
  });

  it('gives front, middle and back when all three are known', () => {
    // Twelve metres short of the middle and twelve past it, along the line of play.
    const front = { lat: 32.897828, lng: -117.250667 };
    const back = { lat: 32.897632, lng: -117.250765 };
    const yards = yardsToGreen(TEE, green(3, { front, back, source: 'osm' }));
    expect(yards.front).toBeLessThan(yards.middle);
    expect(yards.back).toBeGreaterThan(yards.middle);
  });
});

describe('marking a green', () => {
  it(`takes a fix good to ${MARK_ACCURACY_M} m or better`, () => {
    expect(goodEnoughToMark(4)).toBe(true);
    expect(goodEnoughToMark(MARK_ACCURACY_M)).toBe(true);
    expect(goodEnoughToMark(MARK_ACCURACY_M + 1)).toBe(false);
  });

  it('refuses a fix that does not say how accurate it is', () => {
    expect(goodEnoughToMark(null)).toBe(false);
    expect(goodEnoughToMark(undefined)).toBe(false);
  });
});

describe('a course\'s greens', () => {
  it('finds the green for a hole, or nothing', () => {
    const greens = [green(1), green(3)];
    expect(greenFor(greens, 3)).toBe(greens[1]);
    expect(greenFor(greens, 2)).toBeNull();
  });

  it('replaces a hole\'s green rather than adding a second, and keeps hole order', () => {
    const moved = green(3, { middle: TEE });
    expect(withGreen([green(5), green(3), green(1)], moved).map((g) => [g.number, g.middle])).toEqual([
      [1, GREEN_MIDDLE],
      [3, TEE],
      [5, GREEN_MIDDLE],
    ]);
  });
});

describe('importing greens', () => {
  it('fills holes with no green, keeps the course\'s own, and replaces an earlier import', () => {
    const existing = [green(1), green(2, { source: 'osm' }), green(3, { source: 'map' })];
    const imported = [1, 2, 3, 4].map((n) => green(n, { middle: TEE, source: 'osm' }));
    const { greens, kept } = withImported(existing, imported);
    expect(greens.map((g) => [g.number, g.source, g.middle])).toEqual([
      [1, 'marked', GREEN_MIDDLE],
      [2, 'osm', TEE],
      [3, 'map', GREEN_MIDDLE],
      [4, 'osm', TEE],
    ]);
    expect(kept).toEqual([1, 3]);
  });

  it('drops an earlier import\'s green for a hole the new import has nothing for', () => {
    expect(withImported([green(2, { source: 'osm' })], []).greens).toEqual([]);
  });
});
