import { buildDemoDataset } from '../../demo/seed';
import { changedRows, countDeletions, deletions, GUEST_WRITES, identify, isEmpty, KEYS, splitByOwner } from '../diff';
import { emptySnapshot, toRows, TABLES, type Documents, type Snapshot } from '../rows';

function demoRows(): Snapshot {
  const data = buildDemoDataset(1_700_000_000_000);
  const documents: Documents = {
    groups: data.groups,
    courses: data.courses,
    rounds: data.rounds,
    outings: data.outings,
    clubs: data.clubs,
  };
  return toRows(documents);
}

describe('KEYS', () => {
  it('names a key for every table', () => {
    for (const table of TABLES) {
      expect({ table, keyed: (KEYS[table]?.length ?? 0) > 0 }).toEqual({ table, keyed: true });
    }
  });
});

describe('identify', () => {
  it('separates rows that differ only in which column holds the value', () => {
    // Without length-prefixing, {round_id:'a', player_id:'bc'} and
    // {round_id:'ab', player_id:'c'} would collapse to the same identity and
    // one of them would be silently dropped from a delete.
    const one = identify('round_players', { round_id: 'a', player_id: 'bc' });
    const two = identify('round_players', { round_id: 'ab', player_id: 'c' });
    expect(one).not.toBe(two);
  });

  it('is stable for the same row', () => {
    const row = { round_id: 'r', player_id: 'p', hole: 4 };
    expect(identify('scores', row)).toBe(identify('scores', { ...row }));
  });

  it('ignores columns that are not part of the key', () => {
    expect(identify('scores', { round_id: 'r', player_id: 'p', hole: 4, strokes: 4 })).toBe(
      identify('scores', { round_id: 'r', player_id: 'p', hole: 4, strokes: 9 }),
    );
  });
});

describe('deletions', () => {
  it('finds nothing when both sides match', () => {
    const rows = demoRows();
    expect(countDeletions(deletions(rows, rows))).toBe(0);
  });

  it('finds everything when the phone has been emptied', () => {
    const rows = demoRows();
    const all = deletions(rows, emptySnapshot());
    expect(countDeletions(all)).toBe(
      TABLES.reduce((total, table) => total + rows[table].length, 0),
    );
  });

  it('finds nothing to remove when the phone has more than the server', () => {
    expect(countDeletions(deletions(emptySnapshot(), demoRows()))).toBe(0);
  });

  it('spots a single player dropped from a roster', () => {
    const remote = demoRows();
    const local = demoRows();
    const dropped = local.players.pop()!;
    const found = deletions(remote, local);
    expect(found.players).toEqual([{ id: dropped.id }]);
    expect(countDeletions(found)).toBe(1);
  });

  it('spots a score cleared from one box, and names only its key', () => {
    const remote = demoRows();
    const local = demoRows();
    const removed = local.scores.splice(10, 1)[0];
    const found = deletions(remote, local);
    expect(found.scores).toEqual([
      { round_id: removed.round_id, player_id: removed.player_id, hole: removed.hole },
    ]);
  });

  it('does not confuse a changed value for a deleted row', () => {
    const remote = demoRows();
    const local = demoRows();
    local.scores[0] = { ...local.scores[0], strokes: 11 };
    expect(countDeletions(deletions(remote, local))).toBe(0);
  });
});

