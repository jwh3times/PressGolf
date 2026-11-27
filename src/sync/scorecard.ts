/**
 * Reading a photographed scorecard, through the server's `read-scorecard` (#384, #385).
 *
 * Online only, like the library search. The photos go up as base64 and come back as a
 * draft of the card's tees, every value the photos gave and the server's checks passed,
 * the rest null. Each account gets 10 scans a day, counted on the server, which says
 * how many are left with each reading.
 */
import type { ReadTees } from '../domain/course-draft';
import { getSupabase } from './supabase';

export interface ScanPhoto {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  /** Base64, no data: prefix. */
  data: string;
}

export type ScanOutcome =
  | { outcome: 'read'; card: ReadTees; scansLeft: number }
  /** The photos held no card the server could read. It still counts as a scan. */
  | { outcome: 'unreadable'; reason: string; scansLeft: number }
  /** Today's scans are used up. */
  | { outcome: 'limit'; reason: string }
  /** Anything else: no signal, the server down, or the scan switched off. Worth typing it in. */
  | { outcome: 'failed'; reason: string };

const NO_SIGNAL = 'Couldn’t reach Press to read the card. Check your signal, or type the course in.';
const FAILED = 'Couldn’t read the card just now. Try again later, or type the course in.';

/** Sends one card's photos to be read. Never throws: every way it can go is an outcome. */
export async function readScorecard(photos: ScanPhoto[]): Promise<ScanOutcome> {
  const supabase = getSupabase();
  if (!supabase) return { outcome: 'failed', reason: FAILED };
  const { data, error } = await supabase.functions.invoke('read-scorecard', { body: { mode: 'teeCard', images: photos } });
  if (!error) return data as ScanOutcome;
  if (error.name === 'FunctionsFetchError') return { outcome: 'failed', reason: NO_SIGNAL };
  try {
    const reply = (await (error.context as Response).json()) as { outcome?: string; reason?: string; scansLeft?: number };
    if (reply.outcome === 'unreadable' && typeof reply.scansLeft === 'number') {
      return { outcome: 'unreadable', reason: reply.reason ?? FAILED, scansLeft: reply.scansLeft };
    }
    if (reply.outcome === 'limit') return { outcome: 'limit', reason: reply.reason ?? FAILED };
    return { outcome: 'failed', reason: reply.outcome === 'bad-request' && reply.reason ? reply.reason : FAILED };
  } catch {
    return { outcome: 'failed', reason: FAILED };
  }
}
