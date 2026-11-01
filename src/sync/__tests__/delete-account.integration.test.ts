import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import type { Outing, Round } from '../../domain/types';
import { mergeShared } from '../merge-shared';
import { applyMoveNotices, followMoveNotices, keepingPhoneOnly } from '../move-notices';
import { pullMoveNotices, pullSharedOutings, pullSnapshot, pushChanges, pushSnapshot, reconcile } from '../remote';
import { TABLES, fromRows, toRows, type Documents, type Snapshot } from '../rows';
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

/** What a phone holds between pushes. */
type Side = { phone: Documents; own: Snapshot; lastPull: Snapshot };

/** One debounced push and the pull after it, as `useDataSync` runs them. */
async function syncOnce(side: Side): Promise<Side> {
  const notices = await pullMoveNotices();
  let held = side.phone;
  if (applyMoveNotices(held, notices) !== held) {
    ({ held } = followMoveNotices(held, notices, fromRows(await pullSharedOutings())));
  }
  let own: Snapshot;
  if (held === side.phone) {
    own = await pushChanges(toRows(held), side.own, side.lastPull);
  } else {
    // Every id moved, so what it last pushed says nothing: as first contact.
    const local = toRows(held);
    const contact = await reconcile(local);
    if (contact.status === 'adopted-remote') {
      held = keepingPhoneOnly(held, fromRows(contact.snapshot));
      own = contact.snapshot;
    } else {
      own = contact.status === 'pushed' ? contact.own : local;
    }
  }
  const lastPull = await pullSharedOutings();
  return { phone: mergeShared(held, fromRows(lastPull)), own, lastPull };
}

/**
 * A round of a guest's own on the day's group and course, with a row in every
 * table that names a player or a tee.
 */
function rematchOf(day: Round, tees: string[], id: string): Round {
  const [a, b, c, d] = day.playerIds;
  return {
    ...day,
    id,
    outingId: null,
    name: 'Rematch',
    teeId: tees[0],
    playerTees: { [c]: tees[tees.length - 1] },
    handicapTees: { [a]: tees[0] },
    pops: { [a]: 1, [b]: 2, [c]: 3, [d]: 4 },
    scores: { [a]: [4, 5, null], [b]: [5, 6, null], [c]: [6, 7, null], [d]: [7, 8, null] },
    junk: { [`0:${a}:sandie`]: true },
    pickups: { [`1:${b}`]: true },
    presses: [{ id: `${id}-press`, by: a, against: b, startHole: 1, endHole: 4, stake: 100 }],
    wolfPicks: [{ hole: 0, wolf: a, partner: b }],
    options: { ...day.options, teams: [[a, b], [c, d]], matchPairings: [[a, c], [b, d]] },
  };
}

/** A guest's phone holding the shared day and a rematch on it, both up. */
async function withRematch(holding: Documents, day: Round, id: string) {
  const merged = mergeShared(holding, fromRows(await pullSharedOutings()));
  const course = merged.courses.find((c) => c.id === day.courseId)!;
  const rematch = rematchOf(day, course.tees.map((t) => t.id), id);
  return { ...(await joinedPhone({ ...merged, rounds: [...merged.rounds, rematch] })), rematch };
}

/** A guest's phone with a shared outing of their own on the day's group and course. Its card is a rematch. */
async function withOwnOuting(holding: Documents, outing: Outing, day: Round, prefix: string) {
  const merged = mergeShared(holding, fromRows(await pullSharedOutings()));
  const shared = merged.outings.find((o) => o.id === outing.id)!;
  const course = merged.courses.find((c) => c.id === day.courseId)!;
  const id = `${RUN}${prefix}-own`;
  const round = { ...rematchOf(day, course.tees.map((t) => t.id), `${RUN}${prefix}-round`), outingId: id };
  const own: Outing = {
    ...shared,
    id,
    name: 'On her group',
    field: round.playerIds,
    fieldGames: {
      fieldSkins: { ...shared.fieldGames.fieldSkins, entrants: round.playerIds },
      scats: { ...shared.fieldGames.scats, entrants: round.playerIds.slice(0, 2) },
    },
    roundIds: [round.id],
  };
  const side = await joinedPhone({ ...merged, outings: [...merged.outings, own], rounds: [...merged.rounds, round] });
  const { joinCode } = await hostOuting(id);
  return { side, round, own, id, joinCode };
}

/**
 * Ann's day with a player on her roster who isn't in it, and Ben, who joined it,
 * holding a rematch on her group and course. Ben is left signed in.
 */
async function guestWithRematch(prefix: string) {
  const shared = await guestOnTheCard(prefix);
  const { ann, outing, day, benPhone } = shared;
  const unseen = `${RUN}${prefix}-unseen`;
  const { error } = await admin.from('players').insert({
    id: unseen,
    owner_id: ann.id,
    group_id: outing.groupId,
    name: 'Not In It',
    initials: 'NI',
    color: '#000000',
    sort_order: 99,
  });
  expect(error).toBeNull();
  const benSide = await withRematch(benPhone, day, `${RUN}${prefix}-ben`);
  return { ...shared, unseen, benSide };
}

/**
 * Ann's season, and Ben with a round of his own on her group and course, who
 * joined nothing: the row itself is all that says the two share anything. It
 * names one of her players. Ben is left signed in.
 */
