import type { Mutation } from '../types';

const mockCreateClient = jest.fn();
const mockCreateUrl = jest.fn(() => 'press://');

jest.mock('@supabase/supabase-js', () => ({
  createClient: mockCreateClient,
}));
jest.mock('expo-linking', () => ({ createURL: mockCreateUrl }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() },
}));

type Result = { data?: unknown; error?: unknown };

function query(result: Result = { data: null, error: null }) {
  const value: Record<string, jest.Mock> & { then?: Promise<Result>['then'] } = {};
  for (const method of ['select', 'eq', 'gt', 'order', 'limit', 'update', 'upsert', 'delete', 'in']) {
    value[method] = jest.fn(() => value);
  }
  value.maybeSingle = jest.fn().mockResolvedValue(result);
  value.then = (resolve, reject) => Promise.resolve(result).then(resolve, reject);
  return value;
}

function client(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
      signUp: jest.fn().mockResolvedValue({ data: { session: null }, error: null }),
      resend: jest.fn().mockResolvedValue({ error: null }),
      signInWithPassword: jest.fn().mockResolvedValue({ error: null }),
      signOut: jest.fn().mockResolvedValue({ error: null }),
    },
    from: jest.fn(() => query()),
    rpc: jest.fn().mockResolvedValue({ data: 'outing-1', error: null }),
    channel: jest.fn(),
    removeChannel: jest.fn(),
    ...overrides,
  };
}

function load(configured = true): typeof import('../supabase') {
  jest.resetModules();
  process.env.EXPO_PUBLIC_SUPABASE_URL = configured ? 'https://example.supabase.co' : '';
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = configured ? 'anon' : '';
  return require('../supabase') as typeof import('../supabase');
}

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateUrl.mockReturnValue('press://');
});

afterAll(() => {
  delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
});

describe('Supabase client and authentication helpers', () => {
  it('stays local-only without both configuration values', async () => {
    const api = await load(false);
    expect(api.isSupabaseConfigured()).toBe(false);
    expect(api.getSupabase()).toBeNull();
    await expect(api.currentUserId()).resolves.toBeNull();
    await expect(api.requireUserId()).rejects.toThrow('Sign in');
    await expect(api.signUpWithPassword('a@b.com', 'password')).rejects.toThrow('no server');
    await expect(api.resendConfirmation('a@b.com')).rejects.toThrow('no server');
    await expect(api.signInWithPassword('a@b.com', 'password')).rejects.toThrow('no server');
    await expect(api.signOut()).resolves.toBeUndefined();
  });

  it('constructs and caches the configured client with native auth storage', async () => {
    const fake = client();
    mockCreateClient.mockReturnValue(fake as never);
    const api = await load();

    expect(api.isSupabaseConfigured()).toBe(true);
    expect(api.getSupabase()).toBe(fake);
    expect(api.getSupabase()).toBe(fake);
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockCreateClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'anon',
      expect.objectContaining({ auth: expect.objectContaining({ persistSession: true, detectSessionInUrl: false }) }),
    );
  });

  it('reads identity from the stored session and refuses absent identity', async () => {
    const fake = client();
    mockCreateClient.mockReturnValue(fake as never);
    const api = await load();
    fake.auth.getSession.mockResolvedValueOnce({ data: { session: { user: { id: 'user-1' } } } });
    await expect(api.currentUserId()).resolves.toBe('user-1');
    fake.auth.getSession.mockResolvedValueOnce({ data: { session: null } });
    await expect(api.requireUserId()).rejects.toThrow('Sign in');
  });

  it('signs up, confirms, signs in, resends, and signs out with normalized addresses', async () => {
    const fake = client();
    mockCreateClient.mockReturnValue(fake as never);
    const api = await load();

    await expect(api.signUpWithPassword(' TEST@Example.COM ', 'long-password')).resolves.toEqual({
      needsConfirmation: true,
    });
    fake.auth.signUp.mockResolvedValueOnce({ data: { session: { user: { id: 'u' } } }, error: null });
    await expect(api.signUpWithPassword('a@b.com', 'long-password')).resolves.toEqual({ needsConfirmation: false });
    expect(fake.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'test@example.com', options: { emailRedirectTo: 'press://' } }),
    );
    expect(mockCreateUrl).toHaveBeenCalledWith('/');

    await api.resendConfirmation(' TEST@Example.COM ');
    await api.signInWithPassword(' TEST@Example.COM ', 'long-password');
    await api.signOut();
    expect(fake.auth.resend).toHaveBeenCalledWith(expect.objectContaining({ email: 'test@example.com' }));
    expect(fake.auth.signInWithPassword).toHaveBeenCalledWith({ email: 'test@example.com', password: 'long-password' });
    expect(fake.auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });

  it.each([
    ['sign up', 'signUp'],
    ['resend', 'resend'],
    ['sign in', 'signInWithPassword'],
  ])('maps a %s server error', async (_label, method) => {
    const fake = client();
    fake.auth[method as keyof typeof fake.auth].mockResolvedValueOnce({
      data: { session: null },
      error: { message: 'Invalid login credentials' },
    });
    mockCreateClient.mockReturnValue(fake as never);
    const api = await load();
    const call =
      method === 'signUp'
        ? api.signUpWithPassword('a@b.com', 'password')
        : method === 'resend'
          ? api.resendConfirmation('a@b.com')
          : api.signInWithPassword('a@b.com', 'password');
    await expect(call).rejects.toThrow(/.+/);
  });
});

