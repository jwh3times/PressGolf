import { createClient } from '@supabase/supabase-js';

/**
 * Reading a photographed scorecard through the real `read-scorecard` Edge Function
 * (#384), on a local Supabase stack: real auth, the real daily count, and the
 * function's own checks on what the model gives back.
 *
 * The local stack reads with the function's fake model (`READ_SCORECARD_FAKE_MODEL`
 * in supabase/config.toml), which needs no key and costs nothing: each "photo" here
 * is the card the model is to read, as JSON, in place of the image's bytes.
 */

const RUN = `s${Date.now().toString(36)}`;
const PASSWORD = 'correct-horse-battery-staple';
const URL = process.env.SUPABASE_TEST_URL!;
const ANON = process.env.SUPABASE_TEST_ANON_KEY!;

const admin = createClient(URL, process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let accounts = 0;

/** A new account's id and access token. */
async function signUp(name: string): Promise<{ id: string; token: string }> {
  const client = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signUp({ email: `${name}-${RUN}-${++accounts}@example.com`, password: PASSWORD });
  if (error || !data.session || !data.user) throw new Error(`sign-up failed: ${error?.message ?? 'no session'}`);
  return { id: data.user.id, token: data.session.access_token };
}

/** A "photo" the fake model reads as this card. */
function photoOf(card: unknown) {
  return { mediaType: 'image/jpeg', data: Buffer.from(JSON.stringify(card)).toString('base64') };
}

async function scan(token: string | null, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${URL}/functions/v1/read-scorecard`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

const holes = (holeCount: number, value: (i: number) => number | null) => Array.from({ length: holeCount }, (_, i) => value(i));

/** A nine-hole card with two tees, as the model might read it: a misread here and there. */
const reading = {
  holeCount: 9,
  tees: [
    {
      name: 'Blue',
      slope: 131,
      rating: 35.8,
      yards: holes(9, (i) => 300 + i * 10),
      par: holes(9, (i) => (i === 2 ? 3 : 4)),
      // Hole 9's index is repeated on hole 8, and the card's hole 4 couldn't be read.
      strokeIndex: [5, 1, 9, null, 3, 7, 2, 6, 6],
    },
    { name: 'Red', slope: 160, rating: null, yards: holes(9, () => null), par: holes(9, () => 4), strokeIndex: holes(9, (i) => i + 1) },
  ],
};

afterAll(async () => {
  await admin.auth.stopAutoRefresh();
});

describe('read-scorecard against a local Supabase stack (#384)', () => {
  it('reads a signed-in golfer’s photos into a draft tee card, blank where the card or a check says so', async () => {
    const { token } = await signUp('scan');
    const { status, body } = await scan(token, { mode: 'teeCard', images: [photoOf(reading), photoOf({ back: 'nine' })] });
    expect(status).toBe(200);
    expect(body.outcome).toBe('read');
    expect(body.scansLeft).toBe(9);
    const card = body.card as { holeCount: number; tees: { name: string; slope: number | null; rating: number | null; holes: Record<string, unknown>[] }[] };
    expect(card.holeCount).toBe(9);
    const [blue, red] = card.tees;
    expect(blue).toMatchObject({ name: 'Blue', slope: 131, rating: 35.8 });
    expect(blue.holes[0]).toEqual({ number: 1, par: 4, strokeIndex: 5, yards: 300 });
    expect(blue.holes[2]).toMatchObject({ par: 3 });
    expect(blue.holes[3]).toMatchObject({ strokeIndex: null });
    // Two holes with one index: neither is kept.
    expect(blue.holes[7]).toMatchObject({ strokeIndex: null });
    expect(blue.holes[8]).toMatchObject({ strokeIndex: null });
    // A slope of 160 isn't a slope.
    expect(red).toMatchObject({ name: 'Red', slope: null, rating: null });
    expect(red.holes.every((h) => h.yards === null)).toBe(true);
  });

  it('refuses no photos, five, and a call with no one signed in', async () => {
    const { token } = await signUp('refused');
    expect(await scan(token, { mode: 'teeCard', images: [] })).toMatchObject({ status: 400, body: { outcome: 'bad-request' } });
    const five = Array.from({ length: 5 }, () => photoOf(reading));
    expect(await scan(token, { mode: 'teeCard', images: five })).toMatchObject({ status: 400, body: { outcome: 'bad-request' } });
    expect(await scan(null, { mode: 'teeCard', images: [photoOf(reading)] })).toMatchObject({ status: 401, body: { outcome: 'not-signed-in' } });
    expect(await scan('not-a-token', { mode: 'teeCard', images: [photoOf(reading)] })).toMatchObject({ status: 401 });
    // None of those was a scan.
    expect(await scan(token, { mode: 'teeCard', images: [photoOf(reading)] })).toMatchObject({ status: 200, body: { scansLeft: 9 } });
  });

  it('says so when the photos hold no card, and counts it as a scan', async () => {
    const { token } = await signUp('nocard');
    expect(await scan(token, { mode: 'teeCard', images: [photoOf({ holeCount: 27, tees: [] })] })).toMatchObject({
      status: 422,
      body: { outcome: 'unreadable', scansLeft: 9 },
    });
    const notJson = { mediaType: 'image/png', data: Buffer.from('not a card').toString('base64') };
    expect(await scan(token, { mode: 'teeCard', images: [notJson] })).toMatchObject({ status: 422, body: { outcome: 'unreadable', scansLeft: 8 } });
  });

  it('gives the scan back when the model can’t be reached, and keeps it otherwise', async () => {
    const { token } = await signUp('down');
    expect(await scan(token, { mode: 'teeCard', images: [photoOf({ readerDown: true })] })).toMatchObject({ status: 502, body: { outcome: 'failed' } });
    expect(await scan(token, { mode: 'teeCard', images: [photoOf(reading)] })).toMatchObject({ status: 200, body: { scansLeft: 9 } });
  });

  it('refuses a body larger than 4 photos can be, however it is sent', async () => {
    const { token } = await signUp('large');
    const huge = { mode: 'teeCard', images: Array.from({ length: 4 }, () => ({ mediaType: 'image/jpeg', data: 'A'.repeat(7_100_000) })) };
    expect(await scan(token, huge)).toMatchObject({ status: 413, body: { outcome: 'bad-request' } });
  });

  it('refuses the 11th scan of the day with a reason, and leaves another account its own 10', async () => {
    const ann = await signUp('limit');
    const ben = await signUp('limit');
    for (let n = 1; n <= 10; n++) {
      expect(await scan(ann.token, { mode: 'teeCard', images: [photoOf(reading)] })).toMatchObject({ status: 200, body: { scansLeft: 10 - n } });
    }
    const refused = await scan(ann.token, { mode: 'teeCard', images: [photoOf(reading)] });
    expect(refused.status).toBe(429);
    expect(refused.body).toEqual({ outcome: 'limit', reason: 'That’s today’s 10 scans used. Type the course in, or scan again tomorrow.' });
    expect(await scan(ben.token, { mode: 'teeCard', images: [photoOf(reading)] })).toMatchObject({ status: 200, body: { scansLeft: 9 } });

    // The count is all the server keeps of a scan: no photo, nothing read.
    const { data } = await admin.from('scorecard_scans').select('*').eq('account', ann.id);
    expect(data).toEqual([{ account: ann.id, day: expect.any(String), scans: 10 }]);
  });

  it("keeps the count out of every client's reach", async () => {
    const { id, token } = await signUp('reach');
    await scan(token, { mode: 'teeCard', images: [photoOf(reading)] });
    const golfer = createClient(URL, ANON, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: seen } = await golfer.from('scorecard_scans').select('*');
    expect(seen ?? []).toEqual([]);
    const { error: reset } = await golfer.rpc('give_back_scorecard_scan', { target: id });
    expect(reset).not.toBeNull();
    const { error: taken } = await golfer.rpc('take_scorecard_scan', { target: id });
    expect(taken).not.toBeNull();
  });
});