async function rematchWithoutJoining(prefix: string) {
  const ann = await signUp('ann');
  const season = demoDocuments(`${RUN}${prefix}`);
  await pushSnapshot(toRows(season));
  const outing = season.outings[0];
  const ben = await signUp('ben');
  const id = `${RUN}${prefix}-round`;
  const { error } = await admin.from('rounds').insert({
    id,
    group_id: outing.groupId,
    course_id: outing.courseId,
    name: 'Rematch',
    started_at: 1,
    owner_id: ben.id,
  });
  expect(error).toBeNull();
  const player = season.groups.find((g) => g.id === outing.groupId)!.players[0];
  const { error: playerError } = await admin.from('round_players').insert({ round_id: id, player_id: player.id, tee_order: 0, owner_id: ben.id });
  expect(playerError).toBeNull();
  return { ann, ben, outing, id, player };
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

    // Nor can anyone ask who else holds rows on an account's group or course.
    const { error: heldError } = await getSupabase()!.rpc('kept_by_others', { target: ann.id });
    expect(heldError?.code).toBe('42501');

    expect(await rowsHeldBy(ann)).toBe(before);
  });
});

describe('a third account in a guest\'s outing on a deleted organiser\'s group', () => {
  /** Ben's outing on Ann's group and course, with Cal in it, who has a season and a rematch of their own and typed on Ben's card. Cal is left signed in. */
  async function thirdAccount(prefix: string) {
    const { ann, ben, outing, day, benPhone } = await guestOnTheCard(prefix);
    const bens = await withOwnOuting(benPhone, outing, day, prefix);
    const cal = await signUp('cal');
    const season = demoDocuments(`${RUN}${prefix}cal`);
    await pushSnapshot(toRows(season));
    await joinOuting(bens.joinCode, null, 'Cal');
    const joined = await withRematch(season, bens.round, `${RUN}${prefix}-cal`);
    const scorer = bens.round.playerIds[3];
    const typed = { ...bens.round, scores: { ...bens.round.scores, [scorer]: [7, 8, 6, 3] } };
    const calSide = await syncOnce({ ...joined, phone: { ...joined.phone, rounds: joined.phone.rounds.map((r) => (r.id === typed.id ? typed : r)) } });
    return { ann, ben, cal, outing, day, bens, calSide, rematch: joined.rematch, season, scorer };
  }

  it('keeps syncing, on the guest\'s copy, and takes the server\'s card before it next pushes', async () => {
    const { ann, ben, cal, outing, day, bens, calSide, rematch, season } = await thirdAccount('third');
    // On the back nine: an edit that hasn't gone up. It's the one thing this case accepts losing.
    const unsent = {
      ...calSide,
      phone: {
        ...calSide.phone,
        rounds: calSide.phone.rounds.map((r) => (r.id === bens.round.id ? { ...r, scores: { ...r.scores, [r.playerIds[0]]: [99, 5, null] } } : r)),
      },
    };
    await deleteFromAnotherPhone(ann);

    const { data: onServer } = await admin.from('outings').select('group_id, course_id, owner_id').eq('id', bens.id).single();
    expect(onServer!.owner_id).toBe(ben.id);
    expect(onServer!.group_id).not.toBe(outing.groupId);

    let now: Side = unsent;
    for (let i = 0; i < 3; i += 1) now = await syncOnce(now);
    await expect(reconcile(toRows(now.phone))).resolves.toMatchObject({ status: 'pushed' });

    // The outing as Ben has it, on Ben's copy.
    const kept = now.phone.outings.find((o) => o.id === bens.id)!;
    expect(kept.detached).toBeUndefined();
    expect(kept).toMatchObject({ groupId: onServer!.group_id, courseId: onServer!.course_id });
    expect(now.phone.groups.map((g) => g.id)).toContain(onServer!.group_id);
    expect(now.phone.courses.map((c) => c.id)).toContain(onServer!.course_id);

    // What Cal typed before she left is there, and what hadn't gone up isn't.
    const card = now.phone.rounds.find((r) => r.id === bens.round.id)!;
    expect(card.scores[card.playerIds[3]]).toEqual([7, 8, 6, 3]);
    expect(card.scores[card.playerIds[0]]).toEqual([4, 5, null]);
    const { data: cell } = await admin.from('scores').select('strokes, owner_id').match({ round_id: card.id, player_id: card.playerIds[3], hole: 3 }).single();
    expect(cell).toEqual({ strokes: 3, owner_id: cal.id });
    const { data: stale } = await admin.from('scores').select('strokes').match({ round_id: card.id, hole: 0 }).eq('strokes', 99);
    expect(stale).toEqual([]);

    // Cal's own rematch is on Cal's own copy, not Ben's and not hers.
    const own = now.phone.rounds.find((r) => r.id === rematch.id)!;
    expect(own.groupId).not.toBe(outing.groupId);
    expect(own.groupId).not.toBe(onServer!.group_id);
    const { data: copy } = await admin.from('groups').select('owner_id').eq('id', own.groupId).single();
    expect(copy).toEqual({ owner_id: cal.id });

    // And the rest of Cal's season hasn't moved.
    for (const group of season.groups) expect(now.phone.groups.map((g) => g.id)).toContain(group.id);
    for (const round of season.rounds) expect(now.phone.rounds.find((r) => r.id === round.id)?.groupId).toBe(round.groupId);

    expect(await dayLeft(dayOf(outing, [day]))).toBe(0);
  });

  it("keeps the guest who hosts it syncing, with one copy of the group, their unsent score, and the score their phone hadn't seen", async () => {
    const { ann, ben, bens, calSide, scorer } = await thirdAccount('hosting');
    expect(calSide.phone.rounds.find((r) => r.id === bens.round.id)!.scores[scorer]).toEqual([7, 8, 6, 3]);
    // Ben's phone still has the box Cal typed in as blank, and a score of Ben's that hasn't gone up.
    const other = bens.round.playerIds[1];
    const offline = { ...bens.round, scores: { ...bens.round.scores, [other]: [5, 6, 9] } };
    await signInAs(ben);
    await deleteFromAnotherPhone(ann);

    let now: Side = { ...bens.side, phone: { ...bens.side.phone, rounds: bens.side.phone.rounds.map((r) => (r.id === offline.id ? offline : r)) } };
    for (let i = 0; i < 3; i += 1) now = await syncOnce(now);
    await expect(reconcile(toRows(now.phone))).resolves.toMatchObject({ status: 'pushed' });

    const ids = (items: { id: string }[]) => items.map((item) => item.id);
    expect(new Set(ids(now.phone.groups)).size).toBe(now.phone.groups.length);
    expect(new Set(ids(now.phone.courses)).size).toBe(now.phone.courses.length);

    const card = now.phone.rounds.find((r) => r.id === bens.round.id)!;
    const cell = async (index: number, hole: number) =>
      (await admin.from('scores').select('strokes').match({ round_id: card.id, player_id: card.playerIds[index], hole }).single()).data;
    expect(await cell(1, 2)).toEqual({ strokes: 9 });
    expect(await cell(3, 2)).toEqual({ strokes: 6 });
    expect(await cell(3, 3)).toEqual({ strokes: 3 });
    expect(card.scores[card.playerIds[1]]).toEqual([5, 6, 9]);
    expect(card.scores[card.playerIds[3]]).toEqual([7, 8, 6, 3]);
  });

  it("leaves a third account's copy alone when it needs none, and its notices are its own", async () => {
    const { ann, outing, day, benPhone } = await guestOnTheCard('third-none');
    const bens = await withOwnOuting(benPhone, outing, day, 'third-none');
    const dee = await signUp('dee');
    await joinOuting(bens.joinCode, null, 'Dee');
    const side = await joinedPhone();
    await deleteFromAnotherPhone(ann);

    let now: Side = side;
    for (let i = 0; i < 2; i += 1) now = await syncOnce(now);

    expect(await rowsHeldBy(dee)).toBe(1);
    expect(now.phone.outings.find((o) => o.id === bens.id)?.detached).toBeUndefined();
    const { data: serverOuting } = await admin.from('outings').select('group_id').eq('id', bens.id).single();
    const { data: notice } = await admin.from('move_notices').select('to_id').match({ user_id: dee.id, kind: 'group', from_id: outing.groupId }).single();
    expect(notice!.to_id).not.toBe(serverOuting!.group_id);
  });

  it("moves a round of someone's in a guest's outing onto the guest's copy, member or not", async () => {
    const { ann, ben, outing, day, benPhone } = await guestOnTheCard('third-card');
    const bens = await withOwnOuting(benPhone, outing, day, 'third-card');
    const dee = await signUp('dee');
    const older = `${RUN}third-card-dee`;
    const { error: roundError } = await admin.from('rounds').insert({
      id: older,
      group_id: outing.groupId,
      course_id: outing.courseId,
      outing_id: bens.id,
      name: 'Older',
      started_at: 1,
      owner_id: dee.id,
    });
    expect(roundError).toBeNull();
    await deleteFromAnotherPhone(ann);

    const { data: theirs } = await admin.from('outings').select('group_id').eq('id', bens.id).single();
    const { data: round } = await admin.from('rounds').select('owner_id, group_id, outing_id').eq('id', older).single();
    expect(round).toEqual({ owner_id: dee.id, group_id: theirs!.group_id, outing_id: bens.id });
    const { data: group } = await admin.from('groups').select('owner_id').eq('id', theirs!.group_id).single();
    expect(group).toEqual({ owner_id: ben.id });
  });
});

