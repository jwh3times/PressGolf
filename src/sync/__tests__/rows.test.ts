import { GAME_KEYS, type Mark } from '../../domain/types';
import { makeTestCourse, makeTestGroup, makeTestRound, flat, withTee } from '../../domain/__tests__/helpers';
import { countRows, emptySnapshot, fromRows, toRows, TABLES, cellValue, sawJunk, seenIn, seenValue } from '../rows';
import { demoDocuments } from './fixtures';

describe('seenIn', () => {
  const cell = (hole: number, strokes: number | null, picked_up = false) => ({ round_id: 'r', player_id: 'p', hole, strokes, picked_up });
  const claim = { round_id: 'r', hole: 2, player_id: 'p', kind: 'sandie' };

  it('keeps what each box held and each claim, and nothing for a blank box', () => {
    const seen = seenIn({ ...emptySnapshot(), scores: [cell(0, 5), cell(1, null), cell(2, null, true)], junk: [claim] });
    expect(seen).toEqual({ scores: { r: { p: { 0: 5, 2: 'p' } } }, junk: { r: ['2:p:sandie'] } });

    expect(seenValue(seen, cell(0, 9))).toBe(5);
    expect(seenValue(seen, cell(1, 9))).toBeNull();
    expect(seenValue(seen, cell(2, 9))).toBe('p');
    expect(seenValue(seen, { ...cell(0, 9), round_id: 'other' })).toBeNull();
    expect(seenValue(null, cell(0, 9))).toBeNull();
    expect(sawJunk(seen, claim)).toBe(true);
    expect(sawJunk(seen, { ...claim, kind: 'greenie' })).toBe(false);
    expect(sawJunk(null, claim)).toBe(false);
  });

  it('reads a box with no pick-up column as its strokes', () => {
    expect(cellValue({ round_id: 'r', player_id: 'p', hole: 0, strokes: 4 })).toBe(4);
  });
});

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
    const rows = toRows({ groups: [], courses: [], rounds: [round], outings: [], clubs: [], marks: [] });
    expect(rows.scores).toHaveLength(4 * 18);
  });

  it('keeps an unplayed hole distinct from a hole scored zero', () => {
    const round = makeTestRound({ scores: [flat(4), flat(4), flat(4), flat(4)] });
    round.scores.a[5] = null;
    round.scores.a[6] = 0;
    const back = fromRows(toRows({ groups: [], courses: [], rounds: [round], outings: [], clubs: [], marks: [] }));
    expect(back.rounds[0].scores.a[5]).toBeNull();
    expect(back.rounds[0].scores.a[6]).toBe(0);
  });

  it('brings an all-empty card back at its full width', () => {
    const round = makeTestRound({ scores: [], playerCount: 4 });
    const back = fromRows(toRows({ groups: [], courses: [], rounds: [round], outings: [], clubs: [], marks: [] }));
    for (const playerId of round.playerIds) {
      expect(back.rounds[0].scores[playerId]).toHaveLength(round.scores[playerId].length);
    }
  });

  it('preserves tee order, which is what Wolf rotates through', () => {
    const round = makeTestRound({ scores: [], playerCount: 4 });
    round.playerIds = ['d', 'c', 'b', 'a'];
    const back = fromRows(toRows({ groups: [], courses: [], rounds: [round], outings: [], clubs: [], marks: [] }));
    expect(back.rounds[0].playerIds).toEqual(['d', 'c', 'b', 'a']);
  });

  it('preserves roster order, which is the default tee order', () => {
    const group = makeTestGroup(4);
    group.players.reverse();
    const back = fromRows(toRows({ groups: [group], courses: [], rounds: [], outings: [], clubs: [], marks: [] }));
    expect(back.groups[0].players.map((p) => p.id)).toEqual(group.players.map((p) => p.id));
  });

  it('keeps tees and holes in card order even when the rows arrive shuffled', () => {
    const course = withTee(makeTestCourse(), 'red', () => ({ yards: 320 }));
    const rows = toRows({ groups: [], courses: [course], rounds: [], outings: [], clubs: [], marks: [] });
    rows.tees.reverse();
    rows.tee_holes.reverse();
    const back = fromRows(rows);
    expect(back.courses[0].tees).toEqual(course.tees);
  });

  it('keeps greens in hole order, and front and back only as a pair', () => {
    const course = demoDocuments().courses[0];
    const rows = toRows({ groups: [], courses: [course], rounds: [], outings: [], clubs: [], marks: [] });
    expect(rows.course_greens[0]).toMatchObject({ number: 1, front_lat: null, front_lng: null, back_lat: null, back_lng: null });
    rows.course_greens.reverse();
    // A half-written point is no point at all.
    rows.course_greens[0].back_lng = null;
    const back = fromRows(rows).courses[0].greens;
    expect(back.map((g) => g.number)).toEqual([1, 2]);
    expect(back[1].front).toEqual(course.greens[1].front);
    expect(back[1].back).toBeNull();
  });

  it('round-trips a course map, its outlines as [lat, lng] pairs, in id order whatever order the rows arrive', () => {
    const course = {
      ...makeTestCourse(),
      features: [
        {
          id: 'map:ob-1',
          kind: 'outOfBounds' as const,
          hole: null,
          points: [{ lat: 45.5, lng: -122.6 }, { lat: 45.51, lng: -122.6 }],
          holes: [3, 4],
          source: 'map' as const,
        },
        { id: 'osm:way/7', kind: 'holeLine' as const, hole: 7, points: [{ lat: 45.5, lng: -122.61 }, { lat: 45.502, lng: -122.612 }], source: 'osm' as const },
      ],
    };
    const rows = toRows({ groups: [], courses: [course], rounds: [], outings: [], clubs: [], marks: [] });
    expect(rows.course_features[1]).toEqual({
      course_id: course.id,
      id: 'osm:way/7',
      kind: 'holeLine',
      hole: 7,
      points: [[45.5, -122.61], [45.502, -122.612]],
      holes: null,
      source: 'osm',
    });
    expect(rows.course_features[0].holes).toEqual([3, 4]);
    rows.course_features.reverse();
    expect(fromRows(rows).courses[0].features).toEqual(course.features);
  });

  it('round-trips the owner\'s hole notes in hole order, whatever order the rows arrive', () => {
    const course = {
      ...makeTestCourse(),
      notes: [
        { number: 3, text: 'Blind tee shot, aim at the steeple.' },
        { number: 12, text: 'The green runs away from you.' },
      ],
    };
    const rows = toRows({ groups: [], courses: [course], rounds: [], outings: [], clubs: [], marks: [] });
    expect(rows.course_hole_notes).toEqual([
      { course_id: course.id, number: 3, text: 'Blind tee shot, aim at the steeple.' },
      { course_id: course.id, number: 12, text: 'The green runs away from you.' },
    ]);
    rows.course_hole_notes.reverse();
    expect(fromRows(rows).courses[0].notes).toEqual(course.notes);
  });

  it('round-trips the bag in its order, whatever order the rows arrive', () => {
    const clubs = [
      { id: 'k-driver', name: 'Driver', carry: 240 },
      { id: 'k-wedge', name: '60° wedge', carry: null },
    ];
    const rows = toRows({ groups: [], courses: [], rounds: [], outings: [], clubs, marks: [] });
    expect(rows.clubs).toEqual([
      { id: 'k-driver', name: 'Driver', carry_yards: 240, position: 0 },
      { id: 'k-wedge', name: '60° wedge', carry_yards: null, position: 1 },
    ]);
    rows.clubs.reverse();
    expect(fromRows(rows).clubs).toEqual(clubs);
  });

  it('round-trips the bag owner\'s marks in the order they were made, whatever order the rows arrive', () => {
    const marks: Mark[] = [
      { id: 'm1', roundId: 'r1', hole: 3, position: { lat: 45.5121, lng: -122.6113 }, accuracy: 4.5, at: 1_700_000_000_000, kind: 'full', clubId: 'k7' },
      { id: 'm2', roundId: 'r1', hole: 3, position: { lat: 45.513, lng: -122.612 }, accuracy: null, at: 1_700_000_060_000, kind: 'partial', clubId: null },
      { id: 'm3', roundId: 'r1', hole: 3, position: { lat: 45.5135, lng: -122.6124 }, accuracy: 12, at: 1_700_000_120_000, kind: 'green', clubId: null },
    ];
    const rows = toRows({ groups: [], courses: [], rounds: [], outings: [], clubs: [], marks });
    expect(rows.marks[0]).toEqual({
      id: 'm1',
      round_id: 'r1',
      hole: 3,
      lat: 45.5121,
      lng: -122.6113,
      accuracy_m: 4.5,
      marked_at: 1_700_000_000_000,
      kind: 'full',
      club_id: 'k7',
    });
    rows.marks.reverse();
    expect(fromRows(rows).marks).toEqual(marks);
  });

  it('keeps the marks of a detached day on the phone, with the day', () => {
    const before = demoDocuments();
    const day = before.outings[0];
    const onDay = before.rounds.find((round) => round.outingId === day.id)!;
    const ownRound = before.rounds.find((round) => round.outingId === null)!;
    const mark = (id: string, roundId: string): Mark => ({
      id, roundId, hole: 1, position: { lat: 45.5, lng: -122.6 }, accuracy: 5, at: 1, kind: 'partial', clubId: null,
    });
    const rows = toRows({
      ...before,
      outings: before.outings.map((outing) => (outing.id === day.id ? { ...outing, detached: true as const } : outing)),
      marks: [mark('on-day', onDay.id), mark('own', ownRound.id)],
    });
    expect(rows.marks.map((row) => row.id)).toEqual(['own']);
  });

  it('round-trips how the bag\'s owner usually scores, as one row, and no row until they say', () => {
    const rows = toRows({ groups: [], courses: [], rounds: [], outings: [], clubs: [], marks: [], usualScore: '90s' });
    expect(rows.bag_settings).toEqual([{ id: 'bag', usual_score: '90s' }]);
    expect(fromRows(rows).usualScore).toBe('90s');
    expect(toRows({ groups: [], courses: [], rounds: [], outings: [], clubs: [], marks: [] }).bag_settings).toEqual([]);
    expect(fromRows(emptySnapshot())).not.toHaveProperty('usualScore');
  });

  it('round-trips a junk key whose player id contains a colon', () => {
    const round = makeTestRound({ scores: [], playerCount: 4 });
    round.junk = { '4:odd:id:greenie': true };
    const rows = toRows({ groups: [], courses: [], rounds: [round], outings: [], clubs: [], marks: [] });
    expect(rows.junk[0]).toMatchObject({ hole: 4, player_id: 'odd:id', kind: 'greenie' });
    expect(fromRows(rows).rounds[0].junk).toEqual(round.junk);
  });

  it('round-trips an abandoned round as abandoned, with when it was abandoned', () => {
    const round = { ...makeTestRound({ scores: [], playerCount: 4 }), status: 'abandoned' as const, completedAt: 1_750_000_000_000 };
    const rows = toRows({ groups: [], courses: [], rounds: [round], outings: [], clubs: [], marks: [] });
    expect(rows.rounds[0]).toMatchObject({ status: 'abandoned', completed_at: 1_750_000_000_000 });
    expect(fromRows(rows).rounds[0]).toMatchObject({ status: 'abandoned', completedAt: 1_750_000_000_000 });
  });

  it('writes a row for every format, on or off, so a stake is never lost', () => {
    const round = makeTestRound({ scores: [], playerCount: 4 });
    const rows = toRows({ groups: [], courses: [], rounds: [round], outings: [], clubs: [], marks: [] });
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
    expect(fromRows(snapshot)).toEqual({ groups: [], courses: [], rounds: [], outings: [], clubs: [], marks: [] });
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
      tee_id: null,
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
    expect(documents.groups[0]).toMatchObject({ maxScore: 'off', strokes: 'off_low', allowance: 100 });
    expect(documents.outings[0]).toMatchObject({ maxScore: 'off', strokes: 'off_low', allowance: 100 });
    // A course always has a tee; one with none on the server comes back with an empty Default.
    expect(documents.courses[0].tees).toEqual([
      { id: 'course_default', name: 'Default', slope: null, rating: null, holes: [] },
    ]);
    expect(documents.rounds[0]).toMatchObject({
      playerIds: [],
      scores: {},
      junk: {},
      entry: 'live',
      teeId: null,
      playerTees: {},
      pickups: {},
      presses: [],
      wolfPicks: [],
      handicapTees: {},
      options: {
        maxScore: 'off',
        strokes: 'off_low',
        allowance: 100,
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
    const rows = toRows({ groups: [], courses: [], rounds: [round], outings: [], clubs: [], marks: [] });
    expect(rows.junk).toHaveLength(1);
    expect(rows.round_players[0].pops).toBe(0);
    expect(rows.scores.every((score) => score.player_id !== round.playerIds[0])).toBe(true);
  });
});
