import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { mergeShared } from '../merge-shared';
import { applyMoveNotices } from '../move-notices';
import { pullMoveNotices, pullSharedOutings, pullSnapshot, pushChanges, pushSnapshot, reconcile } from '../remote';
import { TABLES, fromRows, toRows, type Documents } from '../rows';
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
const REFUSED = 'shares data with another account';

const admin = createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/** A client of its own, with nobody signed in and nothing saved. */
function anonClient() {
  return createClient(process.env.SUPABASE_TEST_URL!, process.env.SUPABASE_TEST_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

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
 * Ann's day with two holes of one card still to play, and Ben, who has joined it,
 * typing them and a junk claim on her card. Ann's phone has a blank box for the
 * first, whose row stays hers, and no box for the second. That cell and the claim
 * are the only rows he owns on it. `before` is Ann's phone as it stood before he
 * typed. Ben is left signed in.
 */
async function guestOnTheCard(prefix: string) {
  const ann = await signUp('ann');
  const season = demoDocuments(`${RUN}${prefix}`);
  const outing = season.outings[0];
  const day = season.rounds.find((r) => r.outingId === outing.id)!;
  const scorer = day.playerIds[0];
  const hole = 17;
  const unplayed = { ...day, scores: { ...day.scores, [scorer]: [...day.scores[scorer].slice(0, hole - 1), null] } };
  const before: Documents = { ...season, rounds: season.rounds.map((r) => (r.id === day.id ? unplayed : r)) };
  await pushSnapshot(toRows(before));
  const { joinCode } = await hostOuting(outing.id);

  const ben = await signUp('ben');
  await joinOuting(joinCode, null, 'Ben');
  const pulled = await pullSharedOutings();
  const merged = mergeShared({ groups: [], courses: [], rounds: [], outings: [], clubs: [] }, fromRows(pulled));
  const theirs = merged.rounds.find((r) => r.id === day.id)!;
  const typed = [...theirs.scores[scorer]];
  typed[hole - 1] = 5;
  typed[hole] = 6;
  const card = {
    ...theirs,
    scores: { ...theirs.scores, [scorer]: typed },
    junk: { ...theirs.junk, [`${hole}:${scorer}:sandie`]: true as const },
  };
  const benPhone: Documents = { ...merged, rounds: merged.rounds.map((r) => (r.id === card.id ? card : r)) };
  await pushChanges(toRows(benPhone), await pullSnapshot(), pulled);

  /** The two rows he owns, read with the service role. */
  const cells = async () => {
    const where = { round_id: card.id, player_id: scorer, hole };
    const { data: score } = await admin.from('scores').select('strokes, owner_id').match(where).maybeSingle();
    const { data: junk } = await admin.from('junk').select('owner_id').match({ ...where, kind: 'sandie' }).maybeSingle();
    return { score, junk };
  };
  return { ann, ben, outing, day, before, card, benPhone, cells, joinCode };
}

const NOTHING: Documents = { groups: [], courses: [], rounds: [], outings: [], clubs: [] };

/** A guest's phone after first contact: what it holds, and what it would next push against. */
async function joinedPhone(holding: Documents = NOTHING) {
  const lastPull = await pullSharedOutings();
  const phone = mergeShared(holding, fromRows(lastPull));
  const contact = await reconcile(toRows(phone));
  if (contact.status !== 'pushed') throw new Error(contact.status);
  return { phone, lastPull, own: contact.own };
}

/** Rows of her day left on the server, whoever holds them. Read with the service role. */
async function dayLeft({ groupId, courseId, roundIds, outingId }: { groupId: string; courseId: string; roundIds: string[]; outingId: string }) {
  const count = async (table: string, column: string, values: string[]) => {
    const { count: rows, error } = await admin.from(table).select('*', { count: 'exact', head: true }).in(column, values);
    if (error) throw new Error(`${table}: ${error.message}`);
    return rows ?? 0;
  };
  const counts = await Promise.all([
    count('groups', 'id', [groupId]),
    count('players', 'group_id', [groupId]),
    count('courses', 'id', [courseId]),
    count('tees', 'course_id', [courseId]),
    count('outings', 'id', [outingId]),
    count('outing_field', 'outing_id', [outingId]),
    count('outing_members', 'outing_id', [outingId]),
    count('mutations', 'outing_id', [outingId]),
    count('rounds', 'id', roundIds),
    count('rounds', 'outing_id', [outingId]),
    count('scores', 'round_id', roundIds),
    count('junk', 'round_id', roundIds),
  ]);
  return counts.reduce((total, rows) => total + rows, 0);
}

/** What `dayLeft` looks for, on this outing. */
const dayOf = (outing: Documents['outings'][number], rounds: Documents['rounds']) => ({
  groupId: outing.groupId,
  courseId: outing.courseId,
  roundIds: rounds.filter((r) => r.outingId === outing.id).map((r) => r.id),
  outingId: outing.id,
});

/** What `cells` reads back while `owner` holds them. */
const typedCells = (owner: Account) => ({ score: { strokes: 6, owner_id: owner.id }, junk: { owner_id: owner.id } });

/**
 * Deletes the account from another phone, on a client of its own. The app's client
 * stays signed in, holding a token that's still valid, as a forgotten phone does.
 */
async function deleteFromAnotherPhone(account: Account): Promise<void> {
  const other = anonClient();
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

    const { error } = await anonClient().rpc('delete_account_data', { target: ann.id });
    expect(error?.code).toBe('42501');

    expect(await rowsHeldBy(ann)).toBe(before);
  });
});

