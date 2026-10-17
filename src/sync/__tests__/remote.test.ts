import { emptySnapshot, TABLES, type Snapshot } from '../rows';
import { getSupabase, requireUserId } from '../supabase';
import { pullSharedOutings, pullSnapshot, pushChanges, pushSnapshot, reconcile } from '../remote';

jest.mock('../supabase', () => ({ getSupabase: jest.fn(), requireUserId: jest.fn() }));

const mockGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>;
const mockRequireUserId = requireUserId as jest.MockedFunction<typeof requireUserId>;

type Result = { data?: unknown; error?: { message: string } | null };

/**
 * A chainable stand-in for a PostgREST query. Reads honour `.range()` and, like
 * the real server's `max_rows`, never return more than `cap` rows at once.
 */
function query(initial: Result = { data: [], error: null }, cap = 1000) {
  let result = initial;
  let range: [number, number] = [0, Infinity];
  const value: Record<string, jest.Mock> & { then?: Promise<Result>['then'] } = {};
  for (const method of ['select', 'eq', 'in', 'order']) value[method] = jest.fn(() => value);
  value.range = jest.fn((from: number, to: number) => {
    range = [from, to];
    return value;
  });
  value.upsert = jest.fn(() => {
    result = { error: null };
    return value;
  });
  value.delete = jest.fn(() => {
    result = { error: null };
    return value;
  });
  value.then = (resolve, reject) => {
    const [from, to] = range;
    const page = Array.isArray(result.data)
      ? { ...result, data: result.data.slice(from, Math.min(to + 1, from + cap)) }
      : result;
    return Promise.resolve(page).then(resolve, reject);
  };
  value.setResult = jest.fn((next: Result) => {
    result = next;
  });
  return value;
}

function snapshotWithGroup(): Snapshot {
  const snapshot = emptySnapshot();
  snapshot.groups.push({
    id: 'g1',
    name: 'Group',
    you_id: null,
    default_course_id: null,
    subtitle: '',
    created_at: 1,
  });
  return snapshot;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireUserId.mockResolvedValue('owner-1');
});

describe('pullSnapshot', () => {
  it('requires a configured server', async () => {
    mockGetSupabase.mockReturnValue(null);
    await expect(pullSnapshot()).rejects.toThrow('no server');
  });

  it('pulls every owned table and treats absent data as empty', async () => {
    const from = jest.fn((table: keyof Snapshot) =>
      query({
        data: table === 'groups' ? snapshotWithGroup().groups : table === 'players' ? null : [],
        error: null,
      }),
    );
    mockGetSupabase.mockReturnValue({ from } as never);

    const result = await pullSnapshot();

    expect(result.groups).toHaveLength(1);
    expect(result.players).toEqual([]);
    // One read per table, plus the empty page that ends the one table with rows.
    expect(from).toHaveBeenCalledTimes(TABLES.length + 1);
    expect(mockRequireUserId).toHaveBeenCalledTimes(1);
  });

  it('adds the table name to read failures', async () => {
    mockGetSupabase.mockReturnValue({
      from: jest.fn((table: string) => query({ data: null, error: table === 'tee_holes' ? { message: 'down' } : null })),
    } as never);
    await expect(pullSnapshot()).rejects.toThrow('tee_holes: down');
  });
});

describe('paging past the server row cap', () => {
  // Seven cells of a card against a server that hands out three rows at a time.
  const cells = Array.from({ length: 7 }, (_, hole) => ({ round_id: 'r1', player_id: 'p1', hole, strokes: 4 }));

  it('pulls every row of an owned table, however many requests it takes', async () => {
    const from = jest.fn((table: keyof Snapshot) => query({ data: table === 'scores' ? cells : [], error: null }, 3));
    mockGetSupabase.mockReturnValue({ from } as never);
    expect((await pullSnapshot()).scores).toEqual(cells);
  });

  it("pulls every row of a shared outing's tables too", async () => {
    const rows: Partial<Record<keyof Snapshot | 'outing_members', unknown[]>> = {
      outing_members: [{ outing_id: 'o1' }],
      outings: [{ id: 'o1', group_id: 'g1', course_id: 'c1' }],
      rounds: [{ id: 'r1', outing_id: 'o1' }],
      scores: cells,
    };
    const from = jest.fn((table: keyof Snapshot | 'outing_members') => query({ data: rows[table] ?? [], error: null }, 3));
    mockGetSupabase.mockReturnValue({ from } as never);
    expect((await pullSharedOutings()).scores).toEqual(cells);
  });
});

