/**
 * A draft course (#383): a new course in the course editor before the golfer saves it.
 *
 * Every way of creating a course ends here: typing it in, and later a scan of the
 * scorecard, OpenStreetMap or an online lookup. A value one of those filled carries a
 * mark of where it came from until the golfer confirms it, by changing it or by saying
 * the lot is right. Nothing in a draft reaches the course library until it's saved, and
 * a draft can't be saved without a location.
 */
import { courseChanges, type CourseChange } from './course-changes';
import type { Course, LatLng } from './types';

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

/** Whether the draft has what saving needs: a name and a location. */
export function canSave(draft: CourseDraft): boolean {
  return draft.course.name.trim() !== '' && !!draft.course.location;
}

/** A course's location as the editor says it. */
export function describePlace(location: LatLng | null | undefined): string {
  if (!location) return 'No location yet.';
  return `At ${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}.`;
}
