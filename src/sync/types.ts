import type { JunkKind, PlayerId, RoundId } from '../domain/types';

/**
 * Sync is built around small, addressable facts rather than whole documents.
 *
 * Four phones on a golf course will each have a stale copy of the round most of
 * the time. Shipping the whole round would mean the last writer clobbers three
 * other people's holes. Shipping "player X, hole 7, scored 5, at time T" means
 * two people editing different holes never conflict at all, and two people
 * editing the same hole resolve to the later one.
 */

/** Every mutation targets exactly one cell. */
export type MutationKind =
  | 'score'
  | 'junk'
  | 'pops'
  | 'press'
  | 'pressRemoved'
  | 'wolfPick'
  | 'gameToggle'
  | 'gameStake'
  | 'options'
  | 'roundPlayers'
  | 'fieldGame';

export interface Mutation {
  /** Stable id, so replaying the queue twice is harmless. */
  id: string;
  kind: MutationKind;
  roundId: RoundId | null;
  outingId: string | null;
  /**
   * Identifies the cell within the round, e.g. `score:demo_p1:7`.
   *
   * Two mutations with the same key are the same fact stated twice, and the
   * later one wins. Two with different keys never conflict.
   */
  key: string;
  value: unknown;
  /** Wall-clock milliseconds when the edit was made on the originating device. */
  at: number;
  /** Which device made it. Breaks ties when two edits share a timestamp. */
  deviceId: string;
  /** Who was holding the phone. Shown in the activity feed. */
  authorId: PlayerId | null;
}

export interface ScoreValue {
  playerId: PlayerId;
  hole: number;
  strokes: number | null;
}

export interface JunkValue {
  playerId: PlayerId;
  hole: number;
  kind: JunkKind;
  on: boolean;
}

/** What a transport hands back when it pulls. */
export interface RemoteChanges {
  mutations: Mutation[];
  /** Opaque marker to resume from next time. */
  cursor: string | null;
}

export type SyncStatus = 'offline' | 'syncing' | 'synced' | 'error';

export interface SyncState {
  status: SyncStatus;
  /** Mutations made locally that the server has not acknowledged. */
  pending: number;
  lastSyncedAt: number | null;
  lastError: string | null;
}

/**
 * The wire. Swapping this out is how the same sync logic runs against Supabase,
 * against a fake in tests, or against nothing at all when the app is local-only.
 */
export interface SyncTransport {
  readonly name: string;
  /** Send local mutations. Resolves when the server has them. */
  push(outingId: string, mutations: Mutation[]): Promise<void>;
  /** Fetch everything newer than `cursor`. */
  pull(outingId: string, cursor: string | null): Promise<RemoteChanges>;
  /** Optional live feed. Returns an unsubscribe function. */
  subscribe?(outingId: string, onChange: (changes: RemoteChanges) => void): () => void;
}
