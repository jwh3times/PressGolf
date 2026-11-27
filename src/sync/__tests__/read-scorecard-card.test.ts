import { checkRequest, draftFrom, MAX_IMAGE_BASE64 } from '../../../supabase/functions/read-scorecard/card';

/**
 * The checks `read-scorecard` puts between the model and the phone (#384): the
 * request it takes, and every value of a reading, which comes back null when it
 * fails rather than as a guess. The function itself runs in the integration suite.
 */

const photo = { mediaType: 'image/jpeg', data: 'aGVsbG8=' };

/** A tee as the model reads one: `holes` values for every hole, unless given. */
function tee(holeCount: number, overrides: Record<string, unknown> = {}) {
  return {
    name: 'White',
    slope: 128,
    rating: 71.2,
    yards: Array.from({ length: holeCount }, () => 380),
    par: Array.from({ length: holeCount }, () => 4),
    strokeIndex: Array.from({ length: holeCount }, (_, i) => i + 1),
    ...overrides,
  };
}

describe('the request read-scorecard takes', () => {
  it('takes one to 4 photos of one card, in tee card mode', () => {
    expect(checkRequest({ mode: 'teeCard', images: [photo] })).toEqual({ ok: true, mode: 'teeCard', images: [photo] });
    expect(checkRequest({ mode: 'teeCard', images: [photo, photo, photo, photo] })).toMatchObject({ ok: true });
  });

  it('refuses no photos, more than 4, and no mode or another one', () => {
    expect(checkRequest({ mode: 'teeCard', images: [] })).toEqual({ ok: false, reason: 'Send one to 4 photos of one card.' });
    expect(checkRequest({ mode: 'teeCard', images: [photo, photo, photo, photo, photo] })).toMatchObject({ ok: false });
    expect(checkRequest({ mode: 'teeCard' })).toMatchObject({ ok: false });
    expect(checkRequest({ images: [photo] })).toEqual({ ok: false, reason: 'Say which mode to read in: teeCard.' });
    expect(checkRequest({ mode: 'scores', images: [photo] })).toMatchObject({ ok: false });
    expect(checkRequest(null)).toMatchObject({ ok: false });
  });

  it('refuses a photo that isn’t an image, isn’t base64, or is too large', () => {
    expect(checkRequest({ mode: 'teeCard', images: [{ mediaType: 'application/pdf', data: 'aGVsbG8=' }] })).toEqual({
      ok: false,
      reason: 'A photo has to be a JPEG, PNG or WebP image.',
    });
    expect(checkRequest({ mode: 'teeCard', images: [{ mediaType: 'image/png', data: 'not base64!' }] })).toEqual({
      ok: false,
      reason: 'A photo has to be sent as base64.',
    });
    expect(checkRequest({ mode: 'teeCard', images: [{ mediaType: 'image/png', data: '' }] })).toMatchObject({ ok: false });
    expect(checkRequest({ mode: 'teeCard', images: [{ mediaType: 'image/webp', data: 'A'.repeat(MAX_IMAGE_BASE64 + 1) }] })).toEqual({
      ok: false,
      reason: 'A photo is too large: keep each under 5 MB.',
    });
    expect(checkRequest({ mode: 'teeCard', images: [{ mediaType: 'image/webp', data: 'A'.repeat(MAX_IMAGE_BASE64) }] })).toMatchObject({ ok: true });
  });
});