describe("an organiser with an outing on someone else's group", () => {
  /** Ben's outing on Ann's group and course, with Cal in it, who holds a rematch there too. Cal is left signed in. */
  async function outingOnHers(prefix: string) {
    const { ann, ben, outing, day, benPhone } = await guestOnTheCard(prefix);
    const bens = await withOwnOuting(benPhone, outing, day, prefix);
    const cal = await signUp('cal');
    await joinOuting(bens.joinCode, null, 'Cal');
    const calSide = await withRematch(NOTHING, bens.round, `${RUN}${prefix}-cal`);
    return { ann, ben, cal, outing, day, bens, calSide };
  }

  it('takes the day off the server, leaves the owner alone, and the guest keeps a copy and keeps syncing', async () => {
    const { ann, ben, cal, outing, bens, calSide } = await outingOnHers('theirs');
    const annHolds = await rowsHeldBy(ann);
    await deleteFromAnotherPhone(ben);

    let now: Side = calSide;
    for (let i = 0; i < 3; i += 1) now = await syncOnce(now);
    await expect(reconcile(toRows(now.phone))).resolves.toMatchObject({ status: 'pushed' });

    expect(now.phone.outings.find((o) => o.id === bens.id)?.detached).toBe(true);
    const { data: gone } = await admin.from('outings').select('id').eq('id', bens.id);
    expect(gone).toEqual([]);

    // Her group is hers, untouched, and nothing of it went up under Cal.
    const { data: group } = await admin.from('groups').select('owner_id').eq('id', outing.groupId).single();
    expect(group).toEqual({ owner_id: ann.id });

    // Cal's rematch moves to a copy of Cal's own, which is all Cal has up there.
    const rematch = now.phone.rounds.find((r) => r.id === calSide.rematch.id)!;
    expect(rematch.groupId).not.toBe(outing.groupId);
    const { data: copy } = await admin.from('rounds').select('owner_id, group_id').eq('id', rematch.id).single();
    expect(copy).toEqual({ owner_id: cal.id, group_id: rematch.groupId });
    await signInAs(ann);
    expect(await rowsHeldBy(ann)).toBeGreaterThanOrEqual(annHolds);
  });

  it("tells the group's owner only that the outing went, if she'd joined it", async () => {
    const { ann, ben, outing, bens } = await outingOnHers('joined');
    await signInAs(ann);
    await joinOuting(bens.joinCode, null, 'Ann');
    await deleteFromAnotherPhone(ben);

    const notices = await pullMoveNotices();
    expect(notices).toEqual([expect.objectContaining({ kind: 'outing', from_id: bens.id, to_id: null })]);
    expect(notices.map((n) => n.from_id)).not.toContain(outing.groupId);
  });

  it("doesn't let the notice move her group when the guest later joins another outing on it", async () => {
    const { ann, ben, cal, outing, day, bens, calSide } = await outingOnHers('held-again');
    await deleteFromAnotherPhone(ben);
    let now: Side = await syncOnce(calSide);

    // Ann shares another day on the same group, and Cal joins it.
    await signInAs(ann);
    const second = {
      id: `${RUN}held-again-second`,
      group_id: outing.groupId,
      course_id: outing.courseId,
      name: 'Another day',
      date: 2,
      started_at: 2,
    };
    const { error: secondError } = await getSupabase()!.from('outings').insert(second);
    expect(secondError).toBeNull();
    const { error: fieldError } = await getSupabase()!.from('outing_field').insert({ outing_id: second.id, player_id: day.playerIds[0], sort_order: 0 });
    expect(fieldError).toBeNull();
    const { joinCode } = await hostOuting(second.id);
    await signInAs(cal);
    await joinOuting(joinCode, null, 'Cal');

    for (let i = 0; i < 3; i += 1) now = await syncOnce(now);
    await expect(reconcile(toRows(now.phone))).resolves.toMatchObject({ status: 'pushed' });

    const held = now.phone.outings.find((o) => o.id === second.id)!;
    expect(held.groupId).toBe(outing.groupId);
    expect(held.field).toEqual([day.playerIds[0]]);
    expect(now.phone.groups.filter((g) => g.id === outing.groupId)).toHaveLength(1);
    // The day from before stays moved, and detached.
    const before = now.phone.outings.find((o) => o.id === bens.id)!;
    expect(before.detached).toBe(true);
    expect(before.groupId).not.toBe(outing.groupId);
  });

  it("takes someone's round in it with the day, member or not", async () => {
    const { ben, outing, bens } = await outingOnHers('theirs-round');
    const dee = await signUp('dee');
    const older = `${RUN}theirs-round-dee`;
    const { error } = await admin.from('rounds').insert({
      id: older,
      group_id: outing.groupId,
      course_id: outing.courseId,
      outing_id: bens.id,
      name: 'Older',
      started_at: 1,
      owner_id: dee.id,
    });
    expect(error).toBeNull();

    await deleteFromAnotherPhone(ben);

    const { data } = await admin.from('rounds').select('id').eq('id', older);
    expect(data).toEqual([]);
    expect(await pullMoveNotices()).toContainEqual(expect.objectContaining({ kind: 'outing', from_id: bens.id }));
  });
});

