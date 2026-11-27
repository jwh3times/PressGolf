import { getSupabase, requireUserId } from '../supabase';
import { approveSuggestion, declineSuggestion, editCourse, isAdmin, mySuggestions, waitingSuggestions } from '../suggestions';

jest.mock('../supabase', () => ({ getSupabase: jest.fn(), requireUserId: jest.fn() }));

const mockGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>;
const row = {
  id: 's1',
  course_id: 'c1',
  changes: [{ kind: 'course', field: 'name', from: 'A', to: 'B' }],
  status: 'waiting',
  reason: null,
  conflict: null,
  created_at: '2026-11-27T00:00:00Z',
};

/** A client whose rpc and table reads answer with `result`, recording what they were asked. */
function client(result: { data?: unknown; error?: { message: string } | null }) {
  const query: Record<string, jest.Mock> & { then?: unknown } = {};
  for (const method of ['select', 'eq', 'order']) query[method] = jest.fn(() => query);
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  const fake = { rpc: jest.fn(() => Promise.resolve(result)), from: jest.fn(() => query), query };
  mockGetSupabase.mockReturnValue(fake as never);
  return fake;
}

beforeEach(() => {
  jest.clearAllMocks();
  (requireUserId as jest.Mock).mockResolvedValue('me');
});

describe('suggested changes, through the server (#381)', () => {
  it('needs a server', async () => {
    mockGetSupabase.mockReturnValue(null);
    await expect(isAdmin()).rejects.toThrow('no server');
  });

  it('sends changes to edit_course and reads back how they were taken', async () => {
    const fake = client({ data: { applied: 1, suggestion: 's1' }, error: null });
    const changes = [{ kind: 'course' as const, field: 'name' as const, from: 'A', to: 'B' }];
    await expect(editCourse('c1', changes)).resolves.toEqual({ applied: 1, suggestion: 's1' });
    expect(fake.rpc).toHaveBeenCalledWith('edit_course', { target: 'c1', changes });
  });

  it('reads the admin role, and answers no for anything but a yes', async () => {
    client({ data: true, error: null });
    await expect(isAdmin()).resolves.toBe(true);
    client({ data: null, error: null });
    await expect(isAdmin()).resolves.toBe(false);
  });

  it("reads this account's own suggestions on a course, and every waiting one", async () => {
    const fake = client({ data: [row], error: null });
    const expected = [{ id: 's1', courseId: 'c1', changes: row.changes, status: 'waiting', reason: null, conflict: null, createdAt: row.created_at }];
    await expect(mySuggestions('c1')).resolves.toEqual(expected);
    expect(fake.query.eq).toHaveBeenCalledWith('owner_id', 'me');
    expect(fake.query.eq).toHaveBeenCalledWith('course_id', 'c1');
    await expect(waitingSuggestions()).resolves.toEqual(expected);
    expect(fake.query.eq).toHaveBeenCalledWith('status', 'waiting');
    client({ data: null, error: null });
    await expect(mySuggestions()).resolves.toEqual([]);
    await expect(waitingSuggestions()).resolves.toEqual([]);
  });

  it('approves and declines through their functions', async () => {
    const fake = client({ data: { status: 'conflict' }, error: null });
    await expect(approveSuggestion('s1')).resolves.toBe('conflict');
    expect(fake.rpc).toHaveBeenCalledWith('approve_suggestion', { target: 's1' });
    await expect(declineSuggestion('s1', 'No.')).resolves.toBeUndefined();
    expect(fake.rpc).toHaveBeenCalledWith('decline_suggestion', { target: 's1', why: 'No.' });
  });

  it("passes on the server's refusal", async () => {
    client({ data: null, error: { message: 'only the admin approves a suggestion' } });
    await expect(approveSuggestion('s1')).rejects.toThrow('only the admin approves a suggestion');
    await expect(declineSuggestion('s1', 'No.')).rejects.toThrow('only the admin');
    await expect(editCourse('c1', [])).rejects.toThrow('only the admin');
    await expect(isAdmin()).rejects.toThrow('only the admin');
    await expect(mySuggestions()).rejects.toThrow('only the admin');
    await expect(waitingSuggestions()).rejects.toThrow('only the admin');
  });
});
