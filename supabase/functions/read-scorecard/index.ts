// Reads a photographed scorecard into a draft of its tees (#384, spec #376).
//
// The app sends one to 4 photos of one card, as base64, with a mode; this builds the
// tee card mode, and #255 adds scores. Each signed-in account gets 10 scans a day,
// counted in `scorecard_scans` (one scan however many photos), and the 11th is refused.
// The photos go to the model and nowhere else: nothing here writes them, logs them or
// keeps them past the reply. What comes back is a draft for the golfer to check, with
// every value the card didn't give, or that failed a check, as null.
//
// The model sits behind a port (`model.ts`). On the local stack, served over plain
// http with `READ_SCORECARD_FAKE_MODEL` on, it's a fake that needs no key, whatever
// keys are about, so a test never spends money. Anywhere else it's Claude Haiku 5.5,
// with `ANTHROPIC_API_KEY`, a function secret; without that, the function says it's
// unavailable. A hosted project is served over https, so it never gets the fake.
//
// The version is pinned because every merge to main deploys this function. It moves
// with the app's: scripts/edge-function-pins.test.mjs fails when they differ.
import { createClient } from 'npm:@supabase/supabase-js@2.119.2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2.119.2/cors';
import { checkRequest, DAILY_SCANS, draftFrom, MAX_IMAGE_BASE64, MAX_IMAGES, type TeesDraft } from './card.ts';
import { claudeReader, fakeReader, NoReading, ReaderDown, type CardReader } from './model.ts';

type Reply =
  | { outcome: 'read'; card: TeesDraft; scansLeft: number }
  | { outcome: 'unreadable'; reason: string; scansLeft: number }
  | { outcome: 'limit'; reason: string }
  | { outcome: 'bad-request'; reason: string }
  | { outcome: 'not-signed-in' }
  | { outcome: 'unavailable' }
  | { outcome: 'failed' };

function reply(body: Reply, status: number): Response {
  return Response.json(body, { status, headers: corsHeaders });
}

const unreadable = (scansLeft: number) =>
  reply({ outcome: 'unreadable', reason: 'Couldn’t read a scorecard in those photos.', scansLeft }, 422);

/** The reader this deployment has, or none. */
function cardReader(): CardReader | null {
  const local = new URL(Deno.env.get('SUPABASE_URL') ?? 'https://unknown').protocol === 'http:';
  if (local && Deno.env.get('READ_SCORECARD_FAKE_MODEL') === 'on') return fakeReader;
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  return key ? claudeReader(key) : null;
}

/** The most a request of 4 photos under 5 MB each can be, with room for the rest of the JSON. */
const MAX_BODY_BYTES = MAX_IMAGES * MAX_IMAGE_BASE64 + 64_000;

/** The body as text, or null once it's longer than `limit`, however it was sent. */
async function bodyWithin(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

function json(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return reply({ outcome: 'failed' }, 405);

  const token = request.headers.get('Authorization')?.replace(/^Bearer /i, '');
  if (!token) return reply({ outcome: 'not-signed-in' }, 401);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: tokenError } = await admin.auth.getUser(token);
  if (tokenError || !verified.user) {
    if (tokenError && tokenError.status !== 401 && tokenError.status !== 403 && tokenError.code !== 'user_not_found') {
      console.error('read-scorecard: reading the token failed', tokenError.code, tokenError.status);
      return reply({ outcome: 'failed' }, 500);
    }
    return reply({ outcome: 'not-signed-in' }, 401);
  }
  const account = verified.user.id;

  const body = await bodyWithin(request, MAX_BODY_BYTES);
  if (body === null) return reply({ outcome: 'bad-request', reason: 'A photo is too large: keep each under 5 MB.' }, 413);
  const checked = checkRequest(json(body));
  if (!checked.ok) return reply({ outcome: 'bad-request', reason: checked.reason }, 400);

  const readCard = cardReader();
  if (!readCard) return reply({ outcome: 'unavailable' }, 503);

  // Taken before the call, so two at once can't both have the last one.
  const { data: scansLeft, error: takeError } = await admin.rpc('take_scorecard_scan', { target: account });
  if (takeError) {
    console.error('read-scorecard: counting the scan failed', takeError.code);
    return reply({ outcome: 'failed' }, 500);
  }
  if (scansLeft === null) {
    return reply({ outcome: 'limit', reason: `That’s today’s ${DAILY_SCANS} scans used. Type the course in, or scan again tomorrow.` }, 429);
  }

  let reading: unknown;
  try {
    reading = await readCard(checked.images);
  } catch (error) {
    if (error instanceof NoReading) return unreadable(scansLeft);
    // The model never saw the photos: the golfer isn't charged a scan for it. Anything
    // else may have been read and billed, so the scan stands.
    if (error instanceof ReaderDown) {
      const { error: giveBackError } = await admin.rpc('give_back_scorecard_scan', { target: account });
      if (giveBackError) console.error('read-scorecard: giving the scan back failed', giveBackError.code);
    }
    console.error('read-scorecard: the reader failed', error instanceof Error ? error.name : 'unknown');
    return reply({ outcome: 'failed' }, 502);
  }

  const card = draftFrom(reading);
  return card ? reply({ outcome: 'read', card, scansLeft }, 200) : unreadable(scansLeft);
});
