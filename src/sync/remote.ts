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
import { changedRows, conflictTarget, countDeletions, deletions, GUEST_WRITES, identify, isEmpty, splitByOwner, type Deletions } from './diff';
import type { MoveNotice } from './move-notices';
import { countRows, emptySnapshot, TABLES, type Snapshot } from './rows';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabase, requireUserId } from './supabase';

/** PostgREST will not take an unbounded insert; big cards go up in pieces. */
const CHUNK = 500;

function chunked<T>(rows: T[]): T[][] {
  if (rows.length <= CHUNK) return rows.length ? [rows] : [];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

/**
 * Every row a read matches, however many there are.
 *
 * PostgREST caps a response at the project's `max_rows` (1000 by default) and
 * says nothing about the rest, so one request for a season's scores silently
 * came back short. Pages are ordered by the table's key so none is skipped or
 * repeated, and the loop stops on an empty page rather than a short one: a
 * project whose cap is lower than PAGE still gets everything.
 */
const PAGE = 1000;

async function selectAll(
  supabase: SupabaseClient,
  table: keyof Snapshot | 'move_notices',
  filter: (query: ReturnType<ReturnType<SupabaseClient['from']>['select']>) => typeof query,
): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  const key = table === 'move_notices' ? 'kind,from_id' : conflictTarget(table);
  for (;;) {
    let query = filter(supabase.from(table).select('*'));
    for (const column of key.split(',')) query = query.order(column);
    const { data, error } = await query.range(rows.length, rows.length + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = (data ?? []) as Record<string, unknown>[];
    if (page.length === 0) return rows;
    rows.push(...page);
  }
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
    const rows = await selectAll(supabase, table, (query) => query.eq('owner_id', ownerId));
    (snapshot[table] as unknown as Record<string, unknown>[]).push(...rows);
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
    const rows = await selectAll(supabase, table, (query) => query.in(column, values));
    (snapshot[table] as unknown as Record<string, unknown>[]).push(...rows);
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
  await add('tees', 'course_id', courseIds);
  await add('tee_holes', 'course_id', courseIds);
  await add('course_greens', 'course_id', courseIds);
  await add('course_features', 'course_id', courseIds);
  await add('course_hole_notes', 'course_id', courseIds);

  return snapshot;
}

/** What an organiser's deletion left for this account, for `applyMoveNotices`. Only its own, by policy. */
export async function pullMoveNotices(): Promise<MoveNotice[]> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('This build has no server configured.');
  await requireUserId();
  return (await selectAll(supabase, 'move_notices', (query) => query)) as unknown as MoveNotice[];
}

export interface PushResult {
  upserted: number;
  deleted: number;
}

/**
 * Writes the phone's state up.
 *
 * `local` goes up as this account's own. `guest` is cells of someone else's
 * shared card that this phone changed: they go up without an owner, so an
 * edit leaves the row with whoever owns it, and a new one takes the column's
 * default, this account. `prune` removes rows the server still has and the
 * phone no longer does. It is refused for an empty local snapshot: a fresh
 * install that has not pulled yet would otherwise delete a season in order to
 * "sync" it.
 */
export async function pushSnapshot(
  local: Snapshot,
  options: { prune?: Deletions; guest?: Snapshot } = {},
): Promise<PushResult> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('This build has no server configured.');
  const ownerId = await requireUserId();

  const upsert = async (table: keyof Snapshot, rows: Record<string, unknown>[]) => {
    for (const batch of chunked(rows)) {
      const { error } = await supabase.from(table).upsert(batch, { onConflict: conflictTarget(table) });
      if (error) throw new Error(`${table}: ${error.message}`);
    }
  };
  // Parents before children, so a foreign key always has something to point at.
  for (const table of TABLES) {
    await upsert(table, snapshotRows(local, table).map((row) => ({ ...row, owner_id: ownerId })));
  }
  // Someone else's card is already up there, parents and all.
  if (options.guest) {
    for (const table of TABLES) await upsert(table, snapshotRows(options.guest, table));
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

  return { upserted: countRows(local) + (options.guest ? countRows(options.guest) : 0), deleted };
}

/**
 * A push after first contact: what changed since `server`, this account's own
 * as it stood after the last push, and the cells of shared cards changed since
 * `shared`, the last pull of the shared outings. Returns this account's own
 * rows, whole, for the next push to diff against.
 */
export async function pushChanges(local: Snapshot, server: Snapshot, shared: Snapshot): Promise<Snapshot> {
  const { own, guest } = splitByOwner(local, shared, await requireUserId());
  await pushSnapshot(changedRows(server, own), { prune: deletions(server, own), guest });
  return own;
}

function snapshotRows(snapshot: Snapshot, table: keyof Snapshot): Record<string, unknown>[] {
  return snapshot[table] as unknown as Record<string, unknown>[];
}

/** The rows of a table the shared pull shows on this account's own rounds. */
function onOwnRounds(shared: Snapshot, table: keyof Snapshot, ownerId: string): Record<string, unknown>[] {
  const ownRounds = new Set(snapshotRows(shared, 'rounds').filter((round) => round.owner_id === ownerId).map((round) => round.id));
  return snapshotRows(shared, table).filter((cell) => ownRounds.has(cell.round_id));
}

