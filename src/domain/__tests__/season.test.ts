import type { Round } from '../types';
import { buildSeason } from '../season';
import { flat, makeTestCourse, makeTestGroup, makeTestRound } from './helpers';

describe('buildSeason', () => {
  const course = makeTestCourse();
  const group = makeTestGroup(2);
  const skins = { skins: { on: true, stake: 100 } };
  // The first player wins every hole of the posted round; the second would have won the abandoned one.
  const posted: Round = {
    ...makeTestRound({ scores: [flat(4), flat(5)], games: skins }),
    id: 'posted',
    status: 'completed',
    completedAt: 1,
  };
  const abandoned: Round = {
    ...makeTestRound({ scores: [flat(6), flat(3)], games: skins }),
    id: 'abandoned',
    status: 'abandoned',
    completedAt: 2,
  };

  it('counts posted rounds only, never an abandoned one', () => {
    const season = buildSeason(group, [posted, abandoned], [course]);
    expect(season.roundsCounted).toBe(1);
    expect(season).toEqual(buildSeason(group, [posted], [course]));

    const [first, second] = group.players.map((p) => season.entries.find((e) => e.playerId === p.id)!);
    expect(first.net).toBeGreaterThan(0);
    expect(second.net).toBeLessThan(0);
    expect(first.roundsPlayed).toBe(1);
  });
});