describe('rows older builds could write under someone else', () => {
  it("hands what the departing account wrote under someone else's to them, and takes its own round from their outing", async () => {
    const { ann, ben, day, outing, card, cells } = await guestOnTheCard('older');
    const presser = day.playerIds[0];
    const inserts: [string, Record<string, unknown>][] = [
      ['course_hole_notes', { course_id: day.courseId, number: 17, text: 'From an older build.', owner_id: ben.id }],
      ['presses', { id: `${RUN}older-press`, round_id: card.id, by_player: presser, against_player: presser, start_hole: 1, end_hole: 2, stake: 1, owner_id: ben.id }],
      ['players', { id: `${RUN}older-player`, group_id: day.groupId, name: 'Added By Ben', initials: 'AB', color: '#000000', owner_id: ben.id }],
      ['rounds', { id: `${RUN}older-round`, group_id: day.groupId, course_id: day.courseId, outing_id: outing.id, name: 'Older', started_at: 1, owner_id: ben.id }],
    ];
    for (const [table, row] of inserts) {
      const { error } = await admin.from(table).insert(row);
      expect(error).toBeNull();
    }

    await deleteAccount(PASSWORD);

    expect(await rowsHeldBy(ben)).toBe(0);
    expect(await cells()).toEqual(typedCells(ann));
    for (const [table, match] of [
      ['course_hole_notes', { course_id: day.courseId, number: 17 }],
      ['presses', { id: `${RUN}older-press` }],
      ['players', { id: `${RUN}older-player` }],
    ] as const) {
      const { data } = await admin.from(table).select('owner_id').match(match).single();
      expect(data).toEqual({ owner_id: ann.id });
    }
    const { data: round } = await admin.from('rounds').select('id').eq('id', `${RUN}older-round`);
    expect(round).toEqual([]);
  });

  it("copies a guest's own row on her course and roster when their rows stay, and lets it go when none do", async () => {
    const stays = await guestWithRematch('older-stays');
    const leaves = await sharedDay('older-leaves');
    const rows = (who: Account, day: { groupId: string; courseId: string }, id: string): [string, Record<string, unknown>][] => [
      ['course_hole_notes', { course_id: day.courseId, number: 17, text: 'From an older build.', owner_id: who.id }],
      ['players', { id, group_id: day.groupId, name: `Added ${id}`, initials: 'AB', color: '#000000', owner_id: who.id }],
    ];
    const staying = `${RUN}older-stays-player`;
    const leaving = `${RUN}older-leaves-player`;
    for (const [table, row] of [...rows(stays.ben, stays.outing, staying), ...rows(leaves.ben, leaves.outing, leaving)]) {
      const { error } = await admin.from(table).upsert(row);
      expect(error).toBeNull();
    }

    await deleteFromAnotherPhone(stays.ann);
    await deleteFromAnotherPhone(leaves.ann);

    const { data: copied } = await admin.from('players').select('owner_id').eq('name', `Added ${staying}`).single();
    expect(copied).toEqual({ owner_id: stays.ben.id });
    const { data: note } = await admin.from('course_hole_notes').select('owner_id').eq('text', 'From an older build.').eq('owner_id', stays.ben.id);
    expect(note!.length).toBeGreaterThanOrEqual(1);
    const { data: gone } = await admin.from('players').select('id').eq('name', `Added ${leaving}`);
    expect(gone).toEqual([]);
    expect(await rowsHeldBy(leaves.ben)).toBe(0);
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

  it('tells someone with a round in the outing who is no longer a member, and takes the round', async () => {
    const { ann, outing } = await sharedDay('left');
    const dee = await signUp('dee');
    const round = {
      id: `${RUN}left-round`,
      group_id: outing.groupId,
      course_id: outing.courseId,
      outing_id: outing.id,
      name: 'Older',
      started_at: 1,
      owner_id: dee.id,
    };
    const { error } = await admin.from('rounds').insert(round);
    expect(error).toBeNull();

    await deleteFromAnotherPhone(ann);

    expect(await pullMoveNotices()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'outing', from_id: outing.id, to_id: null }),
        expect.objectContaining({ kind: 'group', from_id: outing.groupId }),
      ]),
    );
    expect(await rowsHeldBy(dee)).toBe(0);
  });

  it('still deletes if the guest already has a notice about those ids', async () => {
    const { ann, ben, outing } = await sharedDay('again');
    const { error } = await admin
      .from('move_notices')
      .insert({ user_id: ben.id, kind: 'group', from_id: outing.groupId, to_id: 'from-before' });
    expect(error).toBeNull();

    await deleteFromAnotherPhone(ann);

    expect(await rowsHeldBy(ann)).toBe(0);
    expect(await pullMoveNotices()).toContainEqual(
      expect.objectContaining({ kind: 'group', from_id: outing.groupId, to_id: 'from-before' }),
    );
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

describe("a guest with rows of their own on a deleted organiser's group or course", () => {
  it('keeps two guests syncing, each on a copy of their own that the other cannot see', async () => {
    const { ann, ben, outing, day, joinCode, benSide, benPhone } = await guestWithRematch('hard');
    const cal = await signUp('cal');
    await joinOuting(joinCode, null, 'Cal');
    const calSide = await withRematch(NOTHING, day, `${RUN}hard-cal`);
    await deleteFromAnotherPhone(ann);

    const synced: Round[] = [];
    for (const [account, side] of [[ben, benSide], [cal, calSide]] as const) {
      await signInAs(account);
      let now: Side = side;
      for (let i = 0; i < 3; i += 1) now = await syncOnce(now);
      // And first contact, as after the app restarts.
      const contact = await reconcile(toRows(applyMoveNotices(now.phone, await pullMoveNotices())));
      expect(contact.status).toBe('pushed');

      const round = now.phone.rounds.find((r) => r.id === side.rematch.id)!;
      expect(round.groupId).not.toBe(outing.groupId);
      expect(round.courseId).not.toBe(outing.courseId);
      const { data } = await admin.from('rounds').select('owner_id, group_id, course_id').eq('id', round.id).single();
      expect(data).toEqual({ owner_id: account.id, group_id: round.groupId, course_id: round.courseId });
      for (const [table, id] of [['groups', round.groupId], ['courses', round.courseId]] as const) {
        const { data: copy } = await admin.from(table).select('owner_id').eq('id', id).single();
        expect(copy).toEqual({ owner_id: account.id });
      }
      synced.push(round);
    }

    expect(synced[0].groupId).not.toBe(synced[1].groupId);
    expect(synced[0].courseId).not.toBe(synced[1].courseId);
    expect(synced[0].playerIds).not.toEqual(synced[1].playerIds);

    // Cal is signed in. Nothing of Ben's is there to read.
    const client = getSupabase()!;
    for (const [table, id] of [['rounds', synced[0].id], ['groups', synced[0].groupId], ['courses', synced[0].courseId]] as const) {
      const { data } = await client.from(table).select('id').eq('id', id);
      expect(data).toEqual([]);
    }

    // Her day didn't come back under either of them.
    expect(await dayLeft(dayOf(outing, benPhone.rounds))).toBe(0);
    await signOut();
    await expect(signInWithPassword(ann.email, PASSWORD)).rejects.toThrow('do not match an account');
  });

  it("keeps two guests apart on a player and tee she removed, which their phones still hold and no notice names", async () => {
    const { ann, ben, outing, day, joinCode, benSide } = await guestWithRematch('removed');
    const cal = await signUp('cal');
    await joinOuting(joinCode, null, 'Cal');
    const calSide = await withRematch(NOTHING, day, `${RUN}removed-cal`);
    // A phone only ever adds a group or course it doesn't have, so neither hears of these.
    const removedPlayer = outing.field.find((id) => !day.playerIds.includes(id))!;
    const removedTee = benSide.rematch.playerTees[day.playerIds[2]];
    expect(removedTee).not.toBe(benSide.rematch.teeId);
    const { error: playerError } = await admin.from('players').delete().eq('id', removedPlayer);
    expect(playerError).toBeNull();
    const { error: teeError } = await admin.from('tees').delete().eq('id', removedTee);
    expect(teeError).toBeNull();
    await deleteFromAnotherPhone(ann);

    const held: { player: string; tee: string }[] = [];
    for (const [account, side] of [[ben, benSide], [cal, calSide]] as const) {
      await signInAs(account);
      let now: Side = side;
      for (let i = 0; i < 2; i += 1) now = await syncOnce(now);
      await expect(reconcile(toRows(now.phone))).resolves.toMatchObject({ status: 'pushed' });

      const round = now.phone.rounds.find((r) => r.id === side.rematch.id)!;
      const group = now.phone.groups.find((g) => g.id === round.groupId)!;
      const course = now.phone.courses.find((c) => c.id === round.courseId)!;
      const tee = round.playerTees[round.playerIds[2]];
      expect(course.tees.map((t) => t.id)).toContain(tee);
      const { data: rows } = await admin.from('round_players').select('tee_id').match({ round_id: round.id, player_id: round.playerIds[2] }).single();
      expect(rows).toEqual({ tee_id: tee });
      const player = group.players[outing.field.indexOf(removedPlayer)].id;
      for (const [table, id] of [['players', player], ['tees', tee]] as const) {
        const { data } = await admin.from(table).select('owner_id').eq('id', id).single();
        expect(data).toEqual({ owner_id: account.id });
      }
      held.push({ player, tee });
    }

    expect(held[0].player).not.toBe(held[1].player);
    expect(held[0].tee).not.toBe(held[1].tee);
    const { data: oldPlayer } = await admin.from('players').select('id').eq('id', removedPlayer);
    expect(oldPlayer).toEqual([]);
    const { data: oldTee } = await admin.from('tees').select('id').eq('id', removedTee);
    expect(oldTee).toEqual([]);
  });

  it('copies nothing for a guest who needs none', async () => {
    const { ann, joinCode } = await guestWithRematch('none');
    const cal = await signUp('cal');
    await joinOuting(joinCode, null, 'Cal');
    await deleteFromAnotherPhone(ann);

    expect(await rowsHeldBy(cal)).toBe(0);
    expect((await pullMoveNotices()).length).toBeGreaterThan(0);
  });

  it('agrees with the phone about every id, before the phone has sent anything', async () => {
    const { ann, benSide } = await guestWithRematch('agree');
    await deleteFromAnotherPhone(ann);

    const moved = applyMoveNotices(benSide.phone, await pullMoveNotices());
    const server = fromRows(await pullSnapshot());

    const round = moved.rounds.find((r) => r.id === benSide.rematch.id)!;
    expect(server.rounds).toEqual([round]);
    const { phoneOnly: _group, ...group } = moved.groups.find((g) => g.id === round.groupId)!;
    expect({ ...server.groups[0], players: [] }).toEqual({ ...group, players: [] });
    const { phoneOnly: _course, ...course } = moved.courses.find((c) => c.id === round.courseId)!;
    expect(server.courses).toEqual([course]);
  });

  it('copies the players they could read or their rows name, and the whole course', async () => {
    const { ann, ben, outing, unseen, benSide } = await guestWithRematch('copy');
    const { data: field } = await admin.from('outing_field').select('player_id').eq('outing_id', outing.id);
    const held = async (table: string) =>
      (await admin.from(table).select('*', { count: 'exact', head: true }).eq('course_id', outing.courseId)).count;
    const counts = {
      tees: await held('tees'),
      tee_holes: await held('tee_holes'),
      course_greens: await held('course_greens'),
      course_features: await held('course_features'),
      course_hole_notes: await held('course_hole_notes'),
    };
    for (const count of Object.values(counts)) expect(count).toBeGreaterThan(0);
    await deleteFromAnotherPhone(ann);

    const notices = await pullMoveNotices();
    const round = applyMoveNotices(benSide.phone, notices).rounds.find((r) => r.id === benSide.rematch.id)!;

    const { data: players } = await admin.from('players').select('id, owner_id').eq('group_id', round.groupId);
    const renamed = new Map(notices.filter((n) => n.kind === 'player').map((n) => [n.from_id, n.to_id]));
    expect(players!.map((p) => p.id).sort()).toEqual(field!.map((f) => renamed.get(f.player_id)).sort());
    expect(players!.every((p) => p.owner_id === ben.id)).toBe(true);
    // A notice is only an id. The name doesn't go with it.
    expect(renamed.has(unseen)).toBe(true);
    const { data: named } = await admin.from('players').select('id').eq('name', 'Not In It').eq('owner_id', ben.id);
    expect(named).toEqual([]);

    for (const [table, count] of Object.entries(counts)) {
      const { data: rows } = await admin.from(table).select('owner_id').eq('course_id', round.courseId);
      expect(rows).toHaveLength(count!);
      expect(rows!.every((row) => row.owner_id === ben.id)).toBe(true);
    }
  });

  it('keeps a round for someone in no outing of hers, with the one player it names', async () => {
    const { ann, ben, outing, id, player } = await rematchWithoutJoining('left');
    await deleteFromAnotherPhone(ann);

    const notices = await pullMoveNotices();
    expect(notices.map((n) => n.kind)).not.toContain('outing');
    const { data: round } = await admin.from('rounds').select('owner_id, group_id').eq('id', id).single();
    expect(round!.owner_id).toBe(ben.id);
    expect(round!.group_id).not.toBe(outing.groupId);
    const { data: players } = await admin.from('players').select('name, owner_id').eq('group_id', round!.group_id);
    expect(players).toEqual([{ name: player.name, owner_id: ben.id }]);
  });

  it('keeps a score entered offline during the deletion, on a round of their own', async () => {
    const { ann, benSide } = await guestWithRematch('offline-own');
    const { rematch } = benSide;
    const scorer = rematch.playerIds[0];
    const later = { ...rematch, scores: { ...rematch.scores, [scorer]: [4, 5, 9] } };
    const rounds = benSide.phone.rounds.map((r) => (r.id === later.id ? later : r));
    await deleteFromAnotherPhone(ann);

    const { phone } = await syncOnce({ ...benSide, phone: { ...benSide.phone, rounds } });

    const newScorer = phone.rounds.find((r) => r.id === rematch.id)!.playerIds[0];
    expect(newScorer).not.toBe(scorer);
    const { data } = await admin.from('scores').select('strokes').match({ round_id: rematch.id, player_id: newScorer, hole: 2 }).single();
    expect(data).toEqual({ strokes: 9 });
    const { data: stale } = await admin.from('scores').select('hole').match({ round_id: rematch.id, player_id: scorer });
    expect(stale).toEqual([]);
  });

  it('gives a fresh install of the account the copies, and it carries on syncing', async () => {
    const { ann, benSide } = await guestWithRematch('fresh');
    await deleteFromAnotherPhone(ann);
    await syncOnce(benSide);

    const contact = await reconcile(toRows(NOTHING));
    if (contact.status !== 'adopted-remote') throw new Error(contact.status);
    const phone = fromRows(contact.snapshot);

    const round = phone.rounds.find((r) => r.id === benSide.rematch.id)!;
    expect(phone.groups.map((g) => g.id)).toEqual([round.groupId]);
    expect(phone.courses.map((c) => c.id)).toEqual([round.courseId]);
    expect(phone.courses[0].tees.length).toBeGreaterThan(0);
    expect(applyMoveNotices(phone, await pullMoveNotices())).toBe(phone);
    await expect(reconcile(toRows(phone))).resolves.toMatchObject({ status: 'pushed', deleted: 0 });
  });

  it('sends a group and course held only on the phone up with a new round, and takes them off again with it', async () => {
    const { ann, ben, outing, day, benPhone } = await guestOnTheCard('later');
    const side = await joinedPhone(benPhone);
    await deleteFromAnotherPhone(ann);
    let now = await syncOnce(side);
    const held = now.phone.rounds.find((r) => r.id === day.id)!;
    expect(await rowsHeldBy(ben)).toBe(0);

    const round = { ...held, id: `${RUN}later-round`, outingId: null, name: 'Later', presses: [], wolfPicks: [] };
    now = await syncOnce({ ...now, phone: { ...now.phone, rounds: [...now.phone.rounds, round] } });
    const { data: group } = await admin.from('groups').select('owner_id').eq('id', round.groupId).single();
    expect(group).toEqual({ owner_id: ben.id });
    const { data: tees } = await admin.from('tees').select('owner_id').eq('course_id', round.courseId);
    expect(tees!.length).toBeGreaterThan(0);

    now = await syncOnce({ ...now, phone: { ...now.phone, rounds: now.phone.rounds.filter((r) => r.id !== round.id) } });
    expect(await rowsHeldBy(ben)).toBe(0);
    expect(now.phone.groups.find((g) => g.id === round.groupId)?.phoneOnly).toBe(true);
    expect(await dayLeft(dayOf(outing, benPhone.rounds))).toBe(0);
  });

  it('keeps an outing of their own on her group, with its field, its entrants and their membership', async () => {
    const { ann, ben, outing, day, benPhone } = await guestOnTheCard('outing');
    const { side, round, id } = await withOwnOuting(benPhone, outing, day, 'outing');
    const { error: asError } = await admin.from('outing_members').update({ player_id: round.playerIds[0] }).match({ outing_id: id, user_id: ben.id });
    expect(asError).toBeNull();
    await deleteFromAnotherPhone(ann);

    const moved = applyMoveNotices(side.phone, await pullMoveNotices());
    const server = fromRows(await pullSnapshot());
    const kept = moved.outings.find((o) => o.id === id)!;
    expect(kept.detached).toBeUndefined();
    expect(kept.groupId).not.toBe(outing.groupId);
    expect(server.outings).toEqual([{ ...kept, fieldGames: expect.anything() }]);
    for (const key of ['fieldSkins', 'scats'] as const) {
      expect([...server.outings[0].fieldGames[key].entrants].sort()).toEqual([...kept.fieldGames[key].entrants].sort());
    }
    expect(server.rounds).toEqual([moved.rounds.find((r) => r.id === round.id)]);
    const { data: member } = await admin.from('outing_members').select('player_id').match({ outing_id: id, user_id: ben.id }).single();
    expect(member).toEqual({ player_id: kept.field[0] });

    await syncOnce({ phone: moved, own: side.own, lastPull: side.lastPull });
    await expect(reconcile(toRows(moved))).resolves.toMatchObject({ status: 'pushed' });
    expect(fromRows(await pullSharedOutings()).outings.map((o) => o.id)).toEqual([id]);
  });

  it("keeps what she typed on a guest's card, under the guest's ids, when she'd joined their outing", async () => {
    const { ann, ben, outing } = await sharedDay('card');
    const merged = mergeShared(NOTHING, fromRows(await pullSharedOutings()));
    const held = merged.rounds.find((r) => r.outingId === outing.id)!;
    const course = merged.courses.find((c) => c.id === held.courseId)!;
    const id = `${RUN}card-own`;
    const round = { ...rematchOf(held, course.tees.map((t) => t.id), `${RUN}card-round`), outingId: id };
    const own = { ...merged.outings.find((o) => o.id === outing.id)!, id, field: round.playerIds, roundIds: [round.id] };
    await joinedPhone({ ...merged, outings: [...merged.outings, own], rounds: [...merged.rounds, round] });
    const { joinCode } = await hostOuting(id);

    await signInAs(ann);
    await joinOuting(joinCode, null, 'Ann');
    const scorer = round.playerIds[3];
    const { error: typed } = await getSupabase()!.from('scores').upsert({ round_id: round.id, player_id: scorer, hole: 5, strokes: 3 });
    expect(typed).toBeNull();
    await deleteAccount(PASSWORD);

    await signInAs(ben);
    const notice = (await pullMoveNotices()).find((n) => n.kind === 'player' && n.from_id === scorer)!;
    const { data } = await admin.from('scores').select('strokes, owner_id').match({ round_id: round.id, player_id: notice.to_id, hole: 5 }).single();
    expect(data).toEqual({ strokes: 3, owner_id: ben.id });
    const { data: members } = await admin.from('outing_members').select('user_id').eq('outing_id', id);
    expect(members).toEqual([{ user_id: ben.id }]);
  });

  it('moves the stand-in tee of a course with none on the server, to an id of each guest\'s own', async () => {
    const { ann, ben, day, joinCode } = await guestOnTheCard('standin');
    const { error: teeError } = await admin.from('tees').delete().eq('course_id', day.courseId);
    expect(teeError).toBeNull();
    const standIn = `${day.courseId}_default`;
    const side = await withRematch(NOTHING, day, `${RUN}standin-ben`);
    expect(side.rematch.teeId).toBe(standIn);
    await signUp('cal');
    await joinOuting(joinCode, null, 'Cal');
    await deleteFromAnotherPhone(ann);
    const cals = (await pullMoveNotices()).find((n) => n.kind === 'tee' && n.from_id === standIn)!;

    await signInAs(ben);
    const moved = applyMoveNotices(side.phone, await pullMoveNotices());
    const kept = moved.rounds.find((r) => r.id === side.rematch.id)!;
    expect(kept.teeId).not.toBe(standIn);
    expect(kept.teeId).not.toBe(cals.to_id);
    expect(moved.courses.find((c) => c.id === kept.courseId)!.tees.map((t) => t.id)).toEqual([kept.teeId]);
    const { data } = await admin.from('rounds').select('tee_id').eq('id', kept.id).single();
    expect(data).toEqual({ tee_id: kept.teeId });
    await expect(syncOnce(side)).resolves.toBeDefined();
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