describe('pullSharedOutings', () => {
  it('requires configuration and membership', async () => {
    mockGetSupabase.mockReturnValue(null);
    await expect(pullSharedOutings()).rejects.toThrow('no server');

    mockGetSupabase.mockReturnValue({
      from: jest.fn(() => query({ error: { message: 'members failed' } })),
    } as never);
    await expect(pullSharedOutings()).rejects.toThrow('outing_members: members failed');
  });

  it('returns empty when the account has no shared outings', async () => {
    mockGetSupabase.mockReturnValue({ from: jest.fn(() => query({ data: null, error: null })) } as never);
    await expect(pullSharedOutings()).resolves.toEqual(emptySnapshot());
  });

  it('pulls the shared graph and skips queries whose foreign-key list is empty', async () => {
    const rows: Partial<Record<keyof Snapshot | 'outing_members', unknown[]>> = {
      outing_members: [{ outing_id: 'o1' }],
      outings: [{ id: 'o1', group_id: 'g1', course_id: 'c1' }],
      outing_field: [{ outing_id: 'o1', player_id: 'p1' }],
      rounds: [{ id: 'r1', outing_id: 'o1' }],
      players: [{ id: 'p1' }],
      groups: [{ id: 'g1' }],
      courses: [{ id: 'c1' }],
      tees: [{ id: 't1', course_id: 'c1' }],
      tee_holes: [{ tee_id: 't1', course_id: 'c1' }],
    };
    const from = jest.fn((table: keyof Snapshot | 'outing_members') => query({ data: rows[table] ?? [], error: null }));
    mockGetSupabase.mockReturnValue({ from } as never);

    const result = await pullSharedOutings();

    expect(result).toMatchObject({
      outings: [expect.objectContaining({ id: 'o1' })],
      rounds: [expect.objectContaining({ id: 'r1' })],
      players: [expect.objectContaining({ id: 'p1' })],
      tees: [expect.objectContaining({ id: 't1' })],
      tee_holes: [expect.objectContaining({ tee_id: 't1' })],
    });

    rows.outing_field = [];
    rows.outings = [];
    rows.rounds = [];
    from.mockClear();
    await pullSharedOutings();
    expect(from).not.toHaveBeenCalledWith('players');
    expect(from).not.toHaveBeenCalledWith('groups');
    expect(from).not.toHaveBeenCalledWith('courses');
  });

  it('names the shared table that failed', async () => {
    const from = jest.fn((table: string) =>
      query({
        data: table === 'outing_members' ? [{ outing_id: 'o1' }] : [],
        error: table === 'outing_field' ? { message: 'read failed' } : null,
      }),
    );
    mockGetSupabase.mockReturnValue({ from } as never);
    await expect(pullSharedOutings()).rejects.toThrow('outing_field: read failed');
  });
});

