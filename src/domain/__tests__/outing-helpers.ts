import { defaultFieldGames, defaultGames, defaultOptions } from '../formats';
import type {
  Course,
  FieldGameKey,
  GameKey,
  Group,
  Outing,
  Player,
  PlayerId,
  Round,
} from '../types';
import { makeTestCourse } from './helpers';

/** A twenty-strong society: p00 … p19. */
export function makeFieldPlayers(count = 20): Player[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `p${String(i).padStart(2, '0')}`,
    name: `Player ${i}`,
    initials: `P${i}`,
    color: '#8BE0AE',
  }));
}

export function makeFieldGroup(count = 20): Group {
  const players = makeFieldPlayers(count);
  return {
    id: 'society',
    name: 'The Society',
    players,
    youId: players[0].id,
    defaultCourseId: 'course1',
    subtitle: '',
    createdAt: 0,
  };
}

export interface OutingSpec {
  /** `cards[playerIndex][holeIndex]`. Short rows are padded with nulls. */
  cards: (number | null)[][];
  playerCount?: number;
  holeCount?: number;
  groupSize?: number;
  pops?: number[];
  /** Per-foursome games. Off by default so field pots can be tested alone. */
  games?: Partial<Record<GameKey, { on: boolean; stake: number }>>;
  fieldGames?: Partial<
    Record<
      FieldGameKey,
      { on: boolean; buyIn: number; entrants?: PlayerId[]; useNet?: boolean; carry?: boolean; unclaimed?: 'splitAmongWinners' | 'carry' }
    >
  >;
}

export function makeTestOuting(spec: OutingSpec): {
  outing: Outing;
  rounds: Round[];
  course: Course;
  roster: Player[];
} {
  const holeCount = spec.holeCount ?? 18;
  const playerCount = spec.playerCount ?? spec.cards.length;
  const groupSize = spec.groupSize ?? 4;
  const course = makeTestCourse(holeCount);
  const roster = makeFieldPlayers(playerCount);
  const field = roster.map((p) => p.id);

  const games = defaultGames();
  for (const key of Object.keys(games) as GameKey[]) games[key] = { ...games[key], on: false };
  for (const [key, cfg] of Object.entries(spec.games ?? {})) {
    games[key as GameKey] = { on: cfg!.on, stake: cfg!.stake };
  }

  const rounds: Round[] = [];
  for (let start = 0, g = 0; start < field.length; start += groupSize, g++) {
    const ids = field.slice(start, start + groupSize);
    const pops: Record<PlayerId, number> = {};
    const scores: Record<PlayerId, (number | null)[]> = {};
    ids.forEach((id) => {
      const index = field.indexOf(id);
      pops[id] = spec.pops?.[index] ?? 0;
      const row = (spec.cards[index] ?? []).slice(0, holeCount);
      while (row.length < holeCount) row.push(null);
      scores[id] = row;
    });
    rounds.push({
      id: `round${g}`,
      groupId: 'society',
      courseId: course.id,
      outingId: 'outing1',
      name: `Group ${g + 1}`,
      teeTime: `8:${String(g * 10).padStart(2, '0')}`,
      playerIds: ids,
      pops,
      scores,
      junk: {},
      presses: [],
      wolfPicks: [],
      games: { ...games },
      options: defaultOptions(),
      status: 'active',
      startedAt: 0,
      completedAt: null,
    });
  }

  const fieldGames = defaultFieldGames();
  for (const [key, cfg] of Object.entries(spec.fieldGames ?? {})) {
    const k = key as FieldGameKey;
    fieldGames[k] = {
      ...fieldGames[k],
      on: cfg!.on,
      buyIn: cfg!.buyIn,
      entrants: cfg!.entrants ?? field,
      useNet: cfg!.useNet ?? fieldGames[k].useNet,
      carry: cfg!.carry ?? fieldGames[k].carry,
      unclaimed: cfg!.unclaimed ?? fieldGames[k].unclaimed,
    };
  }

  const outing: Outing = {
    id: 'outing1',
    groupId: 'society',
    courseId: course.id,
    name: 'Test Outing',
    date: 0,
    teeFormat: 'sequential',
    field,
    fieldGames,
    roundIds: rounds.map((r) => r.id),
    status: 'active',
    startedAt: 0,
    completedAt: null,
  };

  return { outing, rounds, course, roster };
}

/** Everyone posts `value` on every hole — a flat field to perturb. */
export function flatField(playerCount: number, value: number, holeCount = 18): number[][] {
  return Array.from({ length: playerCount }, () => Array(holeCount).fill(value));
}
