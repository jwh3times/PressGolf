/**
 * Moving the phone's data to Supabase and back.
 *
 * The phone stays the source of truth. This is not a request/response app:
 * every edit is already saved locally before anything here runs, and if the
 * push fails the round carries on exactly as it did before. Golf courses have
 * no signal on the back nine, and an app that needed the server to agree
 * before it would record a birdie would be useless on the holes that matter.
 *
 * What this gives you is durability — a phone in a lake stops being the end of
 * a season — and a second device.
 */
import { conflictTarget, countDeletions, deletions, isEmpty, type Deletions } from './diff';
import { countRows, emptySnapshot, TABLES, type Snapshot } from './rows';
import { getSupabase, requireUserId } from './supabase';

/** PostgREST will not take an unbounded insert; big cards go up in pieces. */
const CHUNK = 500;

function chunked<T>(rows: T[]): T[][] {
  if (rows.length <= CHUNK) return rows.length ? [rows] : [];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

/** Everything this account owns, as it currently stands on the server. */
export async function pullSnapshot(): Promise<Snapshot> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('This build has no server configured.');
  const ownerId = await requireUserId();

  const snapshot = emptySnapshot();
  for (const table of TABLES) {
    // Scoped to rows we own, deliberately, even though policy would also let
    // a shared outing's rows through. This snapshot is what pruning diffs
    // against, and a guest's scores are owned by the guest — pulling them here
    // would let one phone delete another's card the moment it fell behind.
    const { data, error } = await supabase.from(table).select('*').eq('owner_id', ownerId);
    if (error) throw new Error(`${table}: ${error.message}`);
    (snapshot[table] as unknown as Record<string, unknown>[]).push(
      ...((data ?? []) as Record<string, unknown>[]),
    );
  }
  return snapshot;
}

/**
 * The days other people are sharing with this phone, and the days this phone
 * is sharing with them.
 *
 * Everything here is read-only as far as the local data is concerned: it is
 * what the other phones have written. The server is authoritative for a shared
 * card, which is only safe because this always runs after a push — anything
 * typed on this phone is already up there before any of it comes back down.
 */
export async function pullSharedOutings(): Promise<Snapshot> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('This build has no server configured.');
  await requireUserId();

  const snapshot = emptySnapshot();

  const { data: memberships, error: memberError } = await supabase
    .from('outing_members')
    .select('outing_id');
  if (memberError) throw new Error(`outing_members: ${memberError.message}`);
  const outingIds = (memberships ?? []).map((m) => m.outing_id as string);
  if (outingIds.length === 0) return snapshot;

  // The table name is the snapshot key in every case, so one argument does.
  const add = async (table: keyof Snapshot, column: string, values: string[]): Promise<void> => {
    if (values.length === 0) return;
    const { data, error } = await supabase.from(table).select('*').in(column, values);
    if (error) throw new Error(`${table}: ${error.message}`);
    (snapshot[table] as unknown as Record<string, unknown>[]).push(
      ...((data ?? []) as Record<string, unknown>[]),
    );
  };

  await add('outings', 'id', outingIds);
  // The group has to come too: fromRows hangs players off it, and a player
  // with no group would be dropped on the way back into the app.
  await add('outing_field', 'outing_id', outingIds);
  await add('outing_field_games', 'outing_id', outingIds);
  await add('outing_field_entrants', 'outing_id', outingIds);
  await add('rounds', 'outing_id', outingIds);

  const roundIds = snapshot.rounds.map((r) => r.id);
  for (const table of [
    'round_players',
    'scores',
    'junk',
    'presses',
    'wolf_picks',
    'round_games',
    'round_options',
    'round_teams',
    'round_pairings',
  ] as (keyof Snapshot)[]) {
    await add(table, 'round_id', roundIds);
  }

  // The names to put against the scores, and a card to play them on.
  await add('players', 'id', [...new Set(snapshot.outing_field.map((f) => f.player_id))]);
  await add('groups', 'id', [...new Set(snapshot.outings.map((o) => o.group_id))]);
  const courseIds = [...new Set(snapshot.outings.map((o) => o.course_id))];
  await add('courses', 'id', courseIds);
  await add('holes', 'course_id', courseIds);

  return snapshot;
}

export interface PushResult {
  upserted: number;
  deleted: number;
}

/**
 * Writes the phone's state up.
 *
 * `prune` removes rows the server still has and the phone no longer does. It
 * is refused for an empty local snapshot: a fresh install that has not pulled
 * yet would otherwise delete a season in order to "sync" it.
 */
export async function pushSnapshot(
  local: Snapshot,
  options: { prune?: Deletions } = {},
): Promise<PushResult> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('This build has no server configured.');
  const ownerId = await requireUserId();

  // Parents before children, so a foreign key always has something to point at.
  for (const table of TABLES) {
    const rows = snapshotRows(local, table).map((row) => ({ ...row, owner_id: ownerId }));
    for (const batch of chunked(rows)) {
      const { error } = await supabase
        .from(table)
        .upsert(batch, { onConflict: conflictTarget(table) });
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  }

  let deleted = 0;
  if (options.prune) {
    // Children before parents on the way out, which is the mirror image.
    for (const table of [...TABLES].reverse()) {
      for (const key of options.prune[table]) {
        let query = supabase.from(table).delete();
        for (const [column, value] of Object.entries(key)) {
          query = query.eq(column, value as string | number);
        }
        const { error } = await query;
        if (error) throw new Error(`${table}: ${error.message}`);
        deleted += 1;
      }
    }
  }

  return { upserted: countRows(local), deleted };
}

function snapshotRows(snapshot: Snapshot, table: keyof Snapshot): Record<string, unknown>[] {
  return snapshot[table] as unknown as Record<string, unknown>[];
}

export type SyncOutcome =
  | { status: 'adopted-remote'; rows: number; snapshot: Snapshot }
  | { status: 'pushed'; upserted: number; deleted: number }
  | { status: 'nothing-to-do' };

/**
 * Reconciles one account's data, once.
 *
 * The only genuinely awkward case is a phone with data meeting a server with
 * different data, and this resolves it the blunt way: whichever side is asking
 * wins. That is honest for a single person's own season across their own
 * devices, and it is why the pull happens first — a fresh install adopts what
 * is already there rather than flattening it.
 */
export async function reconcile(local: Snapshot): Promise<SyncOutcome> {
  const remote = await pullSnapshot();

  if (isEmpty(local) && !isEmpty(remote)) {
    return { status: 'adopted-remote', rows: countRows(remote), snapshot: remote };
  }
  if (isEmpty(local) && isEmpty(remote)) {
    return { status: 'nothing-to-do' };
  }

  const prune = deletions(remote, local);
  const result = await pushSnapshot(local, { prune });
  return { status: 'pushed', upserted: result.upserted, deleted: countDeletions(prune) };
}