describe('pushSnapshot', () => {
  it('requires configuration and pushes parents before children', async () => {
    mockGetSupabase.mockReturnValue(null);
    await expect(pushSnapshot(emptySnapshot())).rejects.toThrow('no server');

    const writes = new Map<string, ReturnType<typeof query>>();
    const from = jest.fn((table: string) => {
      const builder = query();
      writes.set(table, builder);
      return builder;
    });
    mockGetSupabase.mockReturnValue({ from } as never);
    const local = snapshotWithGroup();
    await expect(pushSnapshot(local)).resolves.toEqual({ upserted: 1, deleted: 0 });
    expect(from).toHaveBeenCalledTimes(1);
    expect(writes.get('groups')?.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'g1', owner_id: 'owner-1' })],
      expect.any(Object),
    );
  });

  it('chunks large tables and reports table-specific write failures', async () => {
    const builders: ReturnType<typeof query>[] = [];
    mockGetSupabase.mockReturnValue({
      from: jest.fn(() => {
        const builder = query();
        builders.push(builder);
        return builder;
      }),
    } as never);
    const local = emptySnapshot();
    local.scores = Array.from({ length: 501 }, (_, index) => ({
      round_id: 'r',
      player_id: 'p',
      hole: index,
      strokes: null,
    }));
    await pushSnapshot(local);
    expect(builders).toHaveLength(2);
    expect(builders[0].upsert.mock.calls[0][0]).toHaveLength(500);
    expect(builders[1].upsert.mock.calls[0][0]).toHaveLength(1);

    const failed = query();
    failed.upsert.mockImplementation(() => {
      failed.setResult({ error: { message: 'write failed' } });
      return failed;
    });
    mockGetSupabase.mockReturnValue({ from: jest.fn(() => failed) } as never);
    await expect(pushSnapshot(snapshotWithGroup())).rejects.toThrow('groups: write failed');
  });

  it('prunes children before parents, counts deletions, and reports failures', async () => {
    const builders: ReturnType<typeof query>[] = [];
    mockGetSupabase.mockReturnValue({
      from: jest.fn(() => {
        const builder = query();
        builders.push(builder);
        return builder;
      }),
    } as never);
    const prune = Object.fromEntries(TABLES.map((table) => [table, []])) as unknown as Record<keyof Snapshot, Record<string, unknown>[]>;
    prune.groups = [{ id: 'g1' }];
    prune.scores = [{ round_id: 'r1', player_id: 'p1', hole: 0 }];
    await expect(pushSnapshot(emptySnapshot(), { prune })).resolves.toEqual({ upserted: 0, deleted: 2 });
    expect(builders[0].delete).toHaveBeenCalled();
    expect(builders[0].eq).toHaveBeenCalledTimes(3);

    const failed = query();
    failed.delete.mockImplementation(() => {
      failed.setResult({ error: { message: 'delete failed' } });
      return failed;
    });
    mockGetSupabase.mockReturnValue({ from: jest.fn(() => failed) } as never);
    await expect(pushSnapshot(emptySnapshot(), { prune })).rejects.toThrow('scores: delete failed');
  });
});

