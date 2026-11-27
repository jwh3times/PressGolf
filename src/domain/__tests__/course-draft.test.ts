import { canSave, courseField, describePlace, edited, holeField, markOn, teeField, type CourseDraft } from '../course-draft';
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

  it('saves only with a name and a location', () => {
    const at = { lat: 45.5, lng: -122.6 };
    expect(canSave({ course, marks: {} })).toBe(false);
    expect(canSave({ course: { ...course, location: at }, marks: {} })).toBe(true);
    expect(canSave({ course: { ...course, name: '  ', location: at }, marks: {} })).toBe(false);
  });

  it('says where a course is, to four places', () => {
    expect(describePlace(undefined)).toBe('No location yet.');
    expect(describePlace({ lat: 45.520012, lng: -122.68 })).toBe('At 45.5200, -122.6800.');
  });
});
