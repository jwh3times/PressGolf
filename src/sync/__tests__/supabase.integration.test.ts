import { createClient } from '@supabase/supabase-js';
import { mergeShared } from '../merge-shared';
import { pullSharedOutings, pullSnapshot, pushChanges, pushSnapshot, reconcile } from '../remote';
import { emptySnapshot, fromRows, toRows, type Documents } from '../rows';
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

/** Resolves once the app's client has joined this realtime channel. */
async function joined(topic: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const channel = getSupabase()!.getChannels().find((c) => c.topic === `realtime:${topic}`);
    if (channel?.state === 'joined') return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Realtime channel ${topic} did not join within ${timeoutMs / 1000} s`);
}

function byId(documents: Documents): Documents {
  const sorted = <T extends { id: string }>(items: T[]) => [...items].sort((a, b) => a.id.localeCompare(b.id));
  return {
    groups: sorted(documents.groups),
    courses: sorted(documents.courses),
    rounds: sorted(documents.rounds),
    outings: sorted(documents.outings),
    clubs: documents.clubs,
    usualScore: documents.usualScore,
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

  it("keeps a bag its owner's: a guest of her day never sees it, and her second phone takes it", async () => {
    const ann = await signUp('ann');
    const season = await pushSeason('bag');
    expect(season.clubs.length).toBeGreaterThan(0);
    expect(season.usualScore).toBeDefined();
    const { joinCode } = await hostOuting(season.outings[0].id);

    const ben = await signUp('ben');
    await joinOuting(joinCode, null, 'Ben');
    expect((await pullSharedOutings()).clubs).toEqual([]);
    expect((await pullSharedOutings()).bag_settings).toEqual([]);
    const supabase = getSupabase()!;
    const { data: seen } = await supabase.from('clubs').select('id').eq('id', season.clubs[0].id);
    expect(seen).toEqual([]);
    const { data: scores } = await supabase.from('bag_settings').select('usual_score');
    expect(scores).toEqual([]);
    const { error: overwrite } = await supabase
      .from('clubs')
      .upsert({ id: season.clubs[0].id, name: 'Taken', position: 0, owner_id: ben.id }, { onConflict: 'id' });
    expect(overwrite).not.toBeNull();

    // A phone holding her season from before the bag, meeting the server for the first time.
    await signInAs(ann);
    const { usualScore: _none, ...before } = season;
    const outcome = await reconcile(toRows({ ...before, clubs: [] }));
    expect(outcome).toMatchObject({ status: 'pushed', deleted: 0 });
    expect(outcome.status === 'pushed' && fromRows({ ...outcome.own }).clubs).toEqual(season.clubs);
    expect(outcome.status === 'pushed' && outcome.clubs?.length).toBe(season.clubs.length);
    expect(outcome.status === 'pushed' && fromRows({ ...emptySnapshot(), bag_settings: outcome.bag_settings ?? [] }).usualScore).toBe(season.usualScore);
    expect(fromRows(await pullSnapshot()).clubs).toEqual(season.clubs);

    // And a change to it goes up over the one there: one row an account.
    const server = await pullSnapshot();
    await pushChanges(toRows({ ...season, usualScore: '100s' }), server, emptySnapshot());
    expect((await pullSnapshot()).bag_settings).toEqual([expect.objectContaining({ id: 'bag', usual_score: '100s' })]);
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

    // He reads the course owner's hole notes and map, out of bounds limited to its holes and all, and can't add a note.
    const course = season.courses.find((c) => c.id === outing.courseId)!;
    expect(course.notes.length).toBeGreaterThan(0);
    expect(course.features.some((f) => f.holes?.length)).toBe(true);
    const theirs = shared.courses.find((c) => c.id === course.id)!;
    expect(theirs.notes).toEqual(course.notes);
    expect(theirs.features).toEqual(course.features);
    const { error } = await getSupabase()!.from('course_hole_notes').insert({ course_id: course.id, number: 9, text: 'Mine.' });
    expect(error).not.toBeNull();
  });

  it("lets a guest push after joining: the guest's score goes up, the organiser's rows stay hers", async () => {
    const ann = await signUp('ann');
    const season = await pushSeason('gp');
    const outing = season.outings[0];
    const { joinCode } = await hostOuting(outing.id);

    // Ben keeps a group of his own, then joins Ann's day and merges it in, as his phone does.
    await signUp('ben');
    const own = demoDocuments(`${RUN}gpben`);
    const mine: Documents = { groups: own.groups.slice(0, 1), courses: [], rounds: [], outings: [], clubs: [] };
    await pushSnapshot(toRows(mine));
    await joinOuting(joinCode, null, 'Ben');
    const sharedRows = await pullSharedOutings();
    const merged = mergeShared(mine, fromRows(sharedRows));
    const shared = merged.rounds.find((r) => r.outingId === outing.id)!;
    const scorer = shared.playerIds[0];
    const claim = `0:${scorer}:sandie`;
    const card = {
      ...shared,
      scores: { ...shared.scores, [scorer]: [7, ...shared.scores[scorer].slice(1)] },
      junk: { ...shared.junk, [claim]: true as const },
    };
    const edited: Documents = { ...merged, rounds: merged.rounds.map((r) => (r.id === card.id ? card : r)) };
    const renamed = { ...mine.groups[0], name: 'Ben after joining' };
    const local = toRows({ ...edited, groups: edited.groups.map((g) => (g.id === renamed.id ? renamed : g)) });

    // A push after first contact, as useDataSync makes it.
    await pushChanges(local, await pullSnapshot(), sharedRows);
    // And first contact again, as after the app restarts.
    await expect(reconcile(local)).resolves.toMatchObject({ status: 'pushed' });

    expect(fromRows(await pullSnapshot()).groups.find((g) => g.id === renamed.id)?.name).toBe('Ben after joining');
    await signInAs(ann);
    const back = fromRows(await pullSnapshot());
    // Ben's score reached Ann's card and the cell is still hers (her pull reads only her own rows),
    // and none of her day moved to Ben.
    expect(back.rounds.find((r) => r.id === card.id)?.scores[scorer][0]).toBe(7);
    // The junk he claimed is a new row, his own, and reaches her with the shared day.
    expect(fromRows(await pullSharedOutings()).rounds.find((r) => r.id === card.id)?.junk[claim]).toBe(true);
    expect(byId(back).groups.map((g) => g.id)).toEqual(byId(season).groups.map((g) => g.id));
  });

  it("keeps a press a guest adds to the organiser's round on his phone, and lets him play her course again", async () => {
    const ann = await signUp('ann');
    const season = await pushSeason('gx');
    const outing = season.outings[0];
    const { joinCode } = await hostOuting(outing.id);

    await signUp('ben');
    await joinOuting(joinCode, null, 'Ben');
    const sharedRows = await pullSharedOutings();
    const merged = mergeShared({ groups: [], courses: [], rounds: [], outings: [], clubs: [] }, fromRows(sharedRows));
    const theirs = merged.rounds.find((r) => r.outingId === outing.id)!;
    const [by, against] = theirs.playerIds;
    const press = { id: `${RUN}gx-press`, by, against, startHole: 9, endHole: 17, stake: 100 };
    // A round of his own on her group and course, as he'd play them again another day.
    const rematch = { ...theirs, id: `${RUN}gx-rematch`, outingId: null, presses: [] };
    const local = toRows({
      ...merged,
      rounds: [...merged.rounds.map((r) => (r.id === theirs.id ? { ...r, presses: [...r.presses, press] } : r)), rematch],
    });

    await expect(pushChanges(local, await pullSnapshot(), sharedRows)).resolves.toBeDefined();
    expect(fromRows(await pullSnapshot()).rounds.map((r) => r.id)).toEqual([rematch.id]);

    await signInAs(ann);
    const day = fromRows(await pullSharedOutings()).rounds.find((r) => r.id === theirs.id)!;
    expect(day.presses.map((p) => p.id)).not.toContain(press.id);
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

    let delivered: RemoteChanges | null = null;
    // Read through a function: the subscription callback sets it, not the loops.
    const arrived = () => delivered !== null;
    const unsubscribe = new SupabaseTransport().subscribe(outing.id, (changes) => {
      delivered ??= changes;
    });
    await joined(`outing:${outing.id}`);

    // A channel reports joined before a cold server's change feed is ready,
    // and an edit written in that gap is never delivered live. The app does
    // not depend on it (every phone also catches up from the log by cursor,
    // as the test above proves), so this proves what realtime does promise:
    // once the feed is up, another member's edit arrives on its own. Ben
    // keeps scoring every two seconds until one does.
    const written: string[] = [];
    const deadline = Date.now() + 60_000;
    while (!arrived() && Date.now() < deadline) {
      const edit = mutation(outing.id, roundId, 100 + written.length);
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
      written.push(edit.id);
      for (let waited = 0; !arrived() && waited < 2000; waited += 100) await new Promise((r) => setTimeout(r, 100));
    }
    unsubscribe();

    expect(delivered).not.toBeNull();
    const [change] = delivered!.mutations;
    expect(written).toContain(change.id);
    expect(change).toMatchObject({ deviceId: 'bens-phone', outingId: outing.id, value: 4 });
    ben.realtime.disconnect();
  }, 90_000);
});