/**
 * First contact's deletions, less the cells this phone may simply not have seen.
 *
 * A guest who deletes their account leaves what they typed on this account's card
 * to this account, so those cells arrive in its own pull. A phone that was behind
 * would read them as cleared and delete them. The shared pull shows them, and they
 * reach the phone with the next merge. Later pushes diff against what this phone
 * last pushed, so a cell cleared in a running session still goes.
 *
 * The cost is a cell cleared on a shared round and not pushed before the app
 * closed: it looks just the same, so it comes back.
 */
function keepUnseenCells(prune: Deletions, shared: Snapshot, ownerId: string): Deletions {
  const remaining = { ...prune };
  for (const table of GUEST_WRITES) {
    const onOwnCard = new Set(onOwnRounds(shared, table, ownerId).map((cell) => identify(table, cell)));
    remaining[table] = prune[table].filter((key) => !onOwnCard.has(identify(table, key)));
  }
  return remaining;
}

/**
 * This account's rows as first contact should send them: a blank box on the phone
 * doesn't go up over a score the shared pull shows on its own round. A guest typed
 * it, and the phone is behind. It reaches the phone with the next merge.
 *
 * Only what's sent changes. `own` still says the server has the blank, so the push
 * after this doesn't send it either. The cost is the same as `keepUnseenCells`.
 */
function withoutBlanksOverScores(own: Snapshot, shared: Snapshot, ownerId: string): Snapshot {
  const played = (cell: { strokes?: unknown; picked_up?: unknown }) => cell.strokes !== null || cell.picked_up === true;
  const scored = new Set(onOwnRounds(shared, 'scores', ownerId).filter(played).map((cell) => identify('scores', cell)));
  return {
    ...own,
    scores: own.scores.filter((row) => played(row) || !scored.has(identify('scores', { ...row }))),
  };
}

/** Every outcome carries the shared outings as pulled, for the next push to split by. */
export type SyncOutcome = { shared: Snapshot } & (
  | { status: 'adopted-remote'; rows: number; snapshot: Snapshot }
  /**
   * `own` is this account's rows as pushed, whole. `clubs` is set when the
   * phone had no bag and took the account's, for the app to take too, and
   * `bag_settings` likewise.
   */
  | {
      status: 'pushed';
      upserted: number;
      deleted: number;
      own: Snapshot;
      clubs?: Snapshot['clubs'];
      bag_settings?: Snapshot['bag_settings'];
    }
  | { status: 'nothing-to-do' }
);

/**
 * Reconciles one account's data, once.
 *
 * The only genuinely awkward case is a phone with data meeting a server with
 * different data, and this resolves it the blunt way: whichever side is asking
 * wins. That is honest for a single person's own season across their own
 * devices, and it is why the pull happens first — a fresh install adopts what
 * is already there rather than flattening it.
 *
 * The bag is settled on its own, because a phone often has a season and no
 * bag: one that synced before the bag existed, or a second device. A phone
 * with no clubs takes the account's; one with clubs is the side asking, and
 * wins. A fresh install that adopts the account's season keeps clubs typed on
 * it before signing in when the account has none. The bag's settings (#146)
 * are settled the same way, apart from the clubs.
 */
export async function reconcile(local: Snapshot): Promise<SyncOutcome> {
  const remote = await pullSnapshot();
  // Before pushing, so a phone that already holds someone else's day, saved
  // from an earlier session, knows which of its rows are theirs.
  const shared = await pullSharedOutings();

  const takesBag = local.clubs.length === 0 && remote.clubs.length > 0;
  const takesSettings = local.bag_settings.length === 0 && remote.bag_settings.length > 0;
  if (isEmpty(local) && (!isEmpty(remote) || takesBag || takesSettings)) {
    // The account's bag and settings when it has them; otherwise what this phone has, sent up.
    const kept = {
      ...emptySnapshot(),
      clubs: remote.clubs.length > 0 ? [] : local.clubs,
      bag_settings: remote.bag_settings.length > 0 ? [] : local.bag_settings,
    };
    if (countRows(kept) > 0) await pushSnapshot(kept);
    const snapshot = {
      ...remote,
      clubs: remote.clubs.length > 0 ? remote.clubs : local.clubs,
      bag_settings: remote.bag_settings.length > 0 ? remote.bag_settings : local.bag_settings,
    };
    return { status: 'adopted-remote', rows: countRows(snapshot), snapshot, shared };
  }
  if (isEmpty(local) && isEmpty(remote) && local.clubs.length === 0 && local.bag_settings.length === 0) {
    return { status: 'nothing-to-do', shared };
  }

  const mine = {
    ...local,
    ...(takesBag ? { clubs: remote.clubs } : {}),
    ...(takesSettings ? { bag_settings: remote.bag_settings } : {}),
  };
  const ownerId = await requireUserId();
  const { own, guest } = splitByOwner(mine, shared, ownerId);
  const prune = keepUnseenCells(deletions(remote, own), shared, ownerId);
  const result = await pushSnapshot(withoutBlanksOverScores(own, shared, ownerId), { prune, guest });
  return {
    status: 'pushed',
    upserted: result.upserted,
    deleted: countDeletions(prune),
    own,
    shared,
    ...(takesBag ? { clubs: remote.clubs } : {}),
    ...(takesSettings ? { bag_settings: remote.bag_settings } : {}),
  };
}
