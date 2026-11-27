/**
 * Course versions (#377, ADR 0001).
 *
 * A course is one record in the course library, and anything that scores a round
 * can change on it: a tee added, a par or stroke index corrected, a slope or
 * rating filled in. So that a posted round never changes when its course does,
 * a round records the version of its course current when it started, and every
 * change to the scoring state archives the state it replaces under the version
 * it had. Settlement, the season ledger and course handicaps read a round's
 * course through `asPlayed`, so they see the tees it was played on. Nothing
 * copies a course or a tee card into a round.
 *
 * The scoring state is the tees: which tees there are, each one's name, slope and
 * rating, and its tee card (par, stroke index and yards). The course's own name, its
 * location, greens, map and notes change in place.
 */
import type { Course, CourseVersion, Round, Tee } from './types';

/** The version a course is on now. A course saved before versions is on its first. */
export function currentVersion(course: Course): number {
  return course.version ?? 1;
}

/** The version a round is played on. One saved before versions plays the course as it is now. */
export function roundVersion(round: Round, course: Course): number {
  return round.courseVersion ?? currentVersion(course);
}

/**
 * The course as `round` played it: its tees as they stood at the round's version.
 * The course itself when the round is on the current version, or its version
 * isn't on this phone.
 */
export function asPlayed(course: Course, round: Round): Course {
  const version = roundVersion(round, course);
  if (version === currentVersion(course)) return course;
  const archived = course.versions?.find((v) => v.version === version);
  return archived ? { ...course, tees: archived.tees } : course;
}

/**
 * `round`, ready to be put on `teeId`. A tee its course version doesn't have, but the
 * course has now (one added since the round started), moves the round onto the current
 * version: choosing it is choosing the course as it is now, with every change made
 * since. A posted or abandoned round never moves.
 */
export function forTee(round: Round, course: Course, teeId: string): Round {
  if (round.status !== 'active') return round;
  const played = asPlayed(course, round).tees.some((t) => t.id === teeId);
  if (played || !course.tees.some((t) => t.id === teeId)) return round;
  return { ...round, courseVersion: currentVersion(course) };
}

/** What a round's score reads from the course, comparable as one value. */
function scoringState(tees: Tee[]): string {
  return JSON.stringify(
    tees.map((tee) => ({
      id: tee.id,
      name: tee.name,
      slope: tee.slope,
      rating: tee.rating,
      holes: tee.holes.map((h) => ({ number: h.number, par: h.par, strokeIndex: h.strokeIndex, yards: h.yards })),
    })),
  );
}

/**
 * `after`, a change to `before`, as the course should keep it. A change that scores
 * a round archives `before`'s tees under its version and moves the course to the
 * next one. Any other change is made in place. Hands back `after` itself when the
 * scoring state is the same.
 */
export function withScoringChange(before: Course, after: Course): Course {
  if (scoringState(before.tees) === scoringState(after.tees)) return after;
  const replaced: CourseVersion = { version: currentVersion(before), tees: before.tees };
  return {
    ...after,
    version: currentVersion(before) + 1,
    versions: [...(before.versions ?? []), replaced],
  };
}