describe('outing sharing', () => {
  it('generates unambiguous six-character join codes', async () => {
    const api = await load(false);
    expect(api.makeJoinCode(() => 0)).toBe('AAAAAA');
    expect(api.makeJoinCode(() => 0.999999)).toBe('999999');
  });

  it('returns an existing code and enrolls the organiser', async () => {
    const read = query({ data: { join_code: 'ABC234' }, error: null });
    const member = query({ error: null });
    const fake = client({
      auth: { ...client().auth, getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
      from: jest.fn().mockReturnValueOnce(read).mockReturnValueOnce(member),
    });
    mockCreateClient.mockReturnValue(fake as never);
    const api = await load();

    await expect(api.hostOuting('outing-1')).resolves.toEqual({ outingId: 'outing-1', joinCode: 'ABC234' });
    expect(member.upsert).toHaveBeenCalledWith(
      { outing_id: 'outing-1', user_id: 'u1', role: 'organiser' },
      { onConflict: 'outing_id,user_id' },
    );
  });

  it('adds a new code before enrolling the organiser', async () => {
    const read = query({ data: { join_code: null }, error: null });
    const update = query({ error: null });
    const member = query({ error: null });
    const auth = { ...client().auth, getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) };
    const fake = client({ auth, from: jest.fn().mockReturnValueOnce(read).mockReturnValueOnce(update).mockReturnValueOnce(member) });
    mockCreateClient.mockReturnValue(fake as never);
    const api = await load();

    const hosted = await api.hostOuting('outing-1');
    expect(hosted.joinCode).toHaveLength(6);
    expect(update.update).toHaveBeenCalledWith({ join_code: hosted.joinCode });
  });

  it.each([
    [{ data: null, error: { message: 'read failed' } }, 'read failed'],
    [{ data: null, error: null }, 'not reached'],
  ])('rejects an unreadable or absent outing', async (result, message) => {
    const fake = client({
      auth: { ...client().auth, getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) },
      from: jest.fn(() => query(result)),
    });
    mockCreateClient.mockReturnValue(fake as never);
    const api = await load();
    await expect(api.hostOuting('missing')).rejects.toThrow(message);
  });

  it('surfaces code-update and membership failures', async () => {
    const auth = { ...client().auth, getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) };
    const updateFailure = client({
      auth,
      from: jest
        .fn()
        .mockReturnValueOnce(query({ data: { join_code: null }, error: null }))
        .mockReturnValueOnce(query({ error: { message: 'update failed' } })),
    });
    mockCreateClient.mockReturnValue(updateFailure as never);
    let api = await load();
    await expect(api.hostOuting('outing')).rejects.toThrow('update failed');

    const memberFailure = client({
      auth,
      from: jest
        .fn()
        .mockReturnValueOnce(query({ data: { join_code: 'CODE22' }, error: null }))
        .mockReturnValueOnce(query({ error: { message: 'member failed' } })),
    });
    mockCreateClient.mockReturnValue(memberFailure as never);
    api = await load();
    await expect(api.hostOuting('outing')).rejects.toThrow('member failed');
  });

  it('normalizes a join request and rejects RPC errors or missing outings', async () => {
    const auth = { ...client().auth, getSession: jest.fn().mockResolvedValue({ data: { session: { user: { id: 'u1' } } } }) };
    const fake = client({ auth });
    mockCreateClient.mockReturnValue(fake as never);
    const api = await load();
    await expect(api.joinOuting(' ab-c23 ', null, 'Jerry')).resolves.toEqual({ outingId: 'outing-1' });
    expect(fake.rpc).toHaveBeenCalledWith('join_outing', { code: 'AB-C23', as_player: null, display: 'Jerry' });

    fake.rpc.mockResolvedValueOnce({ data: null, error: { message: 'rpc failed' } });
    await expect(api.joinOuting('code', 'p1', null)).rejects.toThrow('rpc failed');
    fake.rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(api.joinOuting('code', 'p1', null)).rejects.toThrow('No outing');
  });
});

