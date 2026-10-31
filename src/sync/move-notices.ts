/**
 * What a guest's phone does when an organiser's account has gone.
 *
 * The organiser's day leaves the server all at once, and the rows the phone holds
 * stop being anyone else's. Left alone, it would treat them as its own and upload
 * them, re-creating deleted data, and the next guest's upload would then be
 * refused for good. So the clean-up leaves each guest move notices, and this
 * applies them: the day is kept here and marked detached, and the group and
 * course it was on move to ids of this guest's own, marked as only on this phone.
 * `toRows` leaves out whatever those marks say the server shouldn't have.
 *
 * Kept pure, like `merge-shared`, and safe to apply again: notices stay on the
 * server, and once applied they match nothing this phone holds.
 */
import type { Course, Group, Outing, PlayerId, Round } from '../domain/types';
import type { Documents } from './rows';

export interface MoveNotice {
  kind: 'group' | 'player' | 'course' | 'tee' | 'outing';
  from_id: string;
  /** The id to use from now on. Null for an outing: gone from the server, and the phone keeps its copy. */
  to_id: string | null;
}

type Held = Pick<Documents, 'groups' | 'courses' | 'rounds' | 'outings'> & { activeGroupId?: string | null };

function movesOf(notices: MoveNotice[], kind: MoveNotice['kind']): Map<string, string> {
  return new Map(notices.flatMap((n) => (n.kind === kind && n.to_id ? [[n.from_id, n.to_id] as const] : [])));
}

function withKeys<V>(record: Record<string, V>, move: (key: string) => string): Record<string, V> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [move(key), value]));
}

/**
 * The phone's documents with the notices applied. Hands back `held` itself if
 * they change nothing, so the caller can tell.
 */
