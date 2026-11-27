import { canSave, courseField, describePlace, draftFromScan, edited, holeField, markOn, stillNeeded, teeField, type CourseDraft } from '../course-draft';
import { makeTestCourse } from './helpers';

const course = makeTestCourse();
const tee = course.tees[0];

/** A draft whose name, slope and first two holes' pars came from a scan. */
function scanned(): CourseDraft {
  return {
    course,
    marks: {
      [courseField('name')]: 'scan',
      [teeField(tee.id, 'slope')]: 'scan',
      [holeField(tee.id, 1, 'par')]: 'scan',
      [holeField(tee.id, 2, 'par')]: 'osm',
    },
  };
}

const withPar = (number: number, par: number) => ({
  ...course,
  tees: [{ ...tee, holes: tee.holes.map((h) => (h.number === number ? { ...h, par } : h)) }],
});

describe('a draft course (#383)', () => {
  it('confirms a value the golfer changes, and leaves the rest marked', () => {
    const after = edited(scanned(), withPar(1, 5));
    expect(after.course.tees[0].holes[0].par).toBe(5);
    expect(Object.keys(after.marks).sort()).toEqual(
      [courseField('name'), teeField(tee.id, 'slope'), holeField(tee.id, 2, 'par')].sort(),
    );
  });

  it('confirms a tee value and the name the same way', () => {
    const after = edited(scanned(), { ...course, name: 'Pine Hollow North', tees: [{ ...tee, slope: 131 }] });
    expect(after.marks).toEqual({ [holeField(tee.id, 1, 'par')]: 'scan', [holeField(tee.id, 2, 'par')]: 'osm' });
  });

  it('keeps every mark through a change no mark is on, such as a new tee', () => {
    const draft = scanned();
    const after = edited(draft, { ...course, tees: [...course.tees, { ...tee, id: 'red', name: 'Red' }] });
    expect(after.marks).toEqual(draft.marks);
  });

  it('names the first marked field among those asked about', () => {
    const { marks } = scanned();
    expect(markOn(marks, holeField(tee.id, 3, 'par'), holeField(tee.id, 2, 'par'))).toBe('osm');
    expect(markOn(marks, holeField(tee.id, 3, 'par'))).toBeNull();
  });

  it('says what a draft still needs before it saves, in order', () => {
    const at = { lat: 45.5, lng: -122.6 };
    const blank = { ...course, tees: [{ ...tee, name: ' ', holes: tee.holes.map((h, i) => (i === 0 ? { ...h, strokeIndex: 0 } : h)) }] };
    expect(stillNeeded({ course: { ...blank, name: '' }, marks: {} })).toEqual([
      'give it a name',
      'name every tee',
      'fill in every hole’s par and stroke index',
      'say where it is',
    ]);
    const parBlank = { ...course, location: at, tees: [{ ...tee, holes: tee.holes.map((h, i) => (i === 3 ? { ...h, par: 0 } : h)) }] };
    expect(stillNeeded({ course: parBlank, marks: {} })).toEqual(['fill in every hole’s par and stroke index']);
    expect(canSave({ course: parBlank, marks: {} })).toBe(false);
    expect(stillNeeded({ course: { ...course, location: at }, marks: {} })).toEqual([]);
  });

  it('won’t save a tee with one stroke index on two holes, and counts blanks as no index yet', () => {
    const at = { lat: 45.5, lng: -122.6 };
    const twice = { ...course, location: at, tees: [{ ...tee, holes: tee.holes.map((h, i) => (i === 1 ? { ...h, strokeIndex: tee.holes[0].strokeIndex } : h)) }] };
    expect(stillNeeded({ course: twice, marks: {} })).toEqual(['give each hole on a tee its own stroke index']);
    const blanks = { ...course, location: at, tees: [{ ...tee, holes: tee.holes.map((h, i) => (i < 2 ? { ...h, strokeIndex: 0 } : h)) }] };
    expect(stillNeeded({ course: blanks, marks: {} })).toEqual(['fill in every hole’s par and stroke index']);
  });

  it('saves only with a name and a location', () => {
    const at = { lat: 45.5, lng: -122.6 };
    expect(canSave({ course, marks: {} })).toBe(false);
    expect(canSave({ course: { ...course, location: at }, marks: {} })).toBe(true);
    expect(canSave({ course: { ...course, name: '  ', location: at }, marks: {} })).toBe(false);
  });

  it('makes a draft from a scan: what it read, marked, and blank where it read nothing (#385)', () => {
    const read = {
      holeCount: 9 as const,
      tees: [
        {
          name: 'White',
          slope: 120,
          rating: null,
          holes: [
            { number: 1, par: 4, strokeIndex: 3, yards: 380 },
            { number: 2, par: null, strokeIndex: null, yards: null },
          ],
        },
      ],
    };
    const { course: made, marks } = draftFromScan('Scanned Links', read, 5);
    const [white] = made.tees;
    expect(made).toMatchObject({ name: 'Scanned Links', greens: [], features: [], notes: [], createdAt: 5 });
    expect(white).toMatchObject({ name: 'White', slope: 120, rating: null });
    expect(white.holes).toHaveLength(9);
    expect(white.holes[0]).toEqual({ number: 1, par: 4, strokeIndex: 3, yards: 380 });
    // Read as nothing, or missing from the reading: blank.
    expect(white.holes[1]).toEqual({ number: 2, par: 0, strokeIndex: 0, yards: 0 });
    expect(white.holes[8]).toEqual({ number: 9, par: 0, strokeIndex: 0, yards: 0 });
    expect(marks).toEqual({
      [teeField(white.id, 'name')]: 'scan',
      [teeField(white.id, 'slope')]: 'scan',
      [holeField(white.id, 1, 'par')]: 'scan',
      [holeField(white.id, 1, 'strokeIndex')]: 'scan',
      [holeField(white.id, 1, 'yards')]: 'scan',
    });
    expect(stillNeeded({ course: made, marks })).toEqual(['fill in every hole’s par and stroke index', 'say where it is']);
  });

  it('gives a tee the scan couldn’t name no name, for the golfer to give', () => {
    const { course: made, marks } = draftFromScan('X', { holeCount: 9, tees: [{ name: null, slope: null, rating: null, holes: [] }] });
    expect(made.tees[0].name).toBe('');
    expect(marks).toEqual({});
    expect(made.id).not.toBe(draftFromScan('X', { holeCount: 9, tees: [] }).course.id);
  });

  it('says where a course is, to four places', () => {
    expect(describePlace(undefined)).toBe('No location yet.');
    expect(describePlace({ lat: 45.520012, lng: -122.68 })).toBe('At 45.5200, -122.6800.');
  });
});
