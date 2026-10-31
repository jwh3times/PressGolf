import type { Course, Group, Outing, Round } from '../../domain/types';
import { applyMoveNotices, keepingPhoneOnly, type MoveNotice } from '../move-notices';
import { toRows, type Documents } from '../rows';
import { demoDocuments } from './fixtures';

const demo = demoDocuments();

const group: Group = {
  ...demo.groups[0],
  id: 'g1',
  players: [
    { ...demo.groups[0].players[0], id: 'p1' },
    { ...demo.groups[0].players[1], id: 'p:2' },
  ],
  youId: 'p1',
  defaultCourseId: 'c1',
};

const course: Course = {
  ...demo.courses[0],
  id: 'c1',
  tees: [
    { ...demo.courses[0].tees[0], id: 't1' },
    { ...demo.courses[0].tees[0], id: 't2' },
  ],
};

const round: Round = {
  ...demo.rounds[0],
  id: 'r1',
  groupId: 'g1',
  courseId: 'c1',
  outingId: 'o1',
  playerIds: ['p1', 'p:2'],
  teeId: 't1',
  playerTees: { 'p:2': 't2' },
  pops: { p1: 3, 'p:2': -1 },
  handicapTees: { p1: 't1', 'p:2': 't2' },
  scores: { p1: [4, null], 'p:2': [5, 6] },
  junk: { '0:p1:sandie': true, '1:p:2:greenie': true },
  pickups: { '1:p:2': true },
  presses: [{ id: 'press1', by: 'p1', against: 'p:2', startHole: 4, endHole: 8, stake: 500 }],
  wolfPicks: [
    { hole: 0, wolf: 'p1', partner: 'p:2' },
    { hole: 1, wolf: 'p:2', partner: null },
  ],
  options: { ...demo.rounds[0].options, teams: [['p1', 'p:2']], matchPairings: [['p:2', 'p1']] },
};

const outing: Outing = {
  ...demo.outings[0],
  id: 'o1',
  groupId: 'g1',
  courseId: 'c1',
  field: ['p1', 'p:2'],
  fieldGames: {
    fieldSkins: { ...demo.outings[0].fieldGames.fieldSkins, entrants: ['p1'] },
    scats: { ...demo.outings[0].fieldGames.scats, entrants: ['p:2', 'p1'] },
  },
  roundIds: ['r1'],
};

/** Someone else's day on this phone, and the guest's own bag and season beside it. */
const mine = demo.rounds.find((r) => r.id !== demo.rounds[0].id && r.outingId === null)!;
const held = {
  groups: [group, demo.groups[1]],
  courses: [course, demo.courses[1] ?? { ...demo.courses[0], id: 'c-mine' }],
  rounds: [round, mine],
  outings: [outing],
  clubs: demo.clubs,
  activeGroupId: 'g1',
};

const notices: MoveNotice[] = [
  { kind: 'outing', from_id: 'o1', to_id: null },
  { kind: 'group', from_id: 'g1', to_id: 'G1' },
  { kind: 'player', from_id: 'p1', to_id: 'P1' },
  { kind: 'player', from_id: 'p:2', to_id: 'P:2' },
  { kind: 'course', from_id: 'c1', to_id: 'C1' },
  { kind: 'tee', from_id: 't1', to_id: 'T1' },
  { kind: 'tee', from_id: 't2', to_id: 'T2' },
];

