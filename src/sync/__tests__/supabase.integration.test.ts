import { createClient } from '@supabase/supabase-js';
import { pullSharedOutings, pullSnapshot, pushSnapshot } from '../remote';
import { fromRows, toRows, type Documents } from '../rows';
import {
  getSupabase,
  hostOuting,
  joinOuting,
  requireUserId,
  signInWithPassword,
  signOut,
  signUpWithPassword,
  SupabaseTransport,
} from '../supabase';
import type { Mutation, RemoteChanges } from '../types';
import { demoDocuments } from './fixtures';

/**
 * Sync against a real local Supabase stack: auth, PostgREST, row-level security
 * as the API enforces it, the join_outing function and realtime.
 *
 * The unit tests prove the row mapping and the merge logic against a fake
 * transport. These prove the server agrees: that what goes up comes back, and
 * that one account can neither see nor touch another's money.
 *
 * Every run signs up fresh accounts and prefixes every id, so runs never
 * collide on a stack that is left running. Run with `npm run test:integration`.
 */

const RUN = `t${Date.now().toString(36)}`;
const PASSWORD = 'correct-horse-battery-staple';

interface Account {
  email: string;
  id: string;
}

let accounts = 0;

/** A new account, signed in on the app's client. */
async function signUp(name: string): Promise<Account> {
  await signOut();
  const email = `${name}-${RUN}-${++accounts}@example.com`;
  const { needsConfirmation } = await signUpWithPassword(email, PASSWORD);
  expect(needsConfirmation).toBe(false);
  return { email, id: await requireUserId() };
}

/** Switches the app's client to this account, as signing in on a phone does. */
async function signInAs(account: Account): Promise<void> {
  await signOut();
  await signInWithPassword(account.email, PASSWORD);
}

/** An account's season, pushed to the server. Returns what was pushed. */
async function pushSeason(prefix: string): Promise<Documents> {
  const documents = demoDocuments(`${RUN}${prefix}`);
  await pushSnapshot(toRows(documents));
  return documents;
}

function byId(documents: Documents): Documents {
  const sorted = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
  return {
    groups: sorted(documents.groups),
    courses: sorted(documents.courses),
    rounds: sorted(documents.rounds),
    outings: sorted(documents.outings),
  };
}

function mutation(outingId: string, roundId: string, n: number): Mutation {
  return {
    id: `${RUN}-m${n}`,
    kind: 'score',
    roundId,
    outingId,
    key: `score:${roundId}:${n}`,
    value: 4,
    at: 1_750_000_000_000 + n,
    deviceId: `${RUN}-device`,
    authorId: null,
  };
}

afterAll(async () => {
  await signOut();
  // The app's client refreshes tokens on a timer, which would keep Jest alive.
  await getSupabase()?.auth.stopAutoRefresh();
  getSupabase()?.realtime.disconnect();
});

