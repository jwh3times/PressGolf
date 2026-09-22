import { buildDemoDataset } from '../../demo/seed';
import { countDeletions, deletions, identify, isEmpty, KEYS } from '../diff';
import { emptySnapshot, toRows, TABLES, type Documents, type Snapshot } from '../rows';

function demoRows(): Snapshot {
  const data = buildDemoDataset(1_700_000_000_000);
  const documents: Documents = {
    groups: data.groups,
    courses: data.courses,
    rounds: data.rounds,
    outings: data.outings,
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

describe('isEmpty', () => {
  it('is true for a fresh install', () => {
    expect(isEmpty(emptySnapshot())).toBe(true);
  });

  it('is false once there is anything worth keeping', () => {
    expect(isEmpty(demoRows())).toBe(false);
  });

  it('is false for a phone holding only a course', () => {
    const snapshot = emptySnapshot();
    snapshot.courses.push({ id: 'c', name: 'Pine Hollow', created_at: 1 });
    expect(isEmpty(snapshot)).toBe(false);
  });
});