describe('applying move notices', () => {
  const moved = applyMoveNotices(held, notices);

  it("rewrites a group's ids, and marks it as only on this phone", () => {
    expect(moved.groups[0]).toEqual({
      ...group,
      id: 'G1',
      players: [
        { ...group.players[0], id: 'P1' },
        { ...group.players[1], id: 'P:2' },
      ],
      youId: 'P1',
      defaultCourseId: 'C1',
      phoneOnly: true,
    });
  });

  it("rewrites a course's ids, and marks it as only on this phone", () => {
    expect(moved.courses[0]).toEqual({
      ...course,
      id: 'C1',
      tees: [
        { ...course.tees[0], id: 'T1' },
        { ...course.tees[1], id: 'T2' },
      ],
      phoneOnly: true,
    });
  });

  it('rewrites every id in a round, including those held in keys', () => {
    expect(moved.rounds[0]).toEqual({
      ...round,
      groupId: 'G1',
      courseId: 'C1',
      playerIds: ['P1', 'P:2'],
      teeId: 'T1',
      playerTees: { 'P:2': 'T2' },
      pops: { P1: 3, 'P:2': -1 },
      handicapTees: { P1: 'T1', 'P:2': 'T2' },
      scores: { P1: [4, null], 'P:2': [5, 6] },
      junk: { '0:P1:sandie': true, '1:P:2:greenie': true },
      pickups: { '1:P:2': true },
      presses: [{ id: 'press1', by: 'P1', against: 'P:2', startHole: 4, endHole: 8, stake: 500 }],
      wolfPicks: [
        { hole: 0, wolf: 'P1', partner: 'P:2' },
        { hole: 1, wolf: 'P:2', partner: null },
      ],
      options: { ...round.options, teams: [['P1', 'P:2']], matchPairings: [['P:2', 'P1']] },
    });
  });

  it('rewrites every id in an outing, and marks it detached', () => {
    expect(moved.outings[0]).toEqual({
      ...outing,
      groupId: 'G1',
      courseId: 'C1',
      field: ['P1', 'P:2'],
      fieldGames: {
        fieldSkins: { ...outing.fieldGames.fieldSkins, entrants: ['P1'] },
        scats: { ...outing.fieldGames.scats, entrants: ['P:2', 'P1'] },
      },
      detached: true,
    });
  });

  it('follows the active group', () => {
    expect(moved.activeGroupId).toBe('G1');
  });

  it('leaves everything else exactly as it was', () => {
    expect(moved.groups[1]).toBe(held.groups[1]);
    expect(moved.courses[1]).toBe(held.courses[1]);
    expect(moved.rounds[1]).toBe(mine);
    expect(moved.clubs).toBe(held.clubs);
    expect(applyMoveNotices({ ...held, activeGroupId: 'elsewhere' }, notices).activeGroupId).toBe('elsewhere');
  });

  it('changes nothing the second time', () => {
    expect(applyMoveNotices(moved, notices)).toBe(moved);
  });

  it('changes nothing with no notices, or none about what this phone holds', () => {
    expect(applyMoveNotices(held, [])).toBe(held);
    const elsewhere: MoveNotice[] = [
      { kind: 'outing', from_id: 'not-here', to_id: null },
      { kind: 'group', from_id: 'not-here', to_id: 'x' },
      { kind: 'player', from_id: 'not-here', to_id: 'x' },
    ];
    expect(applyMoveNotices(held, elsewhere)).toBe(held);
  });

  it('keeps the kinds of id apart, when two share a value', () => {
    const shared = { ...held, groups: [group], courses: [{ ...course, id: 'g1' }], rounds: [], outings: [] };
    const after = applyMoveNotices(shared, [{ kind: 'group', from_id: 'g1', to_id: 'G1' }]);
    expect(after.groups[0].id).toBe('G1');
    expect(after.courses[0].id).toBe('g1');
  });

  it("moves the stand-in tee of a course that came with none, so two guests' copies can't collide", () => {
    const bare = { ...course, tees: [{ ...course.tees[0], id: 'c1_default' }] };
    const after = applyMoveNotices(
      { ...held, courses: [bare], rounds: [{ ...round, teeId: 'c1_default', playerTees: {}, handicapTees: {} }] },
      [{ kind: 'course', from_id: 'c1', to_id: 'C1' }],
    );
    expect(after.courses[0].tees[0].id).toBe('C1_default');
    expect(after.rounds[0].teeId).toBe('C1_default');
  });

  it('leaves a null tee, you and default course null', () => {
    const after = applyMoveNotices(
      {
        ...held,
        groups: [{ ...group, youId: null, defaultCourseId: null }],
        rounds: [{ ...round, teeId: null }],
      },
      notices,
    );
    expect(after.groups[0]).toMatchObject({ youId: null, defaultCourseId: null });
    expect(after.rounds[0].teeId).toBeNull();
  });
});