describe('sync against a local Supabase stack', () => {
  it('brings back exactly the season that went up', async () => {
    await signUp('ann');
    const documents = await pushSeason('rt');
    const remote = await pullSnapshot();
    // The server keeps no order between groups, courses, rounds or outings,
    // so compare those as sets. Order inside each one (roster, tee order,
    // holes) is stored and must survive as is.
    expect(byId(fromRows(remote))).toEqual(byId(documents));
  });

  it("keeps one account's season out of another's reach", async () => {
    const ann = await signUp('ann');
    const season = await pushSeason('iso');
    const group = season.groups[0];
    const round = season.rounds[0];

    const ben = await signUp('ben');
    const supabase = getSupabase()!;
    // Nothing of Ann's comes back to Ben, through the app or by asking directly.
    expect(fromRows(await pullSnapshot()).groups).toEqual([]);
    const { data: seen } = await supabase.from('groups').select('id').eq('id', group.id);
    expect(seen).toEqual([]);

    // Writing over her rows by id fails, and deleting them does nothing.
    const { error: overwrite } = await supabase
      .from('groups')
      .upsert({ id: group.id, name: 'Taken', owner_id: ben.id }, { onConflict: 'id' });
    expect(overwrite).not.toBeNull();
    await supabase.from('rounds').delete().eq('id', round.id);

    await signInAs(ann);
    const after = fromRows(await pullSnapshot());
    expect(after.groups.find((g) => g.id === group.id)?.name).toBe(group.name);
    expect(after.rounds.some((r) => r.id === round.id)).toBe(true);
  });

  it('lets a guest into a shared outing by code, and into nothing else', async () => {
    await signUp('ann');
    const season = await pushSeason('join');
    const outing = season.outings[0];
    const { joinCode } = await hostOuting(outing.id);
    // Sharing again hands back the same code rather than stranding the first.
    expect((await hostOuting(outing.id)).joinCode).toBe(joinCode);

    await signUp('ben');
    await expect(joinOuting('ZZZZZZ', null, 'Ben')).rejects.toThrow('No outing with that code');
    expect(await joinOuting(joinCode.toLowerCase(), null, 'Ben')).toEqual({ outingId: outing.id });

    const shared = fromRows(await pullSharedOutings());
    expect(shared.outings.map((o) => o.id)).toEqual([outing.id]);
    expect(shared.rounds.map((r) => r.id).sort()).toEqual([...outing.roundIds].sort());
    // Ann's own rounds outside the outing stay hers alone.
    const outside = season.rounds.filter((r) => !outing.roundIds.includes(r.id));
    expect(outside.length).toBeGreaterThan(0);
    expect(shared.rounds.some((r) => outside.some((o) => o.id === r.id))).toBe(false);
    // Joining makes Ben a reader of the day, not an owner of anything.
    expect(fromRows(await pullSnapshot()).groups).toEqual([]);
  });

  it("carries one member's edits to the others, and none to a stranger", async () => {
    const ann = await signUp('ann');
    const season = await pushSeason('log');
    const outing = season.outings[0];
    const roundId = outing.roundIds[0];
    const { joinCode } = await hostOuting(outing.id);
    const transport = new SupabaseTransport();

    await signUp('ben');
    await joinOuting(joinCode, null, 'Ben');
    const edits = [mutation(outing.id, roundId, 1), mutation(outing.id, roundId, 2)];
    await transport.push(outing.id, edits);
    // A retry after a timeout the server already handled is not a second edit.
    await transport.push(outing.id, edits);

    await signInAs(ann);
    const pulled = await transport.pull(outing.id, null);
    expect(pulled.mutations.map((m) => m.id)).toEqual(edits.map((m) => m.id));
    expect(pulled.mutations[0]).toMatchObject({ key: edits[0].key, value: 4, at: edits[0].at });
    // Nothing new after the cursor.
    expect((await transport.pull(outing.id, pulled.cursor)).mutations).toEqual([]);

    await signUp('cal');
    expect((await transport.pull(outing.id, null)).mutations).toEqual([]);
    await expect(transport.push(outing.id, [mutation(outing.id, roundId, 3)])).rejects.toBeTruthy();
  });

  it("delivers another member's edit live to a subscribed phone", async () => {
    await signUp('ann');
    const season = await pushSeason('live');
    const outing = season.outings[0];
    const roundId = outing.roundIds[0];
    const { joinCode } = await hostOuting(outing.id);

    // Ben is the other phone: his own client, signed in separately.
    const ben = createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const benEmail = `ben-${RUN}-live@example.com`;
    await ben.auth.signUp({ email: benEmail, password: PASSWORD });
    await ben.rpc('join_outing', { code: joinCode, as_player: null, display: 'Ben' });

    const received = new Promise<RemoteChanges>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No realtime change within 15 s')), 15_000);
      const unsubscribe = new SupabaseTransport().subscribe(outing.id, (changes) => {
        clearTimeout(timer);
        unsubscribe();
        resolve(changes);
      });
    });
    // Give the channel a moment to join before Ben writes.
    await new Promise((r) => setTimeout(r, 1500));
    const edit = mutation(outing.id, roundId, 9);
    const { error } = await ben.from('mutations').insert({
      id: edit.id,
      outing_id: outing.id,
      round_id: roundId,
      kind: edit.kind,
      key: edit.key,
      value: edit.value,
      at: edit.at,
      device_id: 'bens-phone',
      author_id: null,
    });
    expect(error).toBeNull();

    const changes = await received;
    expect(changes.mutations.map((m) => m.id)).toEqual([edit.id]);
    expect(changes.mutations[0].deviceId).toBe('bens-phone');
    ben.realtime.disconnect();
  });
});
