import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { pullSnapshot, pushSnapshot, reconcile } from '../remote';
import { TABLES, fromRows, toRows } from '../rows';
import {
  currentUserId,
  deleteAccount,
  getSupabase,
  hostOuting,
  joinOuting,
  requireUserId,
  signInWithPassword,
  signOut,
  signUpWithPassword,
} from '../supabase';
import { demoDocuments } from './fixtures';

/**
 * Deleting an account through the real Edge Function, on a local Supabase stack.
 *
 * What's asserted is what's left afterwards, read with the service role, since
 * a deleted account can no longer read anything for itself.
 */

const RUN = `d${Date.now().toString(36)}`;
const PASSWORD = 'correct-horse-battery-staple';

const admin = createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

interface Account {
  email: string;
  id: string;
}

let accounts = 0;

async function signUp(name: string): Promise<Account> {
  await signOut();
  const email = `${name}-${RUN}-${++accounts}@example.com`;
  await signUpWithPassword(email, PASSWORD);
  return { email, id: await requireUserId() };
}

/** Switches the app's client to this account, as signing in on a phone does. */
async function signInAs(account: Account): Promise<void> {
  await signOut();
  await signInWithPassword(account.email, PASSWORD);
}

/** How many rows on the server belong to this account, in every table that says whose a row is. */
async function rowsHeldBy(account: Account): Promise<number> {
  let total = 0;
  for (const table of TABLES) {
    const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true }).eq('owner_id', account.id);
    if (error) throw new Error(`${table}: ${error.message}`);
    total += count ?? 0;
  }
  for (const table of ['outing_members', 'mutations']) {
    const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true }).eq('user_id', account.id);
    if (error) throw new Error(`${table}: ${error.message}`);
    total += count ?? 0;
  }
  return total;
}

/** Ann organises a day and Ben joins it. Each is signed in again by whoever needs them. */
async function sharedDay(prefix: string) {
  const ann = await signUp('ann');
  const season = demoDocuments(`${RUN}${prefix}`);
  await pushSnapshot(toRows(season));
  const outing = season.outings[0];
  const { joinCode } = await hostOuting(outing.id);
  const ben = await signUp('ben');
  await joinOuting(joinCode, null, 'Ben');
  return { ann, ben, season, outing };
}

/**
 * Deletes the account from another phone, on a client of its own. The app's client
 * stays signed in, holding a token that's still valid, as a forgotten phone does.
 */
async function deleteFromAnotherPhone(account: Account): Promise<void> {
  const other = createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await other.auth.signInWithPassword({ email: account.email, password: PASSWORD });
  expect(signInError).toBeNull();
  const { error } = await other.functions.invoke('delete-account', { body: { password: PASSWORD } });
  expect(error).toBeNull();
}

/** Ages the session this phone has saved past its access token's expiry. */
async function expireStoredSession(): Promise<void> {
  const keys = await AsyncStorage.getAllKeys();
  const key = keys.find((k) => k.endsWith('-auth-token'))!;
  const session = JSON.parse((await AsyncStorage.getItem(key))!);
  await AsyncStorage.setItem(key, JSON.stringify({ ...session, expires_at: Math.floor(Date.now() / 1000) - 60 }));
}

afterAll(async () => {
  await signOut();
  await getSupabase()?.auth.stopAutoRefresh();
  getSupabase()?.realtime.disconnect();
});

describe('deleting an account that shares nothing', () => {
  it('leaves nothing on the server, ends its sign-in, and lets the email start again empty', async () => {
    const ann = await signUp('ann');
    await pushSnapshot(toRows(demoDocuments(`${RUN}gone`)));
    expect(await rowsHeldBy(ann)).toBeGreaterThan(0);

    await deleteAccount(PASSWORD);

    expect(await rowsHeldBy(ann)).toBe(0);
    await signOut();
    await expect(signInWithPassword(ann.email, PASSWORD)).rejects.toThrow('do not match an account');

    await signUpWithPassword(ann.email, PASSWORD);
    expect(await requireUserId()).not.toBe(ann.id);
    expect(fromRows(await pullSnapshot()).groups).toEqual([]);
  });

  it('finishes when the clean-up committed but the auth user was left behind', async () => {
    const ann = await signUp('ann');
    await pushSnapshot(toRows(demoDocuments(`${RUN}partial`)));
    const { error } = await admin.rpc('delete_account_data', { target: ann.id });
    expect(error).toBeNull();
    expect(await rowsHeldBy(ann)).toBe(0);

    await deleteAccount(PASSWORD);

    await signOut();
    await expect(signInWithPassword(ann.email, PASSWORD)).rejects.toThrow('do not match an account');
  });

  it('answers as deleted when the account has already gone, so a phone that lost the reply can finish', async () => {
    await signUp('ann');
    await deleteAccount(PASSWORD);
    await expect(deleteAccount(PASSWORD)).resolves.toBeUndefined();
    // A wrong password can't be checked against an account that isn't there, and doesn't need to be.
    await expect(deleteAccount('not-the-password')).resolves.toBeUndefined();
  });
});

