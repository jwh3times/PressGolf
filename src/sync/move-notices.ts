/**
 * What a guest's phone does when an organiser's account has gone.
 *
 * The organiser's day leaves the server all at once, and the rows the phone holds
 * stop being anyone else's. Left alone, it would treat them as its own and upload
 * them, re-creating deleted data, and the next guest's upload would then be
 * refused for good. So the clean-up leaves each guest move notices, and this
 * applies them: the day is kept here and marked detached, and the group and
 * course it was on move to ids of this guest's own, marked as only on this phone.
 * `toRows` leaves out whatever those marks say the server shouldn't have. A round
 * or outing of the guest's own stays, and the server has already moved it to the
 * same new ids, on a copy of the group and course.
 *
 * Kept pure, like `merge-shared`, and safe to apply again: notices stay on the
 * server, and once applied they match nothing this phone holds. A notice never
 * touches what the phone still shares: `followMoveNotices` takes the server's word
 * for that, so a group someone holds again through a later outing stays put.
 */
import type { Course, Group, Outing, PlayerId, Round } from '../domain/types';
import { mergeShared } from './merge-shared';
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
  // A phone only ever adds a group or course it doesn't have, so it can still hold
  // a player or tee the organiser removed, which no notice names. Those ids are
  // global on the server, so each takes one built from this guest's new parent.
  for (const group of held.groups) {
    const to = groups.get(group.id);
    if (to) for (const { id } of group.players) if (!players.has(id)) players.set(id, `${to}:${id}`);
  }
  for (const course of held.courses) {
    const to = courses.get(course.id);
    if (to) for (const { id } of course.tees) if (!tees.has(id)) tees.set(id, `${to}:${id}`);
  }
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
 * The phone's documents, once it knows what the server still shares with it.
 *
 * A day it still shares may be on a group or course that moved under it, as when
 * the organiser of a group a friend's outing was on deletes their account. The
 * friend has moved that outing to their own copy, and this phone's notices name
 * ids of its own that have nothing to do with it. So the server's copy of that day
 * comes first, and replaces this phone's: an edit here that hadn't gone up is lost.
 * Then the notices apply to the rest, leaving anything the pull still shows.
 *
 * `notices` is what's left to apply, for the store to do the same. Hands back `held`
 * itself if that's nothing, so the caller doesn't save, and go round again.
 */
export function followMoveNotices<T extends Documents & { activeGroupId?: string | null }>(
  held: T,
  notices: MoveNotice[],
  shared: Documents,
): { held: T; notices: MoveNotice[] } {
  const shownGroups = new Set(shared.groups.map((group) => group.id));
  const shownCourses = new Set(shared.courses.map((course) => course.id));
  const shown: Record<MoveNotice['kind'], Set<string>> = {
    outing: new Set(shared.outings.map((outing) => outing.id)),
    group: shownGroups,
    course: shownCourses,
    player: new Set([
      ...[...shared.groups, ...held.groups.filter((group) => shownGroups.has(group.id))].flatMap((group) => group.players.map((player) => player.id)),
      ...shared.outings.flatMap((outing) => outing.field),
      ...shared.rounds.flatMap((round) => round.playerIds),
    ]),
    tee: new Set(
      [...shared.courses, ...held.courses.filter((course) => shownCourses.has(course.id))].flatMap((course) => course.tees.map((tee) => tee.id)),
    ),
  };
  const following = notices.filter((notice) => !shown[notice.kind].has(notice.from_id));
  if (applyMoveNotices(held, following) === held) return { held, notices: [] };
  return { held: applyMoveNotices({ ...held, ...mergeShared(held, shared) }, following), notices: following };
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
