/**
 * Folding a shared outing back into what this phone already has.
 *
 * For a day several phones are scoring, the server is the authority. That is
 * only safe because of the order it happens in: this phone pushes everything
 * it knows before it pulls, so anything typed here is already up there before
 * any of it comes back down. What returns is this phone's own edits plus
 * everybody else's, which is exactly what a shared card should be.
 *
 * Nothing outside a shared outing is touched, but for courses. Your other
 * groups and every round that is nobody's business but yours come through
 * untouched, because the only rows that win are the ones belonging to an
 * outing you have actually joined. A course someone else created is the course
 * library's (#378): the server's copy of it wins, so a change its creator makes
 * reaches every phone that holds it. The courses this account created stay as the
 * phone has them.
 */
import type { Course, Group, Outing, Round } from '../domain/types';
import type { Documents } from './rows';

function mergeById<T extends { id: string }>(local: T[], incoming: T[]): T[] {
  const winners = new Map(incoming.map((item) => [item.id, item]));
  const merged = local.map((item) => winners.get(item.id) ?? item);
  const seen = new Set(local.map((item) => item.id));
  for (const item of incoming) if (!seen.has(item.id)) merged.push(item);
  return merged;
}

/**
 * The phone's courses with the library's copies of the ones in `incoming`. One in
 * `keep`, such as a course this account created, is only added when missing. The
 * rest replace the phone's copy when they differ. Hands back `local` itself if
 * nothing changes.
 */
function mergeCourses(local: Course[], incoming: Course[], keep: ReadonlySet<string>): Course[] {
  const theirs = new Map(incoming.map((course) => [course.id, course]));
  let changed = false;
  const merged = local.map((course) => {
    const there = theirs.get(course.id);
    if (!there || keep.has(course.id) || JSON.stringify(there) === JSON.stringify(course)) return course;
    changed = true;
    return there;
  });
  const held = new Set(local.map((course) => course.id));
  for (const course of incoming) {
    if (held.has(course.id)) continue;
    merged.push(course);
    changed = true;
  }
  return changed ? merged : local;
}

const NONE: ReadonlySet<string> = new Set();

/**
 * Adds what a shared outing knows to what this phone knows.
 *
 * Rounds and outings that are part of a shared day are replaced outright.
 * Groups are only *added* when missing — the organiser's roster should not
 * quietly rename the players in a group you already keep yourself. Courses are
 * the library's, but for those in `keepCourses` (the ones this account created),
 * which are only added when missing.
 */
export function mergeShared(local: Documents, shared: Documents, keepCourses: ReadonlySet<string> = NONE): Documents {
  const courses = mergeCourses(local.courses, shared.courses, keepCourses);
  if (shared.outings.length === 0) return courses === local.courses ? local : { ...local, courses };

  const outings: Outing[] = mergeById(local.outings, shared.outings);
  const rounds: Round[] = mergeById(local.rounds, shared.rounds);

  const haveGroup = new Set(local.groups.map((g) => g.id));
  const groups: Group[] = [
    ...local.groups,
    ...shared.groups.filter((g) => !haveGroup.has(g.id)),
  ];

  // A bag and its marks are their owner's alone, and never come with an outing.
  return {
    groups,
    courses,
    rounds,
    outings,
    clubs: local.clubs,
    marks: local.marks,
    ...(local.usualScore ? { usualScore: local.usualScore } : {}),
  };
}

/** Whether a merge would actually change anything, so a no-op costs no render. */
export function changesAnything(local: Documents, merged: Documents): boolean {
  return (
    local.groups !== merged.groups ||
    local.courses !== merged.courses ||
    local.rounds.length !== merged.rounds.length ||
    local.outings.length !== merged.outings.length ||
    merged.rounds.some((round, index) => local.rounds[index] !== round) ||
    merged.outings.some((outing, index) => local.outings[index] !== outing)
  );
}
