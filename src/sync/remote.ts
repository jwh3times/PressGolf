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
  await requireUserId();

  const snapshot = emptySnapshot();
  for (const table of TABLES) {
    const { data, error } = await supabase.from(table).select('*');
    if (error) throw new Error(`${table}: ${error.message}`);
    // Row-level security already limits this to rows we own, so there is no
    // filter here to get wrong.
    (snapshot[table] as unknown as Record<string, unknown>[]).push(
      ...((data ?? []) as Record<string, unknown>[]),
    );
  }
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
