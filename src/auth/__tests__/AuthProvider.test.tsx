import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import {
  getSupabase,
  signInWithPassword,
  signOut as signOutRemote,
  signUpWithPassword,
} from '../../sync/supabase';
import { AuthProvider, useAuth, type AuthStatus } from '../AuthProvider';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));
jest.mock('../../sync/supabase', () => ({
  getSupabase: jest.fn(),
  signInWithPassword: jest.fn(),
  signOut: jest.fn(),
  signUpWithPassword: jest.fn(),
}));

const storage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;
const mockGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>;
const mockSignIn = signInWithPassword as jest.MockedFunction<typeof signInWithPassword>;
const mockSignUp = signUpWithPassword as jest.MockedFunction<typeof signUpWithPassword>;
const mockSignOut = signOutRemote as jest.MockedFunction<typeof signOutRemote>;

let auth: ReturnType<typeof useAuth>;

function Probe() {
  const value = useAuth();
  React.useEffect(() => {
    auth = value;
  }, [value]);
  return null;
}

function session(id = 'user-1', email: string | undefined = 'golfer@example.com') {
  return { user: { id, email } };
}

function configured(initial: unknown = session()) {
  let listener: ((event: string, value: unknown) => void) | undefined;
  const unsubscribe = jest.fn();
  const supabase = {
    auth: {
      getSession: jest.fn().mockResolvedValue({ data: { session: initial } }),
      onAuthStateChange: jest.fn((callback) => {
        listener = callback;
        return { data: { subscription: { unsubscribe } } };
      }),
    },
  };
  return { supabase, unsubscribe, emit: (event: string, value: unknown) => listener?.(event, value) };
}

beforeEach(() => {
  jest.clearAllMocks();
  storage.getItem.mockResolvedValue(null);
  storage.setItem.mockResolvedValue();
  storage.removeItem.mockResolvedValue();
  mockSignIn.mockResolvedValue();
  mockSignUp.mockResolvedValue({ needsConfirmation: true });
  mockSignOut.mockResolvedValue();
});

describe('AuthProvider', () => {
  it('requires the provider', async () => {
    await expect(render(<Probe />)).rejects.toThrow('useAuth must be used inside AuthProvider');
  });

  it('is disabled when the build has no server', async () => {
    mockGetSupabase.mockReturnValue(null);
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(auth.status).toBe('disabled'));
  });

  it('adopts initial and changed sessions, including users without an email', async () => {
    const fake = configured();
    mockGetSupabase.mockReturnValue(fake.supabase as never);
    const view = await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(auth.status).toBe('signed-in'));
    expect(auth).toMatchObject({ userId: 'user-1', email: 'golfer@example.com', unverified: false });
    expect(storage.setItem).toHaveBeenCalledWith('press:auth:remembered-email', 'golfer@example.com');

    await act(async () => {
      fake.emit('TOKEN_REFRESHED', { user: { id: 'user-2' } });
      await Promise.resolve();
    });
    expect(auth).toMatchObject({ userId: 'user-2', email: null, unverified: false });
    expect(storage.setItem).toHaveBeenCalledTimes(1);

    await act(async () => {
      fake.emit('INITIAL_SESSION', null);
      await Promise.resolve();
    });
    expect(auth.status).toBe('signed-in');
    await act(async () => {
      fake.emit('SIGNED_OUT', null);
      await Promise.resolve();
    });
    expect(auth).toMatchObject({ status: 'signed-out', userId: null, email: null, unverified: false });
    expect(storage.removeItem).toHaveBeenCalledWith('press:auth:remembered-email');

    await view.unmount();
    expect(fake.unsubscribe).toHaveBeenCalled();
  });

  it.each([
    ['failed session', new Error('offline'), 'remembered@example.com', 'signed-in', true],
    ['no session', null, null, 'signed-out', false],
  ])('falls back after %s', async (_name, failure, remembered, expected, unverified) => {
    const fake = configured(null);
    if (failure) fake.supabase.auth.getSession.mockRejectedValueOnce(failure);
    storage.getItem.mockResolvedValueOnce(remembered);
    mockGetSupabase.mockReturnValue(fake.supabase as never);
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(auth.status).toBe(expected as AuthStatus));
    expect(auth.unverified).toBe(unverified);
    expect(auth.email).toBe(remembered);
  });

  it('survives unreadable remembered storage and rejected remember/forget writes', async () => {
    const fake = configured(null);
    storage.getItem.mockRejectedValueOnce(new Error('disk'));
    storage.setItem.mockRejectedValueOnce(new Error('disk'));
    storage.removeItem.mockRejectedValueOnce(new Error('disk'));
    mockGetSupabase.mockReturnValue(fake.supabase as never);
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(auth.status).toBe('signed-out'));
    await act(async () => {
      fake.emit('SIGNED_IN', session());
      await Promise.resolve();
    });
    await act(async () => {
      fake.emit('SIGNED_OUT', null);
      await Promise.resolve();
    });
    expect(auth.status).toBe('signed-out');
  });

  it('delegates sign-in, sign-up, and local sign-out', async () => {
    mockGetSupabase.mockReturnValue(null);
    await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(auth.status).toBe('disabled'));
    await act(async () => auth.signIn('a@b.com', 'password'));
    await act(async () => {
      await expect(auth.signUp('a@b.com', 'password')).resolves.toEqual({ needsConfirmation: true });
    });
    await act(async () => auth.signOut());
    expect(mockSignIn).toHaveBeenCalledWith('a@b.com', 'password');
    expect(mockSignUp).toHaveBeenCalledWith('a@b.com', 'password');
    expect(mockSignOut).toHaveBeenCalled();
    expect(auth.status).toBe('signed-out');
  });

  it('ignores an initial read that finishes after unmount', async () => {
    let resolve: ((value: unknown) => void) | undefined;
    const fake = configured(null);
    fake.supabase.auth.getSession.mockReturnValueOnce(new Promise((done) => (resolve = done)) as never);
    mockGetSupabase.mockReturnValue(fake.supabase as never);
    const view = await render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await view.unmount();
    await act(async () => {
      resolve?.({ data: { session: session() } });
      await Promise.resolve();
    });
    expect(storage.getItem).not.toHaveBeenCalled();
  });
});
