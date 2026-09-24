import {
  PLAYER_COLORS,
  defaultTeams,
  deriveInitials,
  makeCourse,
  makeGroup,
  makeId,
  makeOuting,
  makePlayer,
  makeRound,
  reconcileRound,
  splitIntoGroups,
} from '../factory';

describe('domain factories', () => {
  beforeEach(() => jest.spyOn(Date, 'now').mockReturnValue(1_750_000_000_000));
  afterEach(() => jest.restoreAllMocks());

  it('creates stable ids and useful initials for every name shape', () => {
    expect(makeId('p')).toMatch(/^p_/);
    expect(makeId('p')).not.toBe(makeId('p'));
    expect(deriveInitials(' Big Ray ')).toBe('BR');
    expect(deriveInitials('Dev')).toBe('DE');
    expect(deriveInitials('D!')).toBe('D');
    expect(deriveInitials('!!!')).toBe('??');
    expect(deriveInitials('   ')).toBe('??');
  });

  it('builds players and groups with defaults and overrides', () => {
    const first = makePlayer('Alice Able', 0);
    const wrapped = makePlayer('Bob', PLAYER_COLORS.length, { initials: 'B' });
    const empty = makeGroup('Empty');
    const group = makeGroup('Saturday', [first, wrapped]);

    expect(first.color).toBe(PLAYER_COLORS[0]);
    expect(wrapped).toMatchObject({ color: PLAYER_COLORS[0], initials: 'B' });
    expect(empty.youId).toBeNull();
    expect(group).toMatchObject({ name: 'Saturday', youId: first.id, players: [first, wrapped] });
  });

  it('builds courses, rounds, and outings with both defaults and explicit options', () => {
    const players = [makePlayer('A', 0), makePlayer('B', 1)];
    const group = makeGroup('Group', players);
    const nine = makeCourse('Nine', 9);
    const standard = makeRound(group, nine);
    const selected = makeRound(group, nine, [players[1].id], {
      outingId: 'outing',
      name: 'Back group',
      teeTime: '08:10',
    });
    const outing = makeOuting(group, nine);
    const customOuting = makeOuting(group, nine, {
      name: 'Cup',
      field: [players[1].id],
      teeFormat: 'shotgun',
      date: 123,
    });

    expect(nine.holes).toHaveLength(9);
    expect(nine.holes[0]).toEqual({ number: 1, par: 4, strokeIndex: 1, yards: 0 });
    expect(standard).toMatchObject({ playerIds: players.map((p) => p.id), outingId: null, name: 'Our group' });
    expect(standard.scores[players[0].id]).toEqual(Array(9).fill(null));
    expect(selected).toMatchObject({ playerIds: [players[1].id], outingId: 'outing', name: 'Back group' });
    expect(outing).toMatchObject({ name: 'Nine outing', teeFormat: 'sequential', field: players.map((p) => p.id) });
    expect(customOuting).toMatchObject({ name: 'Cup', teeFormat: 'shotgun', field: [players[1].id], date: 123 });
  });

  it('splits fields without leaving a player alone and forms pairs', () => {
    expect(splitIntoGroups([])).toEqual([]);
    expect(splitIntoGroups(['a', 'b', 'c'], 2)).toEqual([['a', 'b', 'c']]);
    expect(splitIntoGroups(['a', 'b', 'c', 'd'], 2)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(defaultTeams(['a', 'b', 'c'])).toEqual([['a', 'b']]);
  });

  it('reconciles player maps, preserving, extending, trimming, adding, and removing rows', () => {
    const players = [makePlayer('A', 0), makePlayer('B', 1), makePlayer('C', 2)];
    const group = makeGroup('Group', players);
    const round = makeRound(group, makeCourse('Course', 9));
    round.pops[players[2].id] = 3;
    round.scores[players[0].id] = [4];
    round.scores[players[1].id] = Array(12).fill(5);
    round.playerIds = [players[0].id, players[1].id, 'new'];

    const reconciled = reconcileRound(round, 9);

    expect(reconciled.scores[players[0].id]).toEqual([4, ...Array(8).fill(null)]);
    expect(reconciled.scores[players[1].id]).toHaveLength(9);
    expect(reconciled.scores.new).toEqual(Array(9).fill(null));
    expect(reconciled.pops.new).toBe(0);
    expect(reconciled.scores[players[2].id]).toBeUndefined();
    expect(reconciled.pops[players[2].id]).toBeUndefined();
  });
});
