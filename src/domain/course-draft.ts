/**
 * A draft course (#383): a new course in the course editor before the golfer saves it.
 *
 * Every way of creating a course ends here: typing it in, a scan of the scorecard
 * (#385), and later OpenStreetMap or an online lookup. A value one of those filled
 * carries a mark of where it came from until the golfer confirms it, by changing it or
 * by saying the lot is right. A value a source couldn't give stays blank: a draft's
 * par, stroke index or yards of 0 is a blank, and so is an empty tee name. Nothing in a
 * draft reaches the course library until it's saved, and it can't be saved with a
 * blank par or stroke index, a tee with no name, or no location.
 */
import { courseChanges, type CourseChange } from './course-changes';
import { makeId } from './factory';
import type { Course, LatLng, Tee } from './types';

export type CourseSource = 'scan' | 'osm' | 'lookup';

export const SOURCE_NAMES: Record<CourseSource, string> = {
  scan: 'the scorecard photo',
  osm: 'OpenStreetMap',
  lookup: 'the online lookup',
};

/** Where a draft's values came from, by field, until the golfer confirms them. */
export type SourceMarks = Record<string, CourseSource>;

export interface CourseDraft {
  course: Course;
  marks: SourceMarks;
}

export const courseField = (field: 'name' | 'location') => `course:${field}`;
export const teeField = (tee: string, field: 'name' | 'slope' | 'rating') => `tee:${tee}:${field}`;
export const holeField = (tee: string, number: number, field: 'par' | 'strokeIndex' | 'yards') => `hole:${tee}:${number}:${field}`;

/** The field a change is to, as a mark names it; null for one no mark is on. */
function fieldOf(change: CourseChange): string | null {
  switch (change.kind) {
    case 'course':
      return courseField(change.field);
    case 'tee':
      return teeField(change.tee, change.field);
    case 'hole':
      return holeField(change.tee, change.number, change.field);
    default:
      return null;
  }
}

/** The draft with `course` in it: a value the golfer changed is theirs now, so its mark goes. */
export function edited(draft: CourseDraft, course: Course): CourseDraft {
  const changed = new Set(courseChanges(draft.course, course).map(fieldOf));
  const marks = Object.fromEntries(Object.entries(draft.marks).filter(([field]) => !changed.has(field)));
  return { course, marks };
}

/** The source of the first marked field among `fields`, if any is. */
export function markOn(marks: SourceMarks, ...fields: string[]): CourseSource | null {
  for (const field of fields) if (marks[field]) return marks[field];
  return null;
}

/** What the draft still needs before it can be saved, in words, in the order to do it; none when it's ready. */
export function stillNeeded(draft: CourseDraft): string[] {
  const { course } = draft;
  const needs: string[] = [];
  if (course.name.trim() === '') needs.push('give it a name');
  if (course.tees.some((tee) => tee.name.trim() === '')) needs.push('name every tee');
  if (course.tees.some((tee) => tee.holes.some((hole) => !hole.par || !hole.strokeIndex))) {
    needs.push('fill in every hole’s par and stroke index');
  }
  // Two holes with one index put the pops on the wrong holes: a new course doesn't start that way.
  if (course.tees.some((tee) => repeatsAnIndex(tee))) needs.push('give each hole on a tee its own stroke index');
  if (!course.location) needs.push('say where it is');
  return needs;
}

/** Whether two holes on the tee have one stroke index. Blanks aren't an index yet. */
function repeatsAnIndex(tee: Tee): boolean {
  const indexes = tee.holes.map((hole) => hole.strokeIndex).filter((index) => index > 0);
  return new Set(indexes).size !== indexes.length;
}

/** Whether the draft has everything saving needs. */
export function canSave(draft: CourseDraft): boolean {
  return stillNeeded(draft).length === 0;
}

/** A course's location as the editor says it. */
export function describePlace(location: LatLng | null | undefined): string {
  if (!location) return 'No location yet.';
  return `At ${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}.`;
}

/** The tees a scorecard scan read, as the server checked them (#384): null for anything it couldn't read. */
export interface ReadTees {
  holeCount: 9 | 18;
  tees: {
    name: string | null;
    slope: number | null;
    rating: number | null;
    holes: { number: number; par: number | null; strokeIndex: number | null; yards: number | null }[];
  }[];
}

/**
 * A new course from what a scan of its scorecard read (#385). Every value the photos
 * gave is marked as read from them until the golfer confirms it; everything else is
 * blank, for the golfer to type, never filled in for them.
 */
export function draftFromScan(name: string, read: ReadTees, now: number = Date.now()): CourseDraft {
  const marks: SourceMarks = {};
  const mark = (field: string, value: unknown) => {
    if (value !== null && value !== undefined) marks[field] = 'scan';
  };
  const tees = read.tees.map((scanned): Tee => {
    const id = makeId('t');
    mark(teeField(id, 'name'), scanned.name);
    mark(teeField(id, 'slope'), scanned.slope);
    mark(teeField(id, 'rating'), scanned.rating);
    const holes = Array.from({ length: read.holeCount }, (_, i) => {
      const hole = scanned.holes.find((h) => h.number === i + 1);
      mark(holeField(id, i + 1, 'par'), hole?.par);
      mark(holeField(id, i + 1, 'strokeIndex'), hole?.strokeIndex);
      mark(holeField(id, i + 1, 'yards'), hole?.yards);
      return { number: i + 1, par: hole?.par ?? 0, strokeIndex: hole?.strokeIndex ?? 0, yards: hole?.yards ?? 0 };
    });
    return { id, name: scanned.name ?? '', slope: scanned.slope, rating: scanned.rating, holes };
  });
  return {
    course: { id: makeId('c'), name, tees, greens: [], features: [], notes: [], createdAt: now },
    marks,
  };
}
