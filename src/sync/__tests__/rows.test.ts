import { buildDemoDataset } from '../../demo/seed';
import { GAME_KEYS } from '../../domain/types';
import { makeTestCourse, makeTestGroup, makeTestRound, flat } from '../../domain/__tests__/helpers';
import { countRows, emptySnapshot, fromRows, toRows, TABLES, type Documents } from '../rows';

/** The demo dataset is the broadest real data there is: two groups, a
 *  twenty-man outing with field pots, eighteen settled rounds and a live one.
 *  The demo has nobody pressing, no Wolf picks and no explicit match pairings
 *  (round robin is derived, not stored), so one of each is added here —
 *  otherwise those tables would go untested and the gap would look like a
 *  passing suite. */
function demoDocuments(): Documents {
  const data = buildDemoDataset(1_700_000_000_000);
  const rounds = data.rounds.map((round, index) =>
    index === 0
      ? {
          ...round,
          presses: [
            {
              id: 'press_1',
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
          options: {
            ...round.options,
            matchPairings: [
              [round.playerIds[0], round.playerIds[3]] as [string, string],
              [round.playerIds[1], round.playerIds[2]] as [string, string],
            ],
          },
        }
      : round,
  );
  return { groups: data.groups, courses: data.courses, rounds, outings: data.outings };
}

describe('toRows / fromRows round trip', () => {
  it('puts the whole demo dataset through unchanged', () => {
    const before = demoDocuments();
    const after = fromRows(toRows(before));
    expect(after).toEqual(before);
  });

  it('covers every table the schema has', () => {
    const rows = toRows(demoDocuments());
    // Nothing should be silently unmapped; each table gets exercised.
    for (const table of TABLES) {
      expect({ table, rows: rows[table].length > 0 }).toEqual({ table, rows: true });
    }
  });

  it('writes one row per cell of every card, empty boxes included', () => {
    const round = makeTestRound({ scores: [flat(4), flat(5), flat(4), flat(6)] });
    const rows = toRows({ groups: [], courses: [], rounds: [round], outings: [] });
    expect(rows.scores).toHaveLength(4 * 18);
  });

  it('keeps an unplayed hole distinct from a hole scored zero', () => {
    const round = makeTestRound({ scores: [flat(4), flat(4), flat(4), flat(4)] });
    round.scores.a[5] = null;
    round.scores.a[6] = 0;
    const back = fromRows(toRows({ groups: [], courses: [], rounds: [round], outings: [] }));
    expect(back.rounds[0].scores.a[5]).toBeNull();
    expect(back.rounds[0].scores.a[6]).toBe(0);
  });

  it('brings an all-empty card back at its full width', () => {
    const round = makeTestRound({ scores: [], playerCount: 4 });
    const back = fromRows(toRows({ groups: [], courses: [], rounds: [round], outings: [] }));
    for (const playerId of round.playerIds) {
      expect(back.rounds[0].scores[playerId]).toHaveLength(round.scores[playerId].length);
    }
  });

  it('preserves tee order, which is what Wolf rotates through', () => {
    const round = makeTestRound({ scores: [], playerCount: 4 });
    round.playerIds = ['d', 'c', 'b', 'a'];
    const back = fromRows(toRows({ groups: [], courses: [], rounds: [round], outings: [] }));
    expect(back.rounds[0].playerIds).toEqual(['d', 'c', 'b', 'a']);
  });

  it('preserves roster order, which is the default tee order', () => {
    const group = makeTestGroup(4);
    group.players.reverse();
    const back = fromRows(toRows({ groups: [group], courses: [], rounds: [], outings: [] }));
    expect(back.groups[0].players.map((p) => p.id)).toEqual(group.players.map((p) => p.id));
  });

  it('keeps holes in card order even when the rows arrive shuffled', () => {
    const course = makeTestCourse();
    const rows = toRows({ groups: [], courses: [course], rounds: [], outings: [] });
    rows.holes.reverse();
    const back = fromRows(rows);
    expect(back.courses[0].holes).toEqual(course.holes);
  });

  it('round-trips a junk key whose player id contains a colon', () => {
    const round = makeTestRound({ scores: [], playerCount: 4 });
    round.junk = { '4:odd:id:greenie': true };
    const rows = toRows({ groups: [], courses: [], rounds: [round], outings: [] });
    expect(rows.junk[0]).toMatchObject({ hole: 4, player_id: 'odd:id', kind: 'greenie' });
    expect(fromRows(rows).rounds[0].junk).toEqual(round.junk);
  });

  it('writes a row for every format, on or off, so a stake is never lost', () => {
    const round = makeTestRound({ scores: [], playerCount: 4 });
    const rows = toRows({ groups: [], courses: [], rounds: [round], outings: [] });
    expect(rows.round_games).toHaveLength(GAME_KEYS.length);
  });

  it('derives an outing’s groups from the rounds that point at it', () => {
    const before = demoDocuments();
    const outing = before.outings[0];
    expect(outing.roundIds.length).toBeGreaterThan(1);
    const after = fromRows(toRows(before));
    expect(after.outings[0].roundIds).toEqual(outing.roundIds);
  });

  it('survives a second trip, so syncing twice cannot drift', () => {
    const once = fromRows(toRows(demoDocuments()));
    const twice = fromRows(toRows(once));
    expect(twice).toEqual(once);
  });
});

describe('snapshot helpers', () => {
  it('starts empty', () => {
    const snapshot = emptySnapshot();
    expect(countRows(snapshot)).toBe(0);
    expect(fromRows(snapshot)).toEqual({ groups: [], courses: [], rounds: [], outings: [] });
  });

  it('counts every row it holds', () => {
    const rows = toRows(demoDocuments());
    const byHand = TABLES.reduce((total, table) => total + rows[table].length, 0);
    expect(countRows(rows)).toBe(byHand);
  });

  it('rebuilds sparse legacy rows with safe defaults', () => {
    const rows = emptySnapshot();
    rows.groups.push({
      id: 'group',
      name: 'Sparse',
      you_id: null,
      default_course_id: null,
      subtitle: '',
      created_at: 1,
    });
    rows.courses.push({ id: 'course', name: 'Bare', created_at: 1 });
    rows.rounds.push({
      id: 'round',
      group_id: 'group',
      course_id: 'course',
      outing_id: 'outing',
      name: 'Round',
      tee_time: null,
      status: 'active',
      started_at: 1,
      completed_at: null,
    });
    rows.outings.push({
      id: 'outing',
      group_id: 'group',
      course_id: 'course',
      name: 'Outing',
      date: 1,
      tee_format: 'sequential',
      status: 'active',
      started_at: 1,
      completed_at: null,
    });

    const documents = fromRows(rows);
    expect(documents.groups[0].players).toEqual([]);
    expect(documents.courses[0].holes).toEqual([]);
    expect(documents.rounds[0]).toMatchObject({
      playerIds: [],
      scores: {},
      junk: {},
      presses: [],
      wolfPicks: [],
      options: {
        teams: [],
        matchPairings: [],
        wolfLoneMultiplier: 1,
        vegasFlipOnBirdie: true,
        stablefordPoints: { eagleOrBetter: 4, birdie: 3, par: 2, bogey: 1, worse: 0 },
      },
    });
    expect(documents.outings[0]).toMatchObject({
      field: [],
      roundIds: ['round'],
      fieldGames: {
        fieldSkins: {
          on: false,
          buyIn: 0,
          entrants: [],
          useNet: true,
          carry: true,
          unclaimed: 'splitAmongWinners',
        },
        scats: {
          on: false,
          buyIn: 0,
          entrants: [],
          useNet: false,
          carry: true,
          unclaimed: 'splitAmongWinners',
        },
      },
    });
  });

  it('skips malformed junk keys and supplies absent score maps and pops on upload', () => {
    const round = makeTestRound({ scores: [], playerCount: 2 });
    round.junk = { malformed: true, ':also-bad': true, '2:a:greenie': true };
    delete round.pops[round.playerIds[0]];
    delete round.scores[round.playerIds[0]];
    const rows = toRows({ groups: [], courses: [], rounds: [round], outings: [] });
    expect(rows.junk).toHaveLength(1);
    expect(rows.round_players[0].pops).toBe(0);
    expect(rows.scores.every((score) => score.player_id !== round.playerIds[0])).toBe(true);
  });
});
