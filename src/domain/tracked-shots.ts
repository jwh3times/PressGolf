import { surfaceAt, type Surface } from './club-suggestion';
import { yardsBetween } from './geo';
import { MARK_GOOD_WITHIN_M } from './marks';
import { clubKind, ROLL, ROLL_IN_ROUGH, ROLL_ON_GREEN } from './shot-model';
import type { Club, Course, Mark, Round } from './types';

/**
 * Tracked shots (#297): each of the bag owner's full swings, from its mark to
 * their next mark on the same hole, and what the closed rounds' shots say about
 * how far each club carries. The one place the counting rules and the figures
 * live; the bag shows them, and nothing here changes a club.
 */

/**
 * The fewest counting shots a club needs before the bag shows its tracked
 * carry. A judgement call from the #293 design session on 2026-11-09, not a
 * published figure: few enough to reach in a round or two, enough that one bad
 * shot can't set it.
 */
export const SHOTS_FOR_CARRY = 5;

/**
 * How close both fixes of a shot must be for it to count: the same 10 m that
 * marking waits for. A judgement call from the #293 design session on
 * 2026-11-09, not a published figure.
 */
export const COUNTING_FIX_M = MARK_GOOD_WITHIN_M;

/**
 * A shot that went less than this share of the club's typed carry was a
 * mishit, or a mark on the wrong club, and doesn't count. A judgement call from
 * the #293 design session on 2026-11-09, not a published figure.
 */
export const SHORTEST_SHARE = 0.4;

/**
 * Only a club's latest this many counting shots make its figures, so they follow
 * a swing as it changes. A judgement call from the #293 design session on
 * 2026-11-09, not a published figure.
 */
export const LATEST_SHOTS = 20;

/** Where a tracked shot stopped, for its roll. */
export type FinishLie = 'fairway' | 'rough' | 'green';

/** Whether a shot counts towards its club's figures, or the first rule it fails. */
export type ShotStatus =
  | 'counts'
  /** The round is still being played: posted or abandoned, its shots count. */
  | 'roundOpen'
  | 'noFinish'
  /** Hit from sand, a penalty area, or anywhere else but a tee, fairway or rough: see `startLie`. */
  | 'lie'
  /** A fix wasn't within {@link COUNTING_FIX_M}. */
  | 'roughFix'
  /** Under {@link SHORTEST_SHARE} of the club's typed carry. */
  | 'short'
  /** Passes every other rule, but isn't among the club's latest {@link LATEST_SHOTS}. */
  | 'older';

export interface TrackedShot {
  /** The full-swing mark it was hit from. */
  start: Mark;
  /** The next mark on the hole, where the ball stopped; null for none yet. */
  finish: Mark | null;
  /** From start to finish, measured; null with no finish. */
  yards: number | null;
  /** The measured yards less the estimated roll for where it stopped. */
  carry: number | null;
  finishLie: FinishLie | null;
  /** What the map says it was hit from. */
  startLie: Surface;
  status: ShotStatus;
}

export interface ClubShots {
  /** Newest first. */
  shots: TrackedShot[];
  /** How many of them count. */
  counting: number;
  /** The median inferred carry of the counting shots, to the yard, from {@link SHOTS_FOR_CARRY}; null before. */
  trackedCarry: number | null;
}

export interface TrackedInput {
  /** The bag owner's marks. */
  marks: Mark[];
  rounds: Round[];
  courses: Course[];
  /** The bag. */
  clubs: Club[];
}

/** How much of the fairway roll each finish lie keeps. */
const ROLL_SHARE: Record<FinishLie, number> = { fairway: 1, rough: ROLL_IN_ROUGH, green: ROLL_ON_GREEN };

/** Each club in the bag, by id, with its tracked shots. */
export function trackedShots({ marks, rounds, courses, clubs: bag }: TrackedInput): Record<string, ClubShots> {
  const byClub: Record<string, ClubShots> = Object.fromEntries(
    bag.map((club) => [club.id, { shots: [], counting: 0, trackedCarry: null }]),
  );
  const ordered = [...marks].sort((a, b) => a.at - b.at);
  // Newest first, so each club's list comes out that way.
  const newestFirst = [...ordered].reverse();
  for (const start of newestFirst) {
    const club = bag.find((c) => c.id === start.clubId);
    const round = rounds.find((r) => r.id === start.roundId);
    const course = round && courses.find((c) => c.id === round.courseId);
    if (start.kind !== 'full' || !club || !course) continue;
    const finish = ordered.find((m) => m.at > start.at && m.roundId === start.roundId && m.hole === start.hole) ?? null;
    const yards = finish ? yardsBetween(start.position, finish.position) : null;
    const finishLie = finish ? lieAtFinish(course, finish) : null;
    const startLie = surfaceAt(course, start.hole, start.position);
    const roll = finishLie ? ROLL[clubKind(club.name, club.carry ?? yards!)] * ROLL_SHARE[finishLie] : 0;
    byClub[club.id].shots.push({
      start,
      finish,
      yards,
      carry: yards == null ? null : yards / (1 + roll),
      finishLie,
      startLie,
      status: statusOf(round, club, start, finish, yards, startLie),
    });
  }
  for (const club of Object.values(byClub)) {
    let passed = 0;
    for (const shot of club.shots) if (shot.status === 'counts' && ++passed > LATEST_SHOTS) shot.status = 'older';
    const carries = club.shots.filter((shot) => shot.status === 'counts').map((shot) => shot.carry!);
    club.counting = carries.length;
    club.trackedCarry = carries.length >= SHOTS_FOR_CARRY ? Math.round(median(carries)) : null;
  }
  return byClub;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Where a counting shot can be hit from. */
const COUNTS_FROM: ReadonlySet<Surface> = new Set(['tee', 'fairway', 'rough']);
const goodFix = (mark: Mark) => mark.accuracy != null && mark.accuracy <= COUNTING_FIX_M;

/** The first rule a shot fails, in the order the spec gives them, short of the latest few. */
function statusOf(round: Round, club: Club, start: Mark, finish: Mark | null, yards: number | null, startLie: Surface): ShotStatus {
  if (round.status === 'active') return 'roundOpen';
  if (!finish || yards == null) return 'noFinish';
  if (!COUNTS_FROM.has(startLie)) return 'lie';
  if (!goodFix(start) || !goodFix(finish)) return 'roughFix';
  if (club.carry != null && yards < club.carry * SHORTEST_SHARE) return 'short';
  return 'counts';
}

/**
 * Where a shot stopped, as one of the three lies the shot model has a roll for.
 * Sand, water and out of bounds take rough's: the ball may well have rolled in,
 * and half the fairway roll is between the fairway's and none.
 */
function lieAtFinish(course: Course, finish: Mark): FinishLie {
  if (finish.kind === 'green') return 'green';
  const surface = surfaceAt(course, finish.hole, finish.position);
  return surface === 'green' ? 'green' : surface === 'fairway' || surface === 'tee' ? 'fairway' : 'rough';
}
