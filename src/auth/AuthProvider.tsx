import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  getSupabase,
  signInWithPassword,
  signOut as signOutRemote,
  signUpWithPassword,
  type SignUpResult,
} from '../sync/supabase';

export type AuthStatus =
  /** No server on this build, so there is nobody to be. The app is local-only. */
  | 'disabled'
  /** Still reading the stored session. */
  | 'loading'
  | 'signed-out'
  | 'signed-in';

/**
 * Remembers that this phone has signed in at least once.
 *
 * The gate cannot depend on reaching the server. A round starts in a car park
 * with no signal often enough that refreshing an expired token will sometimes
 * fail, and being locked out of your own scorecard because of that would be
 * the worst possible failure for an app whose whole point is working offline.
 * So a phone that has signed in before is let in, and the server still refuses
 * anything it should refuse — row-level security does not care what the app
 * decided to render.
 */
const REMEMBERED_KEY = 'press:auth:remembered-email';

/** How long to wait on the stored session before falling back to what we remember. */
const SESSION_READ_TIMEOUT_MS = 4000;

interface AuthValue {
  status: AuthStatus;
  email: string | null;
  userId: string | null;
  /** True when we let this phone in on a remembered sign-in we could not re-check. */
  unverified: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => getSupabase(), []);
  const [status, setStatus] = useState<AuthStatus>(supabase ? 'loading' : 'disabled');
  const [email, setEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);

  const adopt = useCallback((session: Session) => {
    setUserId(session.user.id);
    setEmail(session.user.email ?? null);
    setUnverified(false);
    setStatus('signed-in');
    if (session.user.email) {
      void AsyncStorage.setItem(REMEMBERED_KEY, session.user.email).catch(() => {});
    }
  }, []);

  const forget = useCallback(() => {
    setUserId(null);
    setEmail(null);
    setUnverified(false);
    setStatus('signed-out');
    void AsyncStorage.removeItem(REMEMBERED_KEY).catch(() => {});
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;

    void (async () => {
      let session: Session | null = null;
      try {
        // getSession may try to refresh an expired token, and a refresh with no
        // route to the server can sit there. Nothing below is worth holding the
        // splash screen for, so it loses the race and we use what we remember.
        session = await Promise.race([
          supabase.auth.getSession().then(({ data }) => data.session ?? null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), SESSION_READ_TIMEOUT_MS)),
        ]);
      } catch {
        // Offline, or the refresh failed. Fall through to the remembered grant.
        session = null;
      }
      if (!alive) return;
      if (session) {
        adopt(session);
        return;
      }
      let remembered: string | null = null;
      try {
        remembered = await AsyncStorage.getItem(REMEMBERED_KEY);
      } catch {
        remembered = null;
      }
      if (!alive) return;
      if (remembered) {
        setEmail(remembered);
        setUnverified(true);
        setStatus('signed-in');
      } else {
        setStatus('signed-out');
      }
    })();

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      if (session) {
        adopt(session);
        return;
      }
      // Only an explicit sign-out clears the grant. INITIAL_SESSION with no
      // session, or a refresh that failed because there is no signal, must not
      // throw somebody out mid-round.
      if (event === 'SIGNED_OUT') forget();
    });

    return () => {
      alive = false;
      subscription.subscription.unsubscribe();
    };
  }, [supabase, adopt, forget]);

  const signIn = useCallback(async (address: string, password: string) => {
    await signInWithPassword(address, password);
  }, []);

  const signUp = useCallback(
    async (address: string, password: string) => signUpWithPassword(address, password),
    [],
  );

  const signOut = useCallback(async () => {
    await signOutRemote();
    forget();
  }, [forget]);

  const value = useMemo<AuthValue>(
    () => ({ status, email, userId, unverified, signIn, signUp, signOut }),
    [status, email, userId, unverified, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
