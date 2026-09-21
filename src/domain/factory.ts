import { defaultFieldGames, defaultGames, defaultOptions } from './formats';
import type { Course, Group, Hole, Outing, Player, PlayerId, Round, TeeFormat } from './types';

/** Avatar colours, handed out in order so a new group looks deliberate. */
export const PLAYER_COLORS = [
  '#8BE0AE',
  '#E8C46A',
  '#7FB6E8',
  '#E89A7F',
  '#C9A8E8',
  '#9AD8D8',
  '#E8A0C8',
  '#D8C89A',
];

let counter = 0;
/** Good enough for on-device ids: time-ordered and collision-free within a session. */
export function makeId(prefix: string): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

/** "Big Ray" becomes BR, "Dev" becomes DV — never an empty bubble. */
export function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '??';
  if (words.length === 1) {
    const w = words[0].replace(/[^A-Za-z0-9]/g, '');
    return (w.slice(0, 2) || '??').toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function makePlayer(name: string, index: number, overrides: Partial<Player> = {}): Player {
  return {
    id: makeId('p'),
    name,
    initials: deriveInitials(name),
    color: PLAYER_COLORS[index % PLAYER_COLORS.length],
    ...overrides,
  };
}

export function makeGroup(name: string, players: Player[] = []): Group {
  return {
    id: makeId('g'),
    name,
    players,
    youId: players[0]?.id ?? null,
    defaultCourseId: null,
    subtitle: '',
    createdAt: Date.now(),
  };
}

/**
 * A blank card: par 4 everywhere, stroke indexes 1..n in order.
 *
 * Deliberately not a "typical" course — a made-up par 72 layout would be wrong
 * for wherever the group actually plays, and wrong stroke indexes silently move
 * everybody's pops onto the wrong holes.
 */
export function makeCourse(name: string, holeCount: 9 | 18 = 18): Course {
  const holes: Hole[] = Array.from({ length: holeCount }, (_, i) => ({
    number: i + 1,
    par: 4,
    strokeIndex: i + 1,
    yards: 0,
  }));
  return { id: makeId('c'), name, holes, createdAt: Date.now() };
}

export function makeRound(
  group: Group,
  course: Course,
  playerIds?: PlayerId[],
  extras: { outingId?: string; name?: string; teeTime?: string | null } = {},
): Round {
  const ids = playerIds ?? group.players.map((p) => p.id);
  const pops: Record<PlayerId, number> = {};
  const scores: Record<PlayerId, (number | null)[]> = {};
  for (const id of ids) {
    pops[id] = 0;
    scores[id] = Array(course.holes.length).fill(null);
  }
  return {
    id: makeId('r'),
    groupId: group.id,
    courseId: course.id,
    outingId: extras.outingId ?? null,
    name: extras.name ?? 'Our group',
    teeTime: extras.teeTime ?? null,
    playerIds: ids,
    pops,
    scores,
    junk: {},
    presses: [],
    wolfPicks: [],
    games: defaultGames(),
    options: defaultOptions(),
    status: 'active',
    startedAt: Date.now(),
    completedAt: null,
  };
}

/**
 * Splits a field into playing groups of at most `size`.
 *
 * A remainder of one is folded back into the previous group rather than sent
 * out alone — nineteen players go out as four fours and a three, never as four
 * fours, a two and a single.
 */
export function splitIntoGroups(field: PlayerId[], size = 4): PlayerId[][] {
  if (field.length === 0) return [];
  const groups: PlayerId[][] = [];
  for (let i = 0; i < field.length; i += size) groups.push(field.slice(i, i + size));
  if (groups.length > 1 && groups[groups.length - 1].length === 1) {
    const orphan = groups.pop()!;
    groups[groups.length - 1].push(...orphan);
  }
  return groups;
}

/** A day out with a field, before anybody has been put into groups. */
export function makeOuting(
  group: Group,
  course: Course,
  options: { name?: string; field?: PlayerId[]; teeFormat?: TeeFormat; date?: number } = {},
): Outing {
  const field = options.field ?? group.players.map((p) => p.id);
  return {
    id: makeId('o'),
    groupId: group.id,
    courseId: course.id,
    name: options.name ?? `${course.name} outing`,
    date: options.date ?? Date.now(),
    teeFormat: options.teeFormat ?? 'sequential',
    field,
    fieldGames: defaultFieldGames(),
    roundIds: [],
    status: 'active',
    startedAt: Date.now(),
    completedAt: null,
  };
}

/** Pairs players off in tee order: 1&2 against 3&4. */
export function defaultTeams(ids: PlayerId[]): [PlayerId, PlayerId][] {
  const teams: [PlayerId, PlayerId][] = [];
  for (let i = 0; i + 1 < ids.length; i += 2) teams.push([ids[i], ids[i + 1]]);
  return teams;
}

/**
 * Keeps a round's per-player maps in step with its player list.
 *
 * Adding somebody mid-round gives them a blank card rather than leaving holes
 * permanently unplayable because one map has a missing key.
 */
export function reconcileRound(round: Round, holeCount: number): Round {
  const pops = { ...round.pops };
  const scores = { ...round.scores };
  for (const id of round.playerIds) {
    if (pops[id] == null) pops[id] = 0;
    const row = scores[id] ? scores[id].slice() : [];
    while (row.length < holeCount) row.push(null);
    scores[id] = row.slice(0, holeCount);
  }
  for (const id of Object.keys(scores)) {
    if (!round.playerIds.includes(id)) {
      delete scores[id];
      delete pops[id];
    }
  }
  return { ...round, pops, scores };
}