describe('an account that shares data', () => {
  it('refuses an organiser whose guest has a round of their own on her group and course', async () => {
    const { ann, ben, season, outing } = await sharedDay('org');
    const day = season.rounds.find((r) => r.outingId === outing.id)!;
    const { error: rematchError } = await getSupabase()!.from('rounds').insert({
      id: `${RUN}org-rematch`,
      group_id: day.groupId,
      course_id: day.courseId,
      name: 'Rematch',
      started_at: 1,
    });
    expect(rematchError).toBeNull();
    const [annHolds, benHolds] = [await rowsHeldBy(ann), await rowsHeldBy(ben)];

    await signInAs(ann);
    await expect(deleteAccount(PASSWORD)).rejects.toThrow(REFUSED);

    expect(await rowsHeldBy(ann)).toBe(annHolds);
    expect(await rowsHeldBy(ben)).toBe(benHolds);
    await signInAs(ben);
    await expect(pullMoveNotices()).resolves.toEqual([]);
    await signInAs(ann);
  });

  it("refuses an organiser with a guest in an outing on someone else's group", async () => {
    const { ben, outing } = await sharedDay('third');
    const own = {
      id: `${RUN}third-own`,
      group_id: outing.groupId,
      course_id: outing.courseId,
      name: 'On her group',
      date: 1,
      started_at: 1,
    };
    const { error: outingError } = await getSupabase()!.from('outings').insert(own);
    expect(outingError).toBeNull();
    const { joinCode } = await hostOuting(own.id);
    await signUp('cal');
    await joinOuting(joinCode, null, 'Cal');
    await signInAs(ben);
    const benHolds = await rowsHeldBy(ben);

    await expect(deleteAccount(PASSWORD)).rejects.toThrow(REFUSED);

    expect(await rowsHeldBy(ben)).toBe(benHolds);
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
    const { ann, season, outing } = await sharedDay('txn');
    const day = season.rounds.find((r) => r.outingId === outing.id)!;
    const { error: rematchError } = await getSupabase()!.from('rounds').insert({
      id: `${RUN}txn-rematch`,
      group_id: day.groupId,
      course_id: day.courseId,
      name: 'Rematch',
      started_at: 1,
    });
    expect(rematchError).toBeNull();
    const annHolds = await rowsHeldBy(ann);
    const { error } = await admin.rpc('delete_account_data', { target: ann.id });
    expect(error?.code).toBe('PR001');
    expect(await rowsHeldBy(ann)).toBe(annHolds);
  });
});

