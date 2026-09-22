import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { authErrorMessage, normaliseEmail } from '../auth/validate';
import type { Mutation, RemoteChanges, SyncTransport } from './types';

/**
 * Supabase wiring.
 *
 * Absent configuration the app is simply local-only — there is no degraded
 * mode to explain, the multiplayer screens just say it is not set up. That
 * matters because a single-phone round is still the common case.
 */
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export function isSupabaseConfigured(): boolean {
  return SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        storage: AsyncStorage,
        // A phone in a cart should stay signed in across app restarts, and
        // there is no browser to parse a redirect URL from.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    });
  }
  return client;
}

/**
 * Who this phone is signed in as, or null.
 *
 * Reads the session Supabase has already persisted to AsyncStorage rather than
 * asking the server, so it answers on the back nine with no signal. An access
 * token that has expired still identifies whose phone this is, which is all
 * the local half of the app needs.
 */
export async function currentUserId(): Promise<string | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/** The id a server write is attributed to. Refuses rather than guessing. */
export async function requireUserId(): Promise<string> {
  const id = await currentUserId();
  if (!id) throw new Error('Sign in to share an outing.');
  return id;
}

export interface SignUpResult {
  /** True when the project still wants the address confirmed by email. */
  needsConfirmation: boolean;
}

export async function signUpWithPassword(email: string, password: string): Promise<SignUpResult> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('This build has no server configured.');
  const { data, error } = await supabase.auth.signUp({
    email: normaliseEmail(email),
    password,
  });
  if (error) throw new Error(authErrorMessage(error.message));
  // With confirmation off a session comes back straight away; with it on there
  // is no session until the link in the email is followed.
  return { needsConfirmation: data.session == null };
}

export async function signInWithPassword(email: string, password: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('This build has no server configured.');
  const { error } = await supabase.auth.signInWithPassword({
    email: normaliseEmail(email),
    password,
  });
  if (error) throw new Error(authErrorMessage(error.message));
}

export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  // `local` clears this device without needing the network to agree, which
  // matters because signing out should never hang on a dead connection.
  await supabase.auth.signOut({ scope: 'local' });
}

/** Unambiguous alphabet: no O/0, no I/1. People read these out loud. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeJoinCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 6; i++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

export interface HostedOuting {
  outingId: string;
  joinCode: string;
}

/** Publishes an outing so other phones can join it. */
export async function hostOuting(
  outingId: string,
  name: string,
  course: unknown,
  payload: unknown,
): Promise<HostedOuting> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Multiplayer is not set up on this build.');
  const userId = await requireUserId();
  const joinCode = makeJoinCode();

  const { error } = await supabase
    .from('outings')
    .insert({ id: outingId, join_code: joinCode, name, course, payload });
  if (error) throw error;

  const { error: memberError } = await supabase
    .from('outing_members')
    .insert({ outing_id: outingId, user_id: userId, role: 'organiser' });
  if (memberError) throw memberError;

  return { outingId, joinCode };
}

/** Joins an outing by code, returning the stored outing document. */
export async function joinOuting(
  code: string,
  asPlayer: string | null,
  displayName: string | null,
): Promise<{ outingId: string; payload: unknown; course: unknown; name: string }> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('Multiplayer is not set up on this build.');
  await requireUserId();

  const { data: outingId, error } = await supabase.rpc('join_outing', {
    code: code.trim().toUpperCase(),
    as_player: asPlayer,
    display: displayName,
  });
  if (error) throw error;

  const { data, error: readError } = await supabase
    .from('outings')
    .select('id, name, course, payload')
    .eq('id', outingId)
    .single();
  if (readError) throw readError;

  return { outingId: data.id, payload: data.payload, course: data.course, name: data.name };
}

interface MutationRow {
  seq: number;
  id: string;
  outing_id: string;
  round_id: string | null;
  kind: string;
  key: string;
  value: unknown;
  at: number;
  device_id: string;
  author_id: string | null;
}

function toMutation(row: MutationRow): Mutation {
  return {
    id: row.id,
    kind: row.kind as Mutation['kind'],
    roundId: row.round_id,
    outingId: row.outing_id,
    key: row.key,
    value: row.value,
    at: Number(row.at),
    deviceId: row.device_id,
    authorId: row.author_id,
  };
}

/** The real wire. Same interface the fake transport implements for tests. */
export class SupabaseTransport implements SyncTransport {
  readonly name = 'supabase';

  async push(outingId: string, mutations: Mutation[]): Promise<void> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('offline');
    const rows = mutations.map((m) => ({
      id: m.id,
      outing_id: outingId,
      round_id: m.roundId,
      kind: m.kind,
      key: m.key,
      value: m.value,
      at: m.at,
      device_id: m.deviceId,
      author_id: m.authorId,
    }));
    // A retry after a timeout the server actually handled must not duplicate
    // the edit, so a clash on (outing_id, id) is a success, not a failure.
    const { error } = await supabase
      .from('mutations')
      .upsert(rows, { onConflict: 'outing_id,id', ignoreDuplicates: true });
    if (error) throw error;
  }

  async pull(outingId: string, cursor: string | null): Promise<RemoteChanges> {
    const supabase = getSupabase();
    if (!supabase) throw new Error('offline');
    const { data, error } = await supabase
      .from('mutations')
      .select('seq, id, outing_id, round_id, kind, key, value, at, device_id, author_id')
      .eq('outing_id', outingId)
      .gt('seq', cursor ? Number(cursor) : 0)
      .order('seq', { ascending: true })
      .limit(1000);
    if (error) throw error;

    const rows = (data ?? []) as MutationRow[];
    return {
      mutations: rows.map(toMutation),
      // Hold the old cursor when nothing came back, so an empty pull does not
      // rewind us to the start of the log.
      cursor: rows.length ? String(rows[rows.length - 1].seq) : cursor,
    };
  }

  subscribe(outingId: string, onChange: (changes: RemoteChanges) => void): () => void {
    const supabase = getSupabase();
    if (!supabase) return () => {};
    const channel = supabase
      .channel(`outing:${outingId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'mutations', filter: `outing_id=eq.${outingId}` },
        (message) => {
          const row = message.new as MutationRow;
          onChange({ mutations: [toMutation(row)], cursor: String(row.seq) });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }
}