describe('what goes to the server', () => {
  const moved: Documents = applyMoveNotices(held, notices);

  it('leaves out a detached outing, its rounds, and a moved group and course nothing else uses', () => {
    const rows = toRows(moved);
    expect(rows.outings).toEqual([]);
    expect(rows.outing_field).toEqual([]);
    expect(rows.outing_field_games).toEqual([]);
    expect(rows.outing_field_entrants).toEqual([]);
    expect(rows.rounds.map((r) => r.id)).toEqual([mine.id]);
    expect(rows.scores.every((s) => s.round_id === mine.id)).toBe(true);
    expect(rows.groups.map((g) => g.id)).not.toContain('G1');
    expect(rows.players.map((p) => p.id)).not.toContain('P1');
    expect(rows.courses.map((c) => c.id)).not.toContain('C1');
    expect(rows.tees.map((t) => t.id)).not.toContain('T1');
    expect(rows.tee_holes.map((h) => h.tee_id)).not.toContain('T1');
  });

  it('sends a moved group and course up, under their new ids, once a round of its own uses them', () => {
    const rematch: Round = { ...moved.rounds[1], id: 'rematch', groupId: 'G1', courseId: 'C1', outingId: null };
    const rows = toRows({ ...moved, rounds: [...moved.rounds, rematch] });
    expect(rows.groups.map((g) => g.id)).toContain('G1');
    expect(rows.players.map((p) => p.id)).toEqual(expect.arrayContaining(['P1', 'P:2']));
    expect(rows.courses.map((c) => c.id)).toContain('C1');
    expect(rows.tees.map((t) => t.id)).toEqual(expect.arrayContaining(['T1', 'T2']));
    expect(rows.rounds.map((r) => r.id)).toContain('rematch');
    // The day itself still stays.
    expect(rows.rounds.map((r) => r.id)).not.toContain('r1');
    expect(rows.outings).toEqual([]);
  });

  it('sends them up for an outing of its own too', () => {
    const own: Outing = { ...moved.outings[0], id: 'own', detached: undefined };
    const rows = toRows({ ...moved, outings: [...moved.outings, own] });
    expect(rows.outings.map((o) => o.id)).toEqual(['own']);
    expect(rows.groups.map((g) => g.id)).toContain('G1');
    expect(rows.courses.map((c) => c.id)).toContain('C1');
  });
});

describe('adopting what the server has', () => {
  const moved = applyMoveNotices(held, notices);
  const remote: Documents = { groups: [demo.groups[1]], courses: [], rounds: [mine], outings: [], clubs: demo.clubs };

  it('keeps the detached day and the moved group and course, which the server never had', () => {
    const adopted = keepingPhoneOnly(moved, remote);
    expect(adopted.outings).toEqual([moved.outings[0]]);
    expect(adopted.rounds).toEqual([mine, moved.rounds[0]]);
    expect(adopted.groups).toEqual([demo.groups[1], moved.groups[0]]);
    expect(adopted.courses).toEqual([moved.courses[0]]);
    expect(adopted.clubs).toBe(demo.clubs);
  });

  it('takes the server at its word for anything else', () => {
    expect(keepingPhoneOnly(held, remote)).toEqual(remote);
  });

  it("takes the server's copy of a group or course it has as well", () => {
    const copy = { ...moved.groups[0], name: 'From the server', phoneOnly: undefined };
    const adopted = keepingPhoneOnly(moved, { ...remote, groups: [copy] });
    expect(adopted.groups).toEqual([copy]);
  });
});
