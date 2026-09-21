import { defaultGames, defaultOptions } from '../formats';
import type { Course, GameKey, Group, Player, PlayerId, Round } from '../types';

export const TEST_PAR = [4, 5, 4, 3, 4, 4, 5, 3, 4, 4, 4, 3, 5, 4, 4, 3, 4, 5];
export const TEST_SI = [7, 1, 11, 17, 3, 13, 5, 15, 9, 8, 2, 12, 18, 4, 14, 16, 6, 10];

export function makeTestCourse(holeCount = 18): Course {
  return {
    id: 'course1',
    name: 'Test Links',
    holes: Array.from({ length: holeCount }, (_, i) => ({
      number: i + 1,
      par: TEST_PAR[i % 18],
      strokeIndex: TEST_SI[i % 18],
      yards: 400,
    })),
    createdAt: 0,
  };
}

export const P: PlayerId[] = ['a', 'b', 'c', 'd'];

export function makeTestPlayers(count = 4): Player[] {
  const names = ['Alice', 'Bob', 'Carol', 'Dan'];
  return P.slice(0, count).map((id, i) => ({
    id,
    name: names[i],
    initials: names[i].slice(0, 2).toUpperCase(),
    color: '#8BE0AE',
  }));
}

export function makeTestGroup(count = 4): Group {
  const players = makeTestPlayers(count);
  return {
    id: 'group1',
    name: 'Test Group',
    players,
    youId: players[0].id,
    defaultCourseId: 'course1',
    subtitle: '',
    createdAt: 0,
  };
}

export interface RoundSpec {
  /** `scores[playerIndex][holeIndex]`. Short rows are padded with nulls. */
  scores: (number | null)[][];
  pops?: number[];
  holeCount?: number;
  games?: Partial<Record<GameKey, { on: boolean; stake: number }>>;
  options?: Partial<Round['options']>;
  junk?: Record<string, true>;
  presses?: Round['presses'];
  wolfPicks?: Round['wolfPicks'];
  playerCount?: number;
}

export function makeTestRound(spec: RoundSpec): Round {
  const holeCount = spec.holeCount ?? 18;
  const playerCount = spec.playerCount ?? spec.scores.length;
  const ids = P.slice(0, playerCount);

  const pops: Record<PlayerId, number> = {};
  const scores: Record<PlayerId, (number | null)[]> = {};
  ids.forEach((id, i) => {
    pops[id] = spec.pops?.[i] ?? 0;
    const row = (spec.scores[i] ?? []).slice(0, holeCount);
    while (row.length < holeCount) row.push(null);
    scores[id] = row;
  });

  const games = defaultGames();
  // Tests opt in explicitly; leaving the app defaults on would mix formats.
  for (const key of Object.keys(games) as GameKey[]) games[key] = { ...games[key], on: false };
  for (const [key, cfg] of Object.entries(spec.games ?? {})) {
    games[key as GameKey] = { on: cfg!.on, stake: cfg!.stake };
  }

  return {
    id: 'round1',
    groupId: 'group1',
    courseId: 'course1',
    outingId: null,
    name: 'Test Group',
    teeTime: null,
    playerIds: ids,
    pops,
    scores,
    junk: spec.junk ?? {},
    presses: spec.presses ?? [],
    wolfPicks: spec.wolfPicks ?? [],
    games,
    options: { ...defaultOptions(), ...spec.options },
    status: 'active',
    startedAt: 0,
    completedAt: null,
  };
}

/** Every player shoots this score on every hole — a clean baseline to perturb. */
export function flat(value: number, holeCount = 18): number[] {
  return Array(holeCount).fill(value);
}

/** Asserts the ledger is a closed system: every cent won came from somebody. */
export function expectBalanced(net: Record<PlayerId, number>): void {
  const sum = Object.values(net).reduce((a, b) => a + b, 0);
  expect(sum).toBe(0);
}
