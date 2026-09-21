import type { JunkKind, PlayerId, Round } from '../domain/types';
import type { JunkValue, Mutation, ScoreValue } from './types';

/**
 * Last-write-wins, per cell.
 *
 * Whole-document merging is what loses people's birdies: if two phones both
 * hold a copy of the round and both save it, one of them silently erases the
 * other's holes. Because every mutation names exactly one cell, two people
 * scoring different holes never collide, and two people scoring the same hole
 * resolve deterministically to the later edit.
 *
 * Ties break on device id — arbitrary, but identical on every device, which is
 * the property that matters. Two phones must never disagree about who won.
 */
export function laterWins(a: Mutation, b: Mutation): Mutation {
  if (a.at !== b.at) return a.at > b.at ? a : b;
  return a.deviceId > b.deviceId ? a : b;
}

/** Reduces a pile of mutations to the winning one per cell, in apply order. */
export function collapse(mutations: Mutation[]): Mutation[] {
  const winners = new Map<string, Mutation>();
  for (const m of mutations) {
    const cell = `${m.roundId ?? m.outingId ?? ''}|${m.key}`;
    const existing = winners.get(cell);
    winners.set(cell, existing ? laterWins(existing, m) : m);
  }
  // Oldest first, so a later toggle still lands after an earlier one.
  return Array.from(winners.values()).sort((x, y) => x.at - y.at || x.id.localeCompare(y.id));
}

/**
 * Applies one mutation to a round, returning a new round.
 *
 * Unknown mutation kinds are ignored rather than thrown: a device running an
 * older build should not crash because a newer one sent something it has never
 * heard of. It just does not see that change.
 */
export function applyMutation(round: Round, mutation: Mutation): Round {
  switch (mutation.kind) {
    case 'score': {
      const { playerId, hole, strokes } = mutation.value as ScoreValue;
      if (!round.scores[playerId]) return round;
      const row = round.scores[playerId].slice();
      if (hole < 0 || hole >= row.length) return round;
      row[hole] = strokes;
      return { ...round, scores: { ...round.scores, [playerId]: row } };
    }
    case 'junk': {
      const { playerId, hole, kind, on } = mutation.value as JunkValue;
      const key = `${hole}:${playerId}:${kind as JunkKind}`;
      const junk = { ...round.junk };
      if (on) junk[key] = true;
      else delete junk[key];
      return { ...round, junk };
    }
    case 'pops': {
      const { playerId, pops } = mutation.value as { playerId: PlayerId; pops: number };
      return { ...round, pops: { ...round.pops, [playerId]: pops } };
    }
    case 'press': {
      const press = mutation.value as Round['presses'][number];
      if (round.presses.some((p) => p.id === press.id)) return round;
      return { ...round, presses: [...round.presses, press] };
    }
    case 'pressRemoved': {
      const { pressId } = mutation.value as { pressId: string };
      return { ...round, presses: round.presses.filter((p) => p.id !== pressId) };
    }
    case 'wolfPick': {
      const pick = mutation.value as Round['wolfPicks'][number];
      const rest = round.wolfPicks.filter((p) => p.hole !== pick.hole);
      return { ...round, wolfPicks: [...rest, pick].sort((a, b) => a.hole - b.hole) };
    }
    case 'gameToggle': {
      const { key, on } = mutation.value as { key: keyof Round['games']; on: boolean };
      if (!round.games[key]) return round;
      return { ...round, games: { ...round.games, [key]: { ...round.games[key], on } } };
    }
    case 'gameStake': {
      const { key, stake } = mutation.value as { key: keyof Round['games']; stake: number };
      if (!round.games[key]) return round;
      return { ...round, games: { ...round.games, [key]: { ...round.games[key], stake } } };
    }
    case 'options': {
      const patch = mutation.value as Partial<Round['options']>;
      return { ...round, options: { ...round.options, ...patch } };
    }
    case 'roundPlayers': {
      const { playerIds } = mutation.value as { playerIds: PlayerId[] };
      return { ...round, playerIds };
    }
    default:
      return round;
  }
}

/** Applies a batch in collapsed order. */
export function applyAll(round: Round, mutations: Mutation[]): Round {
  return collapse(mutations)
    .filter((m) => m.roundId === round.id)
    .reduce(applyMutation, round);
}
