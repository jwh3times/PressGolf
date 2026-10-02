import { emptySnapshot, TABLES, type Snapshot } from '../rows';
import { getSupabase, requireUserId } from '../supabase';
import { pullSharedOutings, pullSnapshot, pushSnapshot, reconcile } from '../remote';

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
    await expect(reconcile(emptySnapshot())).resolves.toEqual({ status: 'nothing-to-do' });
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
    await expect(reconcile(local)).resolves.toEqual({ status: 'pushed', upserted: 1, deleted: 1 });
  });
});
