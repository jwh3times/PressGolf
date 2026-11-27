import { readScorecard } from '../scorecard';
import { getSupabase } from '../supabase';

jest.mock('../supabase', () => ({ getSupabase: jest.fn() }));

const mockGetSupabase = getSupabase as jest.MockedFunction<typeof getSupabase>;
const photo = { mediaType: 'image/jpeg' as const, data: 'aGVsbG8=' };

/** A client whose function call answers as given; a non-2xx reply carries its body in `context`, as supabase-js does. */
function client(answer: { data?: unknown; error?: { name: string; context?: unknown } | null }) {
  const invoke = jest.fn(() => Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null }));
  mockGetSupabase.mockReturnValue({ functions: { invoke } } as never);
  return invoke;
}

const httpError = (body: unknown) => ({ name: 'FunctionsHttpError', context: { json: () => Promise.resolve(body) } });

beforeEach(() => jest.clearAllMocks());

describe('reading a scorecard through the server (#385)', () => {
  it('sends the photos in tee card mode and takes the reading', async () => {
    const card = { holeCount: 9, tees: [] };
    const invoke = client({ data: { outcome: 'read', card, scansLeft: 7 } });
    await expect(readScorecard([photo])).resolves.toEqual({ outcome: 'read', card, scansLeft: 7 });
    expect(invoke).toHaveBeenCalledWith('read-scorecard', { body: { mode: 'teeCard', images: [photo] } });
  });

  it('passes on an unreadable card with the scans left, and the daily limit with its reason', async () => {
    client({ error: httpError({ outcome: 'unreadable', reason: 'Couldn’t read a scorecard in those photos.', scansLeft: 3 }) });
    await expect(readScorecard([photo])).resolves.toEqual({ outcome: 'unreadable', reason: 'Couldn’t read a scorecard in those photos.', scansLeft: 3 });
    client({ error: httpError({ outcome: 'limit', reason: 'That’s today’s 10 scans used.' }) });
    await expect(readScorecard([photo])).resolves.toEqual({ outcome: 'limit', reason: 'That’s today’s 10 scans used.' });
  });

  it('says no signal when the call never got there, and keeps a bad request’s reason', async () => {
    client({ error: { name: 'FunctionsFetchError' } });
    await expect(readScorecard([photo])).resolves.toEqual({ outcome: 'failed', reason: expect.stringContaining('Check your signal') });
    client({ error: httpError({ outcome: 'bad-request', reason: 'A photo is too large: keep each under 5 MB.' }) });
    await expect(readScorecard([photo])).resolves.toEqual({ outcome: 'failed', reason: 'A photo is too large: keep each under 5 MB.' });
  });

  it('turns anything else into a failure worth typing the course in for', async () => {
    const later = { outcome: 'failed', reason: expect.stringContaining('Try again later') };
    for (const body of [{ outcome: 'unavailable' }, { outcome: 'not-signed-in' }, { outcome: 'unreadable' }, { outcome: 'limit' }, { outcome: 'bad-request' }]) {
      client({ error: httpError(body) });
      const outcome = await readScorecard([photo]);
      expect(outcome.outcome === 'limit' ? { outcome: 'failed', reason: outcome.reason } : outcome).toEqual(later);
    }
    // Only a bad request's reason is the golfer's to read; any other reason stays the server's.
    client({ error: httpError({ outcome: 'unavailable', reason: 'no reader configured' }) });
    await expect(readScorecard([photo])).resolves.toEqual(later);
    client({ error: { name: 'FunctionsHttpError', context: { json: () => Promise.reject(new Error('not JSON')) } } });
    await expect(readScorecard([photo])).resolves.toEqual(later);
    mockGetSupabase.mockReturnValue(null);
    await expect(readScorecard([photo])).resolves.toEqual(later);
  });
});