export function applyMoveNotices<T extends Held>(held: T, notices: MoveNotice[]): T {
  if (notices.length === 0) return held;

  const groups = movesOf(notices, 'group');
  const players = movesOf(notices, 'player');
  const courses = movesOf(notices, 'course');
  const tees = movesOf(notices, 'tee');
  // A course the server had no tees for reads back with a stand-in. Its id is
  // built from the course's, so it would be the same on every guest's copy.
  for (const [from, to] of courses) tees.set(`${from}_default`, `${to}_default`);
  const gone = new Set(notices.filter((n) => n.kind === 'outing').map((n) => n.from_id));

  // Set by anything below that finds an id to move, so what doesn't change stays the same object.
  let touched = false;
  const moving = (moves: Map<string, string>) => (id: string) => {
    const to = moves.get(id);
    if (to === undefined) return id;
    touched = true;
    return to;
  };
  const toGroup = moving(groups);
  const toPlayer = moving(players);
  const toCourse = moving(courses);
  const toTee = moving(tees);

  /** Tees by player, where both ends may have moved. */
  const withTees = (record: Record<PlayerId, string>) =>
    Object.fromEntries(Object.entries(record).map(([player, tee]) => [toPlayer(player), toTee(tee)]));
  const toPair = ([a, b]: [PlayerId, PlayerId]): [PlayerId, PlayerId] => [toPlayer(a), toPlayer(b)];
  // `${hole}:${playerId}`, and a player id may itself contain a colon, as in `toRows`.
  const toPickup = (key: string) => {
    const first = key.indexOf(':');
    return `${key.slice(0, first)}:${toPlayer(key.slice(first + 1))}`;
  };
  // `${hole}:${playerId}:${kind}`, the same way.
  const toJunk = (key: string) => {
    const first = key.indexOf(':');
    const last = key.lastIndexOf(':');
    return `${key.slice(0, first)}:${toPlayer(key.slice(first + 1, last))}:${key.slice(last + 1)}`;
  };

  const moveGroup = (group: Group): Group => ({
    ...group,
    id: toGroup(group.id),
    players: group.players.map((player) => ({ ...player, id: toPlayer(player.id) })),
    youId: group.youId && toPlayer(group.youId),
    defaultCourseId: group.defaultCourseId && toCourse(group.defaultCourseId),
    ...(groups.has(group.id) ? { phoneOnly: true as const } : {}),
  });

  const moveCourse = (course: Course): Course => ({
    ...course,
    id: toCourse(course.id),
    tees: course.tees.map((tee) => ({ ...tee, id: toTee(tee.id) })),
    ...(courses.has(course.id) ? { phoneOnly: true as const } : {}),
  });

  const moveRound = (round: Round): Round => ({
    ...round,
    groupId: toGroup(round.groupId),
    courseId: toCourse(round.courseId),
    playerIds: round.playerIds.map(toPlayer),
    teeId: round.teeId && toTee(round.teeId),
    playerTees: withTees(round.playerTees),
    pops: withKeys(round.pops, toPlayer),
    handicapTees: withTees(round.handicapTees),
    scores: withKeys(round.scores, toPlayer),
    junk: withKeys(round.junk, toJunk),
    pickups: withKeys(round.pickups, toPickup),
    presses: round.presses.map((press) => ({ ...press, by: toPlayer(press.by), against: toPlayer(press.against) })),
    wolfPicks: round.wolfPicks.map((pick) => ({
      ...pick,
      wolf: toPlayer(pick.wolf),
      partner: pick.partner && toPlayer(pick.partner),
    })),
    options: {
      ...round.options,
      teams: round.options.teams.map(toPair),
      matchPairings: round.options.matchPairings.map(toPair),
    },
  });

  const moveOuting = (outing: Outing): Outing => {
    if (gone.has(outing.id) && !outing.detached) touched = true;
    return {
      ...outing,
      groupId: toGroup(outing.groupId),
      courseId: toCourse(outing.courseId),
      field: outing.field.map(toPlayer),
      fieldGames: {
        fieldSkins: { ...outing.fieldGames.fieldSkins, entrants: outing.fieldGames.fieldSkins.entrants.map(toPlayer) },
        scats: { ...outing.fieldGames.scats, entrants: outing.fieldGames.scats.entrants.map(toPlayer) },
      },
      ...(gone.has(outing.id) ? { detached: true as const } : {}),
    };
  };

  let changed = false;
  const each = <I,>(items: I[], move: (item: I) => I): I[] =>
    items.map((item) => {
      touched = false;
      const next = move(item);
      if (!touched) return item;
      changed = true;
      return next;
    });

  const next = {
    ...held,
    groups: each(held.groups, moveGroup),
    courses: each(held.courses, moveCourse),
    rounds: each(held.rounds, moveRound),
    outings: each(held.outings, moveOuting),
  };
  if (held.activeGroupId && groups.has(held.activeGroupId)) {
    next.activeGroupId = groups.get(held.activeGroupId);
    changed = true;
  }
  return changed ? next : held;
}

/**
 * What the server has, plus what only this phone holds.
 *
 * A phone holding nothing but a detached day has nothing to send, which reads as
 * a fresh install. Taking the account's season outright would throw that day away.
 */
export function keepingPhoneOnly(local: Held, remote: Documents): Documents {
  const detached = local.outings.filter((outing) => outing.detached);
  const detachedIds = new Set(detached.map((outing) => outing.id));
  const missingFrom = <I extends { id: string; phoneOnly?: true }>(there: I[], here: I[]) => {
    const ids = new Set(there.map((item) => item.id));
    return here.filter((item) => item.phoneOnly && !ids.has(item.id));
  };
  return {
    ...remote,
    groups: [...remote.groups, ...missingFrom(remote.groups, local.groups)],
    courses: [...remote.courses, ...missingFrom(remote.courses, local.courses)],
    rounds: [...remote.rounds, ...local.rounds.filter((round) => round.outingId !== null && detachedIds.has(round.outingId))],
    outings: [...remote.outings, ...detached],
  };
}