describe('reconcile', () => {
  function reconciliationClient(remote: Snapshot) {
    return {
      from: jest.fn((table: keyof Snapshot) => query({ data: remote[table], error: null })),
    };
  }

  it('does nothing when both sides are empty', async () => {
    mockGetSupabase.mockReturnValue(reconciliationClient(emptySnapshot()) as never);
    await expect(reconcile(emptySnapshot())).resolves.toEqual({ status: 'nothing-to-do', shared: emptySnapshot() });
  });

  it('adopts a non-empty remote on an empty phone', async () => {
    const remote = snapshotWithGroup();
    mockGetSupabase.mockReturnValue(reconciliationClient(remote) as never);
    await expect(reconcile(emptySnapshot())).resolves.toMatchObject({ status: 'adopted-remote', rows: 1, snapshot: remote });
  });

  it('pushes local data and prunes rows absent from the phone', async () => {
    const remote = snapshotWithGroup();
    remote.groups.push({ ...remote.groups[0], id: 'remove-me' });
    const local = snapshotWithGroup();
    const fake = reconciliationClient(remote);
    mockGetSupabase.mockReturnValue(fake as never);
    await expect(reconcile(local)).resolves.toEqual({ status: 'pushed', upserted: 1, deleted: 1, own: local, shared: emptySnapshot() });
  });

  it("knows a shared day's rows before pushing: sends the guest's card edit, and none of the organiser's day", async () => {
    // Ann's day, as the shared pull returns it, with owners.
    const ann = 'owner-ann';
    const tables: Partial<Record<keyof Snapshot | 'outing_members', Record<string, unknown>[]>> = {
      outing_members: [{ outing_id: 'o1' }],
      outings: [{ id: 'o1', group_id: 'g9', course_id: 'c9', owner_id: ann }],
      groups: [{ id: 'g9', name: 'Ann', owner_id: ann }],
      rounds: [{ id: 'r1', outing_id: 'o1', owner_id: ann }],
      scores: [
        { round_id: 'r1', player_id: 'p1', hole: 0, strokes: null, picked_up: false, owner_id: ann },
        { round_id: 'r1', player_id: 'p1', hole: 1, strokes: 4, picked_up: false, owner_id: ann },
      ],
    };
    const writes = new Map<string, ReturnType<typeof query>>();
    mockGetSupabase.mockReturnValue({
      from: jest.fn((table: keyof Snapshot | 'outing_members') => {
        const builder = query({ data: tables[table] ?? [], error: null });
        // The guest's own pull asks for its own rows, and Ann's day is none of them.
        builder.eq.mockImplementation((column: string, value: unknown) => {
          if (column === 'owner_id' && value !== ann) builder.setResult({ data: [], error: null });
          return builder;
        });
        // Pushes follow pulls, so a table's last builder is the one that wrote, if any did.
        writes.set(table, builder);
        return builder;
      }),
    } as never);

    // The guest's phone: its own group, Ann's day merged in, and one cell typed on her card.
    const local = snapshotWithGroup();
    local.outings.push({ id: 'o1', group_id: 'g9', course_id: 'c9' } as never);
    local.groups.push({ id: 'g9', name: 'Ann' } as never);
    local.rounds.push({ id: 'r1', outing_id: 'o1' } as never);
    local.scores.push(
      { round_id: 'r1', player_id: 'p1', hole: 0, strokes: 5, picked_up: false },
      { round_id: 'r1', player_id: 'p1', hole: 1, strokes: 4, picked_up: false },
    );

    const outcome = await reconcile(local);
    expect(outcome).toMatchObject({ status: 'pushed', upserted: 2 });
    expect(writes.get('groups')?.upsert).toHaveBeenCalledWith([expect.objectContaining({ id: 'g1', owner_id: 'owner-1' })], expect.any(Object));
    expect(writes.get('groups')?.upsert).toHaveBeenCalledTimes(1);
    expect(writes.get('outings')?.upsert).not.toHaveBeenCalled();
    expect(writes.get('rounds')?.upsert).not.toHaveBeenCalled();
    // The changed cell, with no owner: it stays Ann's. The unchanged one isn't sent.
    expect(writes.get('scores')?.upsert).toHaveBeenCalledWith(
      [{ round_id: 'r1', player_id: 'p1', hole: 0, strokes: 5, picked_up: false }],
      expect.any(Object),
    );
    expect(outcome.status === 'pushed' && outcome.own.groups.map((g) => g.id)).toEqual(['g1']);
  });
});