describe('a guest deleting their account', () => {
  it("leaves what they typed on the organiser's card, hers now, and nothing else of theirs", async () => {
    const { ann, ben, outing, cells } = await guestOnTheCard('stay');
    expect(await cells()).toEqual(typedCells(ben));
    const { error: logError } = await admin.from('mutations').insert({
      id: `${RUN}stay-log`,
      outing_id: outing.id,
      kind: 'score',
      key: 'score:p:0',
      at: 1,
      device_id: 'bens-phone',
      user_id: ben.id,
    });
    expect(logError).toBeNull();

    await deleteAccount(PASSWORD);

    expect(await cells()).toEqual(typedCells(ann));
    expect(await rowsHeldBy(ben)).toBe(0);
    const { data: members } = await admin.from('outing_members').select('user_id').eq('outing_id', outing.id);
    expect(members).toEqual([{ user_id: ann.id }]);
    await signOut();
    await expect(signInWithPassword(ben.email, PASSWORD)).rejects.toThrow('do not match an account');
  });

  it("leaves the organiser's phone syncing, with the card still adding up", async () => {
    const { ann, ben, before, card, cells } = await guestOnTheCard('sync');
    await signInAs(ann);
    const lastPull = await pullSharedOutings();
    const annPhone = mergeShared(before, fromRows(lastPull));
    const contact = await reconcile(toRows(annPhone));
    if (contact.status !== 'pushed') throw new Error(contact.status);

    await deleteFromAnotherPhone(ben);

    // A running session's next push, still holding the pull from before he left.
    const own = await pushChanges(toRows(annPhone), contact.own, lastPull);
    const pull = await pullSharedOutings();
    const merged = mergeShared(annPhone, fromRows(pull));
    await pushChanges(toRows(merged), own, pull);
    // And first contact, as after the app restarts.
    await expect(reconcile(toRows(merged))).resolves.toMatchObject({ status: 'pushed', deleted: 0 });

    expect(await cells()).toEqual(typedCells(ann));
    const shown = fromRows(await pullSharedOutings()).rounds.find((r) => r.id === card.id)!;
    expect(shown.scores).toEqual(card.scores);
    expect(shown.junk).toEqual(card.junk);
  });

  it("reaches an organiser's phone that hadn't seen those cells, rather than being pruned by it", async () => {
    const { ann, day, before, card, cells } = await guestOnTheCard('unseen');
    await deleteAccount(PASSWORD);
    await signInAs(ann);

    const contact = await reconcile(toRows(before));
    if (contact.status !== 'pushed') throw new Error(contact.status);

    expect(contact.deleted).toBe(0);
    expect(await cells()).toEqual(typedCells(ann));
    // The blank box on this phone didn't go up over what he typed there.
    const { data: box } = await admin.from('scores').select('strokes').match({ round_id: card.id, player_id: day.playerIds[0], hole: 16 }).single();
    expect(box).toEqual({ strokes: 5 });

    // The next push and merge, as useDataSync runs them after first contact.
    const own = await pushChanges(toRows(before), contact.own, contact.shared);
    const pull = await pullSharedOutings();
    const merged = mergeShared(before, fromRows(pull));
    const shown = merged.rounds.find((r) => r.id === card.id)!;
    expect(shown.scores).toEqual(card.scores);
    expect(shown.junk).toEqual(card.junk);

    await pushChanges(toRows(merged), own, pull);
    expect(await cells()).toEqual(typedCells(ann));
  });

  it('takes a round of their own on her group and course with them, and leaves her season alone', async () => {
    const { ann, ben, day, cells } = await guestOnTheCard('replay');
    const { error: rematchError } = await getSupabase()!.from('rounds').insert({
      id: `${RUN}guest-rematch`,
      group_id: day.groupId,
      course_id: day.courseId,
      name: 'Rematch',
      started_at: 1,
    });
    expect(rematchError).toBeNull();
    const annHolds = await rowsHeldBy(ann);

    await deleteAccount(PASSWORD);

    expect(await rowsHeldBy(ben)).toBe(0);
    const { data } = await admin.from('rounds').select('id').eq('id', `${RUN}guest-rematch`);
    expect(data).toEqual([]);
    // Hers as before, and the two cells he typed.
    expect(await rowsHeldBy(ann)).toBe(annHolds + 2);
    expect((await cells()).score?.owner_id).toBe(ann.id);
  });

  it('can also organise a shared outing: what they typed stays with her, and their guest is told', async () => {
    const { ann, ben, cells } = await guestOnTheCard('both');
    const own = demoDocuments(`${RUN}bothben`);
    await pushSnapshot(toRows(own));
    const { joinCode } = await hostOuting(own.outings[0].id);
    const cal = await signUp('cal');
    await joinOuting(joinCode, null, 'Cal');
    await signInAs(ben);

    await deleteAccount(PASSWORD);

    expect(await rowsHeldBy(ben)).toBe(0);
    expect(await cells()).toEqual(typedCells(ann));
    await signInAs(cal);
    expect(await pullMoveNotices()).toContainEqual(expect.objectContaining({ kind: 'outing', from_id: own.outings[0].id, to_id: null }));
    await signOut();
  });

  it("refuses a guest with any other row of theirs under her day, since it can't just go", async () => {
    const { ben, day, cells } = await guestOnTheCard('older');
    // The policies refuse this now, but a build from before them could have written it.
    const { error: olderError } = await admin
      .from('course_hole_notes')
      .upsert({ course_id: day.courseId, number: 17, text: 'From an older build.', owner_id: ben.id }, { onConflict: 'course_id,number' });
    expect(olderError).toBeNull();
    const benHolds = await rowsHeldBy(ben);

    await expect(deleteAccount(PASSWORD)).rejects.toThrow(REFUSED);

    expect(await rowsHeldBy(ben)).toBe(benHolds);
    expect((await cells()).score?.owner_id).toBe(ben.id);
  });

  it("can't have her day put back by a second phone still signed in to them", async () => {
    const { ann, ben, benPhone, cells } = await guestOnTheCard('second');
    const annHolds = await rowsHeldBy(ann);
    await deleteFromAnotherPhone(ben);

    await expect(reconcile(toRows(benPhone))).rejects.toThrow('row-level security');

    expect(await rowsHeldBy(ben)).toBe(0);
    expect(await rowsHeldBy(ann)).toBe(annHolds + 2);
    expect((await cells()).junk?.owner_id).toBe(ann.id);
  });
});