describe('SupabaseTransport', () => {
  const mutation: Mutation = {
    id: 'm1',
    kind: 'score',
    roundId: 'r1',
    outingId: 'o1',
    key: 'p1:0',
    value: 4,
    at: 10,
    deviceId: 'd1',
    authorId: 'u1',
  };

  it('pushes mutations idempotently and surfaces write errors', async () => {
    const write = query({ error: null });
    const fake = client({ from: jest.fn(() => write) });
    mockCreateClient.mockReturnValue(fake as never);
    const api = await load();
    const transport = new api.SupabaseTransport();
    await transport.push('o1', [mutation]);
    expect(write.upsert).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'm1', outing_id: 'o1', round_id: 'r1' })],
      { onConflict: 'outing_id,id', ignoreDuplicates: true },
    );

    write.then = (resolve, reject) => Promise.resolve({ error: new Error('write') }).then(resolve, reject);
    await expect(transport.push('o1', [mutation])).rejects.toThrow('write');
  });

  it('pulls mapped rows, advances or preserves the cursor, and surfaces errors', async () => {
    const row = {
      seq: 4,
      id: 'm1',
      outing_id: 'o1',
      round_id: null,
      kind: 'outing',
      key: 'name',
      value: 'Cup',
      at: 5,
      device_id: 'd1',
      author_id: null,
    };
    const read = query({ data: [row], error: null });
    const fake = client({ from: jest.fn(() => read) });
    mockCreateClient.mockReturnValue(fake as never);
    const api = await load();
    const transport = new api.SupabaseTransport();
    await expect(transport.pull('o1', null)).resolves.toEqual({
      mutations: [expect.objectContaining({ id: 'm1', at: 5, outingId: 'o1' })],
      cursor: '4',
    });
    expect(read.gt).toHaveBeenCalledWith('seq', 0);

    read.then = (resolve, reject) => Promise.resolve({ data: null, error: null }).then(resolve, reject);
    await expect(transport.pull('o1', '4')).resolves.toEqual({ mutations: [], cursor: '4' });
    read.then = (resolve, reject) => Promise.resolve({ error: new Error('read') }).then(resolve, reject);
    await expect(transport.pull('o1', '4')).rejects.toThrow('read');
  });

  it('subscribes, maps inserts, and removes the channel', async () => {
    let listener: ((message: { new: Record<string, unknown> }) => void) | undefined;
    const channel: { on: jest.Mock; subscribe: jest.Mock } = {
      on: jest.fn(),
      subscribe: jest.fn(),
    };
    channel.on.mockImplementation((_event, _filter, callback) => {
      listener = callback;
      return channel;
    });
    channel.subscribe.mockImplementation(() => channel);
    const fake = client({ channel: jest.fn(() => channel), removeChannel: jest.fn() });
    mockCreateClient.mockReturnValue(fake as never);
    const api = await load();
    const onChange = jest.fn();
    const unsubscribe = new api.SupabaseTransport().subscribe('o1', onChange);
    listener?.({
      new: {
        seq: 7,
        id: 'm',
        outing_id: 'o1',
        round_id: null,
        kind: 'outing',
        key: 'name',
        value: 'Cup',
        at: 1,
        device_id: 'd',
        author_id: null,
      },
    });
    expect(onChange).toHaveBeenCalledWith({ mutations: [expect.objectContaining({ id: 'm' })], cursor: '7' });
    unsubscribe();
    expect(fake.removeChannel).toHaveBeenCalledWith(channel);
  });

  it('fails transport operations and no-ops subscriptions without configuration', async () => {
    const api = await load(false);
    const transport = new api.SupabaseTransport();
    await expect(transport.push('o', [])).rejects.toThrow('offline');
    await expect(transport.pull('o', null)).rejects.toThrow('offline');
    expect(transport.subscribe('o', jest.fn())).toEqual(expect.any(Function));
  });
});