describe('reconcile, the bag', () => {
  const club = (id: string, position = 0) => ({ id, name: '7 iron', carry_yards: 150, position });

  /** The account as the server holds it, and every write and delete the phone sends. */
  function recording(remote: Snapshot) {
    const writes: { table: string; rows: Record<string, unknown>[] }[] = [];
    const deletes: string[] = [];
    mockGetSupabase.mockReturnValue({
      from: jest.fn((table: keyof Snapshot) => {
        const builder = query({ data: remote[table], error: null });
        builder.upsert.mockImplementation((rows: Record<string, unknown>[]) => {
          writes.push({ table, rows });
          return builder;
        });
        builder.delete.mockImplementation(() => {
          deletes.push(table);
          return builder;
        });
        return builder;
      }),
    } as never);
    return { writes, deletes };
  }

  it('keeps clubs typed on a fresh install that adopts a season with no bag', async () => {
    const remote = snapshotWithGroup();
    const local = { ...emptySnapshot(), clubs: [club('k1')] };
    const { writes, deletes } = recording(remote);
    const outcome = await reconcile(local);
    expect(writes).toEqual([{ table: 'clubs', rows: [{ ...club('k1'), owner_id: 'owner-1' }] }]);
    expect(deletes).toEqual([]);
    expect(outcome).toMatchObject({ status: 'adopted-remote', rows: 2, snapshot: { groups: remote.groups, clubs: [club('k1')] } });
  });

  it("takes the account's bag on a fresh install, over any typed on it", async () => {
    const remote = { ...snapshotWithGroup(), clubs: [club('k9')] };
    const { writes } = recording(remote);
    await expect(reconcile({ ...emptySnapshot(), clubs: [club('k1')] })).resolves.toMatchObject({ status: 'adopted-remote', snapshot: remote });
    expect(writes).toEqual([]);
  });

  it('takes a bag when the account holds nothing else', async () => {
    const remote = { ...emptySnapshot(), clubs: [club('k9')] };
    recording(remote);
    await expect(reconcile(emptySnapshot())).resolves.toMatchObject({ status: 'adopted-remote', rows: 1, snapshot: remote });
  });

  it("takes the account's bag on a phone with a season and no clubs, rather than deleting it", async () => {
    const remote = { ...snapshotWithGroup(), clubs: [club('k9')] };
    const { deletes } = recording(remote);
    const outcome = await reconcile(snapshotWithGroup());
    expect(deletes).toEqual([]);
    expect(outcome).toMatchObject({ status: 'pushed', deleted: 0, own: { clubs: remote.clubs }, clubs: remote.clubs });
  });

  it("puts a phone's own bag over the account's, and sends a bag with no season", async () => {
    const remote = { ...snapshotWithGroup(), clubs: [club('k9')] };
    const { deletes } = recording(remote);
    const outcome = await reconcile({ ...snapshotWithGroup(), clubs: [club('k1')] });
    expect(deletes).toEqual(['clubs']);
    expect(outcome).toMatchObject({ status: 'pushed', deleted: 1 });
    expect(outcome).not.toHaveProperty('clubs');

    const { writes } = recording(emptySnapshot());
    await expect(reconcile({ ...emptySnapshot(), clubs: [club('k1')] })).resolves.toMatchObject({ status: 'pushed' });
    expect(writes).toEqual([{ table: 'clubs', rows: [{ ...club('k1'), owner_id: 'owner-1' }] }]);
  });

  const settings = (usual_score: '70s' | '90s') => [{ id: 'bag' as const, usual_score }];

  it('keeps a usual score set on a fresh install that adopts a season without one', async () => {
    const remote = snapshotWithGroup();
    const { writes } = recording(remote);
    const outcome = await reconcile({ ...emptySnapshot(), bag_settings: settings('70s') });
    expect(writes).toEqual([{ table: 'bag_settings', rows: [{ id: 'bag', usual_score: '70s', owner_id: 'owner-1' }] }]);
    expect(outcome).toMatchObject({ status: 'adopted-remote', snapshot: { groups: remote.groups, bag_settings: settings('70s') } });
  });

  it("takes the account's usual score on a phone with a season and none, rather than deleting it", async () => {
    const remote = { ...snapshotWithGroup(), bag_settings: settings('90s') };
    const { deletes } = recording(remote);
    const outcome = await reconcile(snapshotWithGroup());
    expect(deletes).toEqual([]);
    expect(outcome).toMatchObject({ status: 'pushed', deleted: 0, bag_settings: settings('90s') });
    expect(outcome).not.toHaveProperty('clubs');
  });

  it('has nothing to do only when the phone has no usual score either', async () => {
    recording(emptySnapshot());
    await expect(reconcile({ ...emptySnapshot(), bag_settings: settings('70s') })).resolves.toMatchObject({ status: 'pushed' });
  });
});

describe('pushChanges', () => {
  it('sends what changed since the last push, prunes what went, and returns the own rows whole', async () => {
    const writes: { table: string; rows: unknown }[] = [];
    const deletes: string[] = [];
    mockGetSupabase.mockReturnValue({
      from: jest.fn((table: string) => {
        const builder = query();
        builder.upsert.mockImplementation((rows: unknown) => {
          writes.push({ table, rows });
          return builder;
        });
        builder.delete.mockImplementation(() => {
          deletes.push(table);
          return builder;
        });
        return builder;
      }),
    } as never);
    const server = snapshotWithGroup();
    server.groups.push({ ...server.groups[0], id: 'gone' });
    const local = snapshotWithGroup();
    local.groups.push({ ...local.groups[0], id: 'new' });

    const own = await pushChanges(local, server, emptySnapshot());
    expect(writes).toEqual([{ table: 'groups', rows: [expect.objectContaining({ id: 'new', owner_id: 'owner-1' })] }]);
    expect(deletes).toEqual(['groups']);
    expect(own).toEqual(local);
  });
});