describe('an organiser deleting their account', () => {
  it('takes the whole day off the server, under every account', async () => {
    const { ann, ben, outing, before, benPhone, joinCode } = await guestOnTheCard('whole');
    const { error: logError } = await admin.from('mutations').insert({
      id: `${RUN}whole-log`,
      outing_id: outing.id,
      kind: 'score',
      key: 'score:p:0',
      at: 1,
      device_id: 'bens-phone',
      user_id: ben.id,
    });
    expect(logError).toBeNull();
    // A round of his in her outing, as a build from before the policies could have written.
    const { error: olderError } = await admin.from('rounds').insert({
      id: `${RUN}whole-older`,
      group_id: outing.groupId,
      course_id: outing.courseId,
      outing_id: outing.id,
      name: 'Older',
      started_at: 1,
      owner_id: ben.id,
    });
    expect(olderError).toBeNull();
    const cal = await signUp('cal');
    await joinOuting(joinCode, null, 'Cal');
    const day = dayOf(outing, [...before.rounds, ...benPhone.rounds]);
    expect(await dayLeft(day)).toBeGreaterThan(0);

    await signInAs(ann);
    await deleteAccount(PASSWORD);

    expect(await dayLeft(day)).toBe(0);
    const { data: older } = await admin.from('rounds').select('id').eq('id', `${RUN}whole-older`);
    expect(older).toEqual([]);
    for (const account of [ann, ben, cal]) expect(await rowsHeldBy(account)).toBe(0);
    await signOut();
    await expect(signInWithPassword(ann.email, PASSWORD)).rejects.toThrow('do not match an account');
  });

  it("leaves two guests' phones holding the day and syncing, in a running session and after a restart", async () => {
    const { ann, ben, outing, day, card, benPhone, joinCode } = await guestOnTheCard('guests');
    const benSide = await joinedPhone(benPhone);
    const cal = await signUp('cal');
    const season = demoDocuments(`${RUN}guestscal`);
    await pushSnapshot(toRows(season));
    const calHolds = await rowsHeldBy(cal);
    await joinOuting(joinCode, null, 'Cal');
    const calSide = await joinedPhone(season);
    await deleteFromAnotherPhone(ann);

    for (const [account, holds, side] of [
      [ben, 0, benSide],
      [cal, calHolds, calSide],
    ] as const) {
      await signInAs(account);
      // The next push in a running session, still holding the pull from before she left.
      const moved = applyMoveNotices(side.phone, await pullMoveNotices());
      const own = await pushChanges(toRows(moved), side.own, side.lastPull);
      const pull = await pullSharedOutings();
      const again = applyMoveNotices(mergeShared(moved, fromRows(pull)), await pullMoveNotices());
      expect(again).toEqual(moved);
      await pushChanges(toRows(again), own, pull);
      // And first contact, as after the app restarts.
      const restarted = applyMoveNotices(moved, await pullMoveNotices());
      expect(restarted).toBe(moved);
      await reconcile(toRows(restarted));

      // The day is still here to read, with what this phone knew of it.
      const kept = moved.outings.find((o) => o.id === outing.id)!;
      expect(kept.detached).toBe(true);
      expect(Object.values(moved.rounds.find((r) => r.id === day.id)!.scores)).toEqual(Object.values(card.scores));
      expect(moved.groups.find((g) => g.id === kept.groupId)!.phoneOnly).toBe(true);
      expect(moved.courses.find((c) => c.id === kept.courseId)!.phoneOnly).toBe(true);
      // None of it went back.
      expect(await rowsHeldBy(account)).toBe(holds);
    }

    expect(await dayLeft(dayOf(outing, benPhone.rounds))).toBe(0);
  });

  it("gives each guest ids of their own, and shows nobody else's notices", async () => {
    const { ann, ben, outing, benPhone, joinCode } = await guestOnTheCard('apart');
    const cal = await signUp('cal');
    await joinOuting(joinCode, null, 'Cal');
    const calPhone = mergeShared(NOTHING, fromRows(await pullSharedOutings()));
    await deleteFromAnotherPhone(ann);

    const movedGroup = (phone: Documents) => phone.outings.find((o) => o.id === outing.id)!.groupId;
    const calMoved = applyMoveNotices(calPhone, await pullMoveNotices());
    await signInAs(ben);
    const benMoved = applyMoveNotices(benPhone, await pullMoveNotices());

    expect(movedGroup(benMoved)).not.toBe(outing.groupId);
    expect(movedGroup(calMoved)).not.toBe(outing.groupId);
    expect(movedGroup(benMoved)).not.toBe(movedGroup(calMoved));

    const client = getSupabase()!;
    const { data: theirs } = await client.from('move_notices').select('*').eq('user_id', cal.id);
    expect(theirs).toEqual([]);
    const { error } = await client.from('move_notices').insert({ kind: 'outing', from_id: 'mine', to_id: null });
    expect(error?.code).toBe('42501');
  });

  it("catches up a guest who was offline, keeping what they entered, and never sends her day back", async () => {
    const { ann, ben, outing, card, benPhone } = await guestOnTheCard('offline');
    const side = await joinedPhone(benPhone);
    // On the back nine with no signal: another score on her card, and a round of his own on her course.
    const scorer = card.playerIds[1];
    const later = [...card.scores[scorer]];
    later[0] = 9;
    const edited = { ...card, scores: { ...card.scores, [scorer]: later } };
    const rematch = { ...card, id: `${RUN}offline-rematch`, outingId: null, name: 'Rematch', presses: [], wolfPicks: [] };
    const offline: Documents = {
      ...side.phone,
      rounds: [...side.phone.rounds.map((r) => (r.id === card.id ? edited : r)), rematch],
    };
    await deleteFromAnotherPhone(ann);

    const moved = applyMoveNotices(offline, await pullMoveNotices());
    const own = await pushChanges(toRows(moved), side.own, side.lastPull);
    await pushChanges(toRows(moved), own, await pullSharedOutings());

    // The card as he left it, under his ids.
    const newScorer = moved.rounds.find((r) => r.id === card.id)!.playerIds[1];
    expect(moved.rounds.find((r) => r.id === card.id)!.scores[newScorer][0]).toBe(9);

    // His own round went up on his own copy, and nothing of her day came back.
    const kept = moved.rounds.find((r) => r.id === rematch.id)!;
    expect(kept.courseId).not.toBe(card.courseId);
    const { data } = await admin.from('rounds').select('owner_id, group_id, course_id').eq('id', rematch.id).single();
    expect(data).toEqual({ owner_id: ben.id, group_id: kept.groupId, course_id: kept.courseId });
    const { data: copy } = await admin.from('courses').select('owner_id').eq('id', kept.courseId).single();
    expect(copy).toEqual({ owner_id: ben.id });
    expect(await dayLeft(dayOf(outing, benPhone.rounds))).toBe(0);
  });

  it("leaves nothing of a moved group and course on the server while nothing of the guest's uses them", async () => {
    const { ann, ben, outing, benPhone } = await guestOnTheCard('quiet');
    const side = await joinedPhone(benPhone);
    await deleteFromAnotherPhone(ann);

    const moved = applyMoveNotices(side.phone, await pullMoveNotices());
    await pushChanges(toRows(moved), side.own, side.lastPull);

    const kept = moved.outings.find((o) => o.id === outing.id)!;
    const { data: groups } = await admin.from('groups').select('id').eq('id', kept.groupId);
    const { data: courses } = await admin.from('courses').select('id').eq('id', kept.courseId);
    expect(groups).toEqual([]);
    expect(courses).toEqual([]);
    expect(await rowsHeldBy(ben)).toBe(0);
  });

  it('drops the notices with the guest, if the guest deletes too', async () => {
    const { ann, ben } = await guestOnTheCard('both-gone');
    await deleteFromAnotherPhone(ann);
    await signInAs(ben);
    expect((await pullMoveNotices()).length).toBeGreaterThan(0);

    await deleteAccount(PASSWORD);

    const { data } = await admin.from('move_notices').select('kind').eq('user_id', ben.id);
    expect(data).toEqual([]);
    await signOut();
    await expect(signInWithPassword(ben.email, PASSWORD)).rejects.toThrow('do not match an account');
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
    ['groups', { id: `${RUN}gone-g`, name: 'Gone', created_at: 1 }],
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
    const {
      data: { subscription },
    } = getSupabase()!.auth.onAuthStateChange((event) => {
      events.push(event);
    });

    // The client keeps a session whose access token still works, so this only
    // happens once the token runs out, up to an hour after the deletion.
    await expireStoredSession();

    expect(await currentUserId()).toBeNull();
    subscription.unsubscribe();
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
