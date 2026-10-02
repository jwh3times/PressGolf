import { buildDemoDataset } from '../../demo/seed';
import type { Documents } from '../rows';

/** The demo dataset is the broadest real data there is: two groups, a
 *  twenty-man outing with field pots, eighteen settled rounds and a live one.
 *  The demo has nobody pressing, no Wolf picks and no explicit match pairings
 *  (round robin is derived, not stored), so one of each is added here —
 *  otherwise those tables would go untested and the gap would look like a
 *  passing suite. */
export function demoDocuments(runPrefix?: string): Documents {
  const data = buildDemoDataset(1_700_000_000_000);
  const rounds = data.rounds.map((round, index) =>
    index === 0
      ? {
          ...round,
          presses: [
            {
              id: 'demo_press_1',
              by: round.playerIds[0],
              against: round.playerIds[1],
              startHole: 4,
              endHole: 8,
              stake: 500,
            },
          ],
          wolfPicks: [
            { hole: 0, wolf: round.playerIds[0], partner: round.playerIds[2] },
            { hole: 1, wolf: round.playerIds[1], partner: null },
          ],
          pickups: { [`3:${round.playerIds[1]}`]: true as const },
          entry: 'card' as const,
          teeId: 'demo_tee_blue',
          playerTees: { [round.playerIds[2]]: 'demo_tee_red' },
          handicapTees: { [round.playerIds[0]]: 'demo_tee_blue', [round.playerIds[2]]: 'demo_tee_red' },
          pops: { ...round.pops, [round.playerIds[0]]: -2 },
          options: {
            ...round.options,
            maxScore: 'net_double_bogey' as const,
            strokes: 'full' as const,
            allowance: 90,
            matchPairings: [
              [round.playerIds[0], round.playerIds[3]] as [string, string],
              [round.playerIds[1], round.playerIds[2]] as [string, string],
            ],
          },
        }
      : round,
  );
  // A plus index is negative; the last player has none.
  const indexes = [-1.4, 12.4, 18.0, null];
  const groups = data.groups.map((g, i) =>
    i === 0
      ? {
          ...g,
          maxScore: 'double_bogey' as const,
          strokes: 'full' as const,
          allowance: 85,
          players: g.players.map((p, j) => ({
            ...p,
            handicapIndex: indexes[j] ?? null,
            handicapUpdatedAt: indexes[j] == null ? null : 1_750_000_000_000 + j,
          })),
        }
      : g,
  );
  const outings = data.outings.map((o) => ({ ...o, maxScore: 'double_bogey' as const, strokes: 'full' as const, allowance: 80 }));
  const documents: Documents = { groups, courses: data.courses, rounds, outings };
  if (!runPrefix) return documents;
  // Ids are global primary keys on the server, so a run against a shared
  // database gives every id its own prefix. Every demo id starts with demo_.
  return JSON.parse(JSON.stringify(documents).replaceAll('demo_', `${runPrefix}_demo_`)) as Documents;
}
