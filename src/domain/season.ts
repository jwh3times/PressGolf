import { settleRound } from './engine';
import type { Cents, Course, Group, Player, PlayerId, Round, SeasonEntry } from './types';

export interface SeasonSummary {
  entries: SeasonEntry[];
  roundsCounted: number;
  /** Earliest round in the summary, for the "since April" line. */
  since: number | null;
  /** Largest absolute net, used to scale the bars. */
  peak: Cents;
}

/**
 * Season standings, built by re-settling every completed round.
 *
 * Nothing is cached: rounds are small, and a stored total would go stale the
 * moment somebody corrects a score from three weeks ago.
 */
export function buildSeason(
  group: Group,
  rounds: Round[],
  courses: Course[],
  options: { includeActive?: boolean } = {},
): SeasonSummary {
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const relevant = rounds.filter(
    (r) => r.groupId === group.id && (options.includeActive ? true : r.status === 'completed'),
  );

  const totals: Record<PlayerId, Cents> = {};
  const appearances: Record<PlayerId, number> = {};
  for (const player of group.players) {
    totals[player.id] = 0;
    appearances[player.id] = 0;
  }

  let since: number | null = null;
  for (const round of relevant) {
    const course = courseById.get(round.courseId);
    if (!course) continue;
    const settlement = settleRound(round, course, group.players);
    for (const id of round.playerIds) {
      if (totals[id] == null) continue; // player has since left the group
      totals[id] += settlement.net[id] ?? 0;
      appearances[id] += 1;
    }
    since = since == null ? round.startedAt : Math.min(since, round.startedAt);
  }

  const entries: SeasonEntry[] = group.players
    .map((p) => ({ playerId: p.id, net: totals[p.id] ?? 0, roundsPlayed: appearances[p.id] ?? 0 }))
    .sort((a, b) => b.net - a.net);

  const peak = entries.reduce((max, e) => Math.max(max, Math.abs(e.net)), 0);

  return { entries, roundsCounted: relevant.length, since, peak };
}

/** "18 rounds · since April" */
export function seasonSubtitle(summary: SeasonSummary): string {
  const rounds = `${summary.roundsCounted} round${summary.roundsCounted === 1 ? '' : 's'}`;
  if (summary.since == null) return rounds;
  const month = new Date(summary.since).toLocaleString(undefined, { month: 'long' });
  return `${rounds} · since ${month}`;
}

export function playerById(players: Player[], id: PlayerId): Player | undefined {
  return players.find((p) => p.id === id);
}
