import { calculatePops } from '../handicap';
import type { Hole, Tee } from '../types';

/** A tee with the given slope and rating whose pars add up to `par`, using par 4s and par 3s. */
function tee(id: string, slope: number, rating: number, par: number, holeCount = 18): Tee {
  const threes = holeCount * 4 - par;
  const holes: Hole[] = Array.from({ length: holeCount }, (_, i) => ({
    number: i + 1,
    par: i < threes ? 3 : 4,
    strokeIndex: i + 1,
    yards: 0,
  }));
  return { id, name: id, slope, rating, holes };
}

const blue = tee('blue', 128, 71.2, 70);

describe('course handicap', () => {
  it('scales the index by slope and adds rating minus par, rounded', () => {
    // 12.4 × 128 / 113 + (71.2 − 70) = 15.25
    const result = calculatePops([{ id: 'a', index: 12.4, tee: blue }], { strokes: 'full', allowance: 100 });
    expect(result.a).toMatchObject({ pops: 15 });
  });

  it('halves the index on a 9-hole course', () => {
    // 14.0 ÷ 2 × 120 / 113 + (35.5 − 36) = 6.93
    const nine = tee('nine', 120, 35.5, 36, 9);
    const result = calculatePops([{ id: 'a', index: 14, tee: nine }], { strokes: 'full', allowance: 100 });
    expect(result.a).toMatchObject({ pops: 7 });
  });

  it('rounds the halved index to the nearest tenth first (WHS Rule 6.1b)', () => {
    // 14.5 ÷ 2 = 7.25 → 7.3; 7.3 × 113 / 113 + (35.2 − 36) = 6.5 → 7.
    // Without the tenth, 6.45 would round to 6.
    const nine = tee('nine', 113, 35.2, 36, 9);
    const result = calculatePops([{ id: 'a', index: 14.5, tee: nine }], { strokes: 'full', allowance: 100 });
    expect(result.a).toMatchObject({ pops: 7 });
  });
});

describe('allowance', () => {
  it('applies to the unrounded course handicap, rounding once (WHS Rule 6.2a)', () => {
    // The rule's own example: CR 71.0, slope 125, par 71, 85%. Rounding the course
    // handicap first would give both players 9.
    const white = tee('white', 125, 71.0, 71);
    const result = calculatePops(
      [
        { id: 'a', index: 8.6, tee: white },
        { id: 'b', index: 10.3, tee: white },
      ],
      { strokes: 'full', allowance: 85 },
    );
    expect(result.a).toMatchObject({ pops: 8 });
    expect(result.b).toMatchObject({ pops: 10 });
  });
});

describe('plus handicaps', () => {
  it('comes out negative, rounding .5 towards zero (WHS Appendix C)', () => {
    // A +2.5 index is stored as −2.5. On a neutral tee the playing handicap is +2.5 → +2.
    const neutral = tee('neutral', 113, 72, 72);
    const result = calculatePops([{ id: 'a', index: -2.5, tee: neutral }], { strokes: 'full', allowance: 100 });
    expect(result.a).toMatchObject({ pops: -2 });
  });
});

describe('off the low man', () => {
  it('subtracts the lowest playing handicap, each from their own tee', () => {
    const white = tee('white', 120, 69.0, 70);
    const result = calculatePops(
      [
        { id: 'a', index: 12.4, tee: blue }, // 15
        { id: 'b', index: 4.0, tee: white }, // 4.0 × 120 / 113 − 1 = 3.25 → 3
        { id: 'c', index: 20.0, tee: blue }, // 20.0 × 128 / 113 + 1.2 = 23.85 → 24
      ],
      { strokes: 'off_low', allowance: 100 },
    );
    expect(result.a).toMatchObject({ pops: 12 });
    expect(result.b).toMatchObject({ pops: 0 });
    expect(result.c).toMatchObject({ pops: 21 });
  });

  it('flags a player with no index and leaves them out of the low man', () => {
    const result = calculatePops(
      [
        { id: 'a', index: 12.4, tee: blue }, // 15
        { id: 'c', index: 20.0, tee: blue }, // 24
        { id: 'd', index: null, tee: blue },
      ],
      { strokes: 'off_low', allowance: 100 },
    );
    expect(result.a).toMatchObject({ pops: 0 });
    expect(result.c).toMatchObject({ pops: 9 });
    expect(result.d).toEqual({ noIndex: true });
  });
});
