import type { Club, Mark, MarkHit, RoundId } from './types';

/**
 * How close a fix must be to stop waiting for a better one when marking the
 * ball (#295). A judgement call made in the #293 session, not a published
 * figure: a few yards either end of a shot is as rough as a carry can stand.
 */
export const MARK_GOOD_WITHIN_M = 10;

/**
 * How long marking waits for a fix within `MARK_GOOD_WITHIN_M` before keeping
 * the best one so far. Also a judgement call from #293: long enough for GPS to
 * settle, short enough not to hold up the group.
 */
export const MARK_WAIT_MS = 20_000;

/** A mark's `kind` and `clubId`, from what was hit from it. */
export function hitFields(hit: MarkHit): Pick<Mark, 'kind' | 'clubId'> {
  return { kind: hit.kind, clubId: hit.kind === 'full' ? hit.clubId : null };
}

/** The marks, with what was hit from mark `id` changed. */
export function withHit(marks: Mark[], id: string, hit: MarkHit): Mark[] {
  return marks.map((m) => (m.id === id ? { ...m, ...hitFields(hit) } : m));
}

/** What was hit from a mark, for the club picker; null for a club no longer in the bag. */
export function hitOf(mark: Mark): MarkHit | null {
  if (mark.kind !== 'full') return { kind: mark.kind };
  return mark.clubId ? { kind: 'full', clubId: mark.clubId } : null;
}

/** Whether two say the same was hit: the same kind, and for a full swing the same club. */
export function sameHit(a: MarkHit, b: MarkHit): boolean {
  return a.kind === 'full' ? b.kind === 'full' && a.clubId === b.clubId : a.kind === b.kind;
}

/** Whether what was hit is in the bag: any club it names must be. */
export function inBag(clubs: Club[], hit: MarkHit): boolean {
  return hit.kind !== 'full' || clubs.some((c) => c.id === hit.clubId);
}

/** How a mark reads on the yardage card, after "Marked: ": the club's name, or what kind of mark it is. */
export function markLabel(mark: Pick<Mark, 'kind' | 'clubId'>, clubs: Club[]): string {
  if (mark.kind === 'partial') return 'Not a full swing';
  if (mark.kind === 'green') return 'On the green';
  return clubs.find((c) => c.id === mark.clubId)?.name ?? 'A club no longer in the bag';
}

/** The last mark made on a hole of a round, which the yardage card confirms and can undo. */
export function latestMark(marks: Mark[], roundId: RoundId, hole: number): Mark | null {
  let latest: Mark | null = null;
  for (const mark of marks) {
    if (mark.roundId === roundId && mark.hole === hole && (!latest || mark.at >= latest.at)) latest = mark;
  }
  return latest;
}

/** How many marks name a club: the tracked shots that go with it when it leaves the bag. */
export function marksNaming(marks: Mark[], clubId: string): number {
  return marks.filter((m) => m.clubId === clubId).length;
}