describe('who can delete what', () => {
  it('deletes nothing for a wrong or missing password', async () => {
    const ann = await signUp('ann');
    await pushSnapshot(toRows(demoDocuments(`${RUN}wrong`)));
    const before = await rowsHeldBy(ann);

    await expect(deleteAccount('not-the-password')).rejects.toThrow('That password is not right');
    await expect(deleteAccount('')).rejects.toThrow('That password is not right');

    expect(await rowsHeldBy(ann)).toBe(before);
    await signInAs(ann);
  });

  it('deletes nothing without a real token', async () => {
    const ann = await signUp('ann');
    await pushSnapshot(toRows(demoDocuments(`${RUN}token`)));
    const before = await rowsHeldBy(ann);

    const call = (headers: Record<string, string>) =>
      fetch(`${process.env.SUPABASE_TEST_URL}/functions/v1/delete-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ password: PASSWORD, user_id: ann.id, email: ann.email }),
      });
    const anon = process.env.SUPABASE_TEST_ANON_KEY!;

    const attempts: Record<string, string>[] = [
      {},
      { Authorization: `Bearer ${anon}`, apikey: anon },
      { Authorization: 'Bearer not-a-token' },
    ];
    for (const headers of attempts) {
      const response = await call(headers);
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ outcome: 'not-signed-in' });
    }

    expect(await rowsHeldBy(ann)).toBe(before);
  });

  it("acts on the token's account, whatever the request names", async () => {
    const ann = await signUp('ann');
    await pushSnapshot(toRows(demoDocuments(`${RUN}anns`)));
    const annHolds = await rowsHeldBy(ann);

    const ben = await signUp('ben');
    await pushSnapshot(toRows(demoDocuments(`${RUN}bens`)));
    const { error } = await getSupabase()!.functions.invoke('delete-account', {
      body: { password: PASSWORD, user_id: ann.id, target: ann.id, email: ann.email },
    });
    expect(error).toBeNull();

    expect(await rowsHeldBy(ben)).toBe(0);
    expect(await rowsHeldBy(ann)).toBe(annHolds);
    await signInAs(ann);
  });

  it("won't take someone else's password for the signed-in account", async () => {
    const ann = await signUp('ann');
    const annHolds = await rowsHeldBy(ann);
    const other = 'another-horse-battery-staple';
    await signOut();
    await signUpWithPassword(`ben-${RUN}-${++accounts}@example.com`, other);
    await signOut();
    await signInAs(ann);

    await expect(deleteAccount(other)).rejects.toThrow('That password is not right');
    expect(await rowsHeldBy(ann)).toBe(annHolds);
  });

  it('refuses the clean-up function to everyone but the service role', async () => {
    const ann = await signUp('ann');
    await pushSnapshot(toRows(demoDocuments(`${RUN}rpc`)));
    const before = await rowsHeldBy(ann);

    const ben = await signUp('ben');
    for (const target of [ann.id, ben.id]) {
      const { error } = await getSupabase()!.rpc('delete_account_data', { target });
      expect(error?.code).toBe('42501');
    }

    const anon = createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await anon.rpc('delete_account_data', { target: ann.id });
    expect(error?.code).toBe('42501');

    expect(await rowsHeldBy(ann)).toBe(before);
  });
});

describe('an account that shares data', () => {
  const REFUSED = 'shares data with another account';

  it('refuses the organiser of an outing a guest joined, with nothing deleted', async () => {
    const { ann, ben } = await sharedDay('org');
    const [annHolds, benHolds] = [await rowsHeldBy(ann), await rowsHeldBy(ben)];

    await signInAs(ann);
    await expect(deleteAccount(PASSWORD)).rejects.toThrow(REFUSED);

    expect(await rowsHeldBy(ann)).toBe(annHolds);
    expect(await rowsHeldBy(ben)).toBe(benHolds);
    await signInAs(ann);
  });

  it("refuses a guest in someone else's outing, with nothing deleted", async () => {
    const { ann, ben } = await sharedDay('guest');
    const [annHolds, benHolds] = [await rowsHeldBy(ann), await rowsHeldBy(ben)];

    await expect(deleteAccount(PASSWORD)).rejects.toThrow(REFUSED);

    expect(await rowsHeldBy(ann)).toBe(annHolds);
    expect(await rowsHeldBy(ben)).toBe(benHolds);
    await signInAs(ben);
  });

  it("refuses an owner whose group and course hold another account's round, once the guest has gone", async () => {
    const { ann, ben, season, outing } = await sharedDay('rematch');
    // Ben plays Ann's group and course again on his own, then leaves the outing by hand,
    // so only the row itself is left to say the two accounts share anything.
    const day = season.rounds.find((r) => r.outingId === outing.id)!;
    const { error: rematchError } = await getSupabase()!.from('rounds').insert({
      id: `${RUN}rematch`,
      group_id: day.groupId,
      course_id: day.courseId,
      name: 'Rematch',
      started_at: 1,
    });
    expect(rematchError).toBeNull();
    const { error: leaveError } = await admin.from('outing_members').delete().eq('user_id', ben.id);
    expect(leaveError).toBeNull();
    const annHolds = await rowsHeldBy(ann);

    await signInAs(ann);
    await expect(deleteAccount(PASSWORD)).rejects.toThrow(REFUSED);

    expect(await rowsHeldBy(ann)).toBe(annHolds);
    const { data } = await admin.from('rounds').select('id').eq('id', `${RUN}rematch`);
    expect(data).toEqual([{ id: `${RUN}rematch` }]);
    await signInAs(ann);
  });

  it('runs as one transaction: a refused clean-up from the service role leaves everything too', async () => {
    const { ann } = await sharedDay('txn');
    const annHolds = await rowsHeldBy(ann);
    const { error } = await admin.rpc('delete_account_data', { target: ann.id });
    expect(error?.code).toBe('PR001');
    expect(await rowsHeldBy(ann)).toBe(annHolds);
  });
});

describe('a phone still signed in to a deleted account', () => {
  it("can't put the season back, and can still finish deleting if it lost the reply", async () => {
    const ann = await signUp('ann');
    const season = demoDocuments(`${RUN}back`);
    await pushSnapshot(toRows(season));
    await deleteFromAnotherPhone(ann);

    await expect(reconcile(toRows(season))).rejects.toThrow('foreign key');

    expect(await rowsHeldBy(ann)).toBe(0);
    await expect(deleteAccount(PASSWORD)).resolves.toBeUndefined();
  });

  it.each<[string, Record<string, unknown>]>([
    ['groups',{ id: `${RUN}gone-g`, name: 'Gone', created_at: 1 }],
    ['courses', { id: `${RUN}gone-c`, name: 'Gone', created_at: 1 }],
    ['clubs', { id: `${RUN}gone-k`, name: '7i', position: 0 }],
    ['bag_settings', { usual_score: '90s' }],
  ])("can't write to %s", async (table, row) => {
    const ann = await signUp('ann');
    await deleteFromAnotherPhone(ann);

    const { error } = await getSupabase()!.from(table).insert(row);

    expect(error?.code).toBe('23503');
    expect(await rowsHeldBy(ann)).toBe(0);
  });

  it("can't join an outing", async () => {
    await signUp('ben');
    const season = demoDocuments(`${RUN}join`);
    await pushSnapshot(toRows(season));
    const { joinCode } = await hostOuting(season.outings[0].id);
    const ann = await signUp('ann');
    await deleteFromAnotherPhone(ann);

    await expect(joinOuting(joinCode, null, 'Ann')).rejects.toThrow('foreign key');

    expect(await rowsHeldBy(ann)).toBe(0);
  });

  it('ends up signed out once the token refresh is refused', async () => {
    const ann = await signUp('ann');
    await deleteFromAnotherPhone(ann);
    const events: string[] = [];
    const { data: subscription } = getSupabase()!.auth.onAuthStateChange((event) => {
      events.push(event);
    });

    // The client keeps a session whose access token still works, so this only
    // happens once the token runs out, up to an hour after the deletion.
    await expireStoredSession();

    expect(await currentUserId()).toBeNull();
    subscription.subscription.unsubscribe();
    expect(events).toContain('SIGNED_OUT');
  });
});

describe('deleting an auth user who still holds rows', () => {
  it('is refused for an owner, and the account carries on', async () => {
    const ann = await signUp('ann');
    await pushSnapshot(toRows(demoDocuments(`${RUN}owner`)));
    const annHolds = await rowsHeldBy(ann);

    const { error } = await admin.auth.admin.deleteUser(ann.id);

    expect(error).not.toBeNull();
    expect(await rowsHeldBy(ann)).toBe(annHolds);
    await signInAs(ann);
    expect(await requireUserId()).toBe(ann.id);
  });

  it('is refused for a guest who holds only a membership', async () => {
    const { ben } = await sharedDay('member');
    expect(await rowsHeldBy(ben)).toBe(1);

    const { error } = await admin.auth.admin.deleteUser(ben.id);

    expect(error).not.toBeNull();
    expect(await rowsHeldBy(ben)).toBe(1);
  });
});
