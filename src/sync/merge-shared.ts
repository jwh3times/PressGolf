/**
 * Folding a shared outing back into what this phone already has.
 *
 * For a day several phones are scoring, the server is the authority. That is
 * only safe because of the order it happens in: this phone pushes everything
 * it knows before it pulls, so anything typed here is already up there before
 * any of it comes back down. What returns is this phone's own edits plus
 * everybody else's, which is exactly what a shared card should be.
 *
 * Nothing outside a shared outing is touched. Your other groups, your other
 * courses and every round that is nobody's business but yours come through
 * untouched, because the only rows that win are the ones belonging to an
 * outing you have actually joined.
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
 * Adds what a shared outing knows to what this phone knows.
 *
 * Rounds and outings that are part of a shared day are replaced outright.
 * Groups and courses are only *added* when missing — the organiser's roster
 * should not quietly rename the players in a group you already keep yourself.
 */
export function mergeShared(local: Documents, shared: Documents): Documents {
  if (shared.outings.length === 0) return local;

  const outings: Outing[] = mergeById(local.outings, shared.outings);
  const rounds: Round[] = mergeById(local.rounds, shared.rounds);

  const haveGroup = new Set(local.groups.map((g) => g.id));
  const groups: Group[] = [
    ...local.groups,
    ...shared.groups.filter((g) => !haveGroup.has(g.id)),
  ];

  const haveCourse = new Set(local.courses.map((c) => c.id));
  const courses: Course[] = [
    ...local.courses,
    ...shared.courses.filter((c) => !haveCourse.has(c.id)),
  ];

  return { groups, courses, rounds, outings };
}

/** Whether a merge would actually change anything, so a no-op costs no render. */
export function changesAnything(local: Documents, merged: Documents): boolean {
  return (
    local.groups !== merged.groups ||
    local.courses.length !== merged.courses.length ||
    local.rounds.length !== merged.rounds.length ||
    local.outings.length !== merged.outings.length ||
    merged.rounds.some((round, index) => local.rounds[index] !== round) ||
    merged.outings.some((outing, index) => local.outings[index] !== outing)
  );
}