describe('changedRows', () => {
  it('sends nothing when the server already holds every row', () => {
    const rows = demoRows();
    const changed = changedRows(structuredClone(rows), rows);
    expect(TABLES.filter((table) => changed[table].length > 0)).toEqual([]);
  });

  it('sends the one score that changed and nothing else', () => {
    const server = demoRows();
    const local = structuredClone(server);
    const edited = local.scores.findIndex((row) => row.strokes == null);
    local.scores[edited] = { ...local.scores[edited], strokes: 5 };

    const changed = changedRows(server, local);
    expect(changed.scores).toEqual([local.scores[edited]]);
    expect(TABLES.filter((table) => changed[table].length > 0)).toEqual(['scores']);
  });

  it('sends rows the server lacks, and a row whose nested value changed', () => {
    const server = demoRows();
    const local = structuredClone(server);
    const added = { ...local.players[0], id: 'new-player' };
    local.players.push(added);
    local.course_greens.push({ course_id: local.courses[0].id, number: 1, middle_lat: 1, middle_lng: 2, front_lat: null, front_lng: null, back_lat: null, back_lng: null, source: 'map' });
    server.course_greens.push({ ...local.course_greens.at(-1)!, middle_lat: 0 });

    const changed = changedRows(server, local);
    expect(changed.players).toEqual([added]);
    expect(changed.course_greens).toEqual([local.course_greens.at(-1)]);
  });

  it('ignores columns only the server has', () => {
    const local = demoRows();
    const server = structuredClone(local);
    server.groups = server.groups.map((row) => ({ ...row, owner_id: 'someone' }));
    expect(changedRows(server, local).groups).toEqual([]);
  });
});

describe('splitByOwner', () => {
  const me = 'owner-me';
  const ann = 'owner-ann';
  /** The guest's phone after merging Ann's day: its own season, and her outing with one cell changed. */
  function phone() {
    const own = demoRows();
    const hers = demoRows();
    // Ann's rows, as the shared pull returns them: with her as owner, under ids of her own.
    const shared = emptySnapshot();
    shared.groups = hers.groups.slice(0, 1).map((row) => ({ ...row, id: `ann-${row.id}`, owner_id: ann }));
    shared.rounds = hers.rounds.slice(0, 1).map((row) => ({ ...row, id: 'ann-round', owner_id: ann }));
    shared.scores = hers.scores
      .filter((row) => row.round_id === hers.rounds[0].id)
      .slice(0, 3)
      .map((row) => ({ ...row, round_id: 'ann-round', owner_id: ann }));
    /** As the phone holds them: rows carry no owner. */
    const strip = <T,>(rows: T[]): T[] =>
      rows.map((row) => {
        const { owner_id: _owner, ...rest } = row as T & { owner_id?: unknown };
        return rest as T;
      });
    const local = structuredClone(own);
    local.groups.push(...strip(shared.groups));
    local.rounds.push(...strip(shared.rounds));
    const cells = strip(shared.scores);
    cells[0] = { ...cells[0], strokes: 9 };
    local.scores.push(...cells);
    return { own, shared, local, changed: cells[0] };
  }

  it('keeps every row this account owns or is adding, and none of someone else\'s day', () => {
    const { own, shared, local } = phone();
    const split = splitByOwner(local, shared, me);
    expect(split.own).toEqual(own);
  });

  it('sends only the cells of their card this phone changed, and only from the tables a guest may write', () => {
    const { shared, local, changed } = phone();
    const { guest } = splitByOwner(local, shared, me);
    expect(guest.scores).toEqual([changed]);
    expect(TABLES.filter((t) => guest[t].length > 0)).toEqual(['scores']);
    expect([...GUEST_WRITES]).toEqual(['scores', 'junk']);
  });

  it('treats rows the shared pull says are this account\'s own as its own: the organiser\'s own day', () => {
    const { shared, local } = phone();
    const mine = { ...shared, groups: shared.groups.map((row) => ({ ...row, owner_id: me })) };
    expect(splitByOwner(local, mine, me).own.groups.map((g) => g.id)).toContain(shared.groups[0].id);
  });
});

describe('isEmpty', () => {
  it('is true for a fresh install', () => {
    expect(isEmpty(emptySnapshot())).toBe(true);
  });

  it('is false once there is anything worth keeping', () => {
    expect(isEmpty(demoRows())).toBe(false);
  });

  it('is true for a phone holding only a bag, which must not prune a season', () => {
    expect(isEmpty({ ...emptySnapshot(), clubs: [{ id: 'k1', name: 'Driver', carry_yards: 240, position: 0 }] })).toBe(true);
  });

  it('is false for a phone holding only a course', () => {
    const snapshot = emptySnapshot();
    snapshot.courses.push({ id: 'c', name: 'Pine Hollow', created_at: 1 });
    expect(isEmpty(snapshot)).toBe(false);
  });
});