describe('a reading, checked into a draft tee card', () => {
  it('keeps every value a real card gives, hole by hole', () => {
    const draft = draftFrom({ holeCount: 18, tees: [tee(18)] })!;
    expect(draft.holeCount).toBe(18);
    expect(draft.tees).toHaveLength(1);
    expect(draft.tees[0]).toMatchObject({ name: 'White', slope: 128, rating: 71.2 });
    expect(draft.tees[0].holes[0]).toEqual({ number: 1, par: 4, strokeIndex: 1, yards: 380 });
    expect(draft.tees[0].holes[17]).toEqual({ number: 18, par: 4, strokeIndex: 18, yards: 380 });
  });

  it('leaves what the card didn’t give blank', () => {
    const draft = draftFrom({ holeCount: 9, tees: [tee(9, { name: null, slope: null, rating: null, yards: [], par: [5, null], strokeIndex: [] })] })!;
    expect(draft.tees[0]).toMatchObject({ name: null, slope: null, rating: null });
    expect(draft.tees[0].holes[0]).toEqual({ number: 1, par: 5, strokeIndex: null, yards: null });
    expect(draft.tees[0].holes[1]).toEqual({ number: 2, par: null, strokeIndex: null, yards: null });
    expect(draft.tees[0].holes).toHaveLength(9);
  });

  it('blanks a stroke index repeated on a tee, both holes of it, and keeps the rest', () => {
    const indexes = Array.from({ length: 18 }, (_, i) => i + 1);
    indexes[4] = 3;
    const draft = draftFrom({ holeCount: 18, tees: [tee(18, { strokeIndex: indexes })] })!;
    const read = draft.tees[0].holes.map((h) => h.strokeIndex);
    expect(read[2]).toBeNull();
    expect(read[4]).toBeNull();
    expect(read.filter((index) => index !== null)).toHaveLength(16);
    expect(read[0]).toBe(1);
  });

  it('blanks a stroke index that isn’t one of the holes', () => {
    const draft = draftFrom({ holeCount: 9, tees: [tee(9, { strokeIndex: [10, 0, 2.5, 4, 5, 6, 7, 8, 9] })] })!;
    expect(draft.tees[0].holes.slice(0, 4).map((h) => h.strokeIndex)).toEqual([null, null, null, 4]);
  });

  it('blanks a par, slope, rating or yards out of range', () => {
    const draft = draftFrom({ holeCount: 18, tees: [tee(18, { slope: 160, rating: 90, par: [2, 7, 3, 6, 4.5], yards: [39, 751, 40, 750] })] })!;
    const [t] = draft.tees;
    expect(t.slope).toBeNull();
    expect(t.rating).toBeNull();
    expect(t.holes.slice(0, 5).map((h) => h.par)).toEqual([null, null, 3, 6, null]);
    expect(t.holes.slice(0, 4).map((h) => h.yards)).toEqual([null, null, 40, 750]);
  });

  it('holds slope to 55–155 and the rating to the hole count, to one decimal', () => {
    const edge = (holeCount: 9 | 18, slope: number, rating: number) => draftFrom({ holeCount, tees: [tee(holeCount, { slope, rating })] })!.tees[0];
    expect(edge(18, 55, 55)).toMatchObject({ slope: 55, rating: 55 });
    expect(edge(18, 155, 85)).toMatchObject({ slope: 155, rating: 85 });
    expect(edge(18, 54, 54.9)).toMatchObject({ slope: null, rating: null });
    expect(edge(18, 156, 85.1)).toMatchObject({ slope: null, rating: null });
    expect(edge(18, 113, 71.24)).toMatchObject({ rating: 71.2 });
    // A nine-hole rating is half an eighteen's.
    expect(edge(9, 113, 35.6)).toMatchObject({ rating: 35.6 });
    expect(edge(9, 113, 27)).toMatchObject({ rating: 27 });
    expect(edge(9, 113, 43)).toMatchObject({ rating: 43 });
    expect(edge(9, 113, 43.1)).toMatchObject({ rating: null });
    expect(edge(9, 113, 71.2)).toMatchObject({ rating: null });
    expect(edge(9, 113, 26.9)).toMatchObject({ rating: null });
    expect(edge(18, 113, 35.6)).toMatchObject({ rating: null });
  });

  it('trims a tee name, and blanks an empty one', () => {
    expect(draftFrom({ holeCount: 9, tees: [tee(9, { name: '  Blue  ' })] })!.tees[0].name).toBe('Blue');
    expect(draftFrom({ holeCount: 9, tees: [tee(9, { name: '   ' })] })!.tees[0].name).toBeNull();
    expect(draftFrom({ holeCount: 9, tees: [tee(9, { name: 'x'.repeat(60) })] })!.tees[0].name).toHaveLength(40);
  });

  it('keeps up to 12 tees, more than any card prints, and drops the misread rest', () => {
    const tees = Array.from({ length: 14 }, (_, i) => tee(9, { name: `Tee ${i + 1}` }));
    expect(draftFrom({ holeCount: 9, tees })!.tees.map((t) => t.name)).toEqual(Array.from({ length: 12 }, (_, i) => `Tee ${i + 1}`));
  });

  it('ranks a nine-hole card’s indexes printed on the eighteen-hole scale into 1 to 9, in order', () => {
    const odd = [9, 1, 17, 5, 13, 3, 15, 7, 11];
    expect(draftFrom({ holeCount: 9, tees: [tee(9, { strokeIndex: odd })] })!.tees[0].holes.map((h) => h.strokeIndex)).toEqual([5, 1, 9, 3, 7, 2, 8, 4, 6]);
    // Indexes already 1 to 9 stay as they are, and one 10 among them ranks to 9.
    expect(draftFrom({ holeCount: 9, tees: [tee(9, { strokeIndex: [3, 1, 2, 4, 5, 6, 7, 8, 9] })] })!.tees[0].holes.map((h) => h.strokeIndex)).toEqual([3, 1, 2, 4, 5, 6, 7, 8, 9]);
    expect(draftFrom({ holeCount: 9, tees: [tee(9, { strokeIndex: [10, 1, 2, 3, 4, 5, 6, 7, 8] })] })!.tees[0].holes.map((h) => h.strokeIndex)).toEqual([9, 1, 2, 3, 4, 5, 6, 7, 8]);
    const even = [10, 2, 18, 6, 14, 4, 16, 8, 12];
    expect(draftFrom({ holeCount: 9, tees: [tee(9, { strokeIndex: even })] })!.tees[0].holes.map((h) => h.strokeIndex)).toEqual([5, 1, 9, 3, 7, 2, 8, 4, 6]);
    // With one missing, or one repeated, the order can't be trusted: the usual checks blank what's past 9.
    const missing = [9, 1, 17, 5, 13, 3, 15, 7, null];
    expect(draftFrom({ holeCount: 9, tees: [tee(9, { strokeIndex: missing })] })!.tees[0].holes.map((h) => h.strokeIndex)).toEqual([9, 1, null, 5, null, 3, null, 7, null]);
    const repeated = [9, 1, 17, 5, 13, 3, 15, 7, 7];
    expect(draftFrom({ holeCount: 9, tees: [tee(9, { strokeIndex: repeated })] })!.tees[0].holes.map((h) => h.strokeIndex)).toEqual([9, 1, null, 5, null, 3, null, null, null]);
  });

  it('tells 9 holes from 18 by the hole rows when the model gave no count', () => {
    expect(draftFrom({ holeCount: null, tees: [tee(18)] })!.holeCount).toBe(18);
    expect(draftFrom({ tees: [tee(9, { par: [], yards: [] })] })!.holeCount).toBe(9);
  });

  it("is no scorecard at all without a tee, or without a way to tell 9 holes from 18", () => {
    expect(draftFrom({ holeCount: 27, tees: [tee(27)] })).toBeNull();
    expect(draftFrom({ holeCount: null, tees: [tee(12)] })).toBeNull();
    expect(draftFrom({ holeCount: null, tees: [{ name: 'White' }] })).toBeNull();
    expect(draftFrom({ holeCount: 18, tees: [] })).toBeNull();
    expect(draftFrom({ holeCount: 18 })).toBeNull();
    expect(draftFrom(null)).toBeNull();
  });
});
