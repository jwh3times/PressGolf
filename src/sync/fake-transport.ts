import type { Mutation, RemoteChanges, SyncTransport } from './types';

/**
 * An in-memory stand-in for the server.
 *
 * Its job is to be able to fail convincingly. The interesting behaviour in a
 * sync layer is what happens when the radio dies mid-push, when the same
 * mutation arrives twice, and when two devices edit the same hole — none of
 * which a real backend will reproduce on demand.
 */
export class FakeTransport implements SyncTransport {
  readonly name = 'fake';
  /** Everything the "server" has, in arrival order. */
  readonly log: Mutation[] = [];
  /** Flip to make every call fail, as though the phone lost signal. */
  online = true;
  pushes = 0;
  pulls = 0;

  private subscribers = new Set<(changes: RemoteChanges) => void>();

  async push(_outingId: string, mutations: Mutation[]): Promise<void> {
    this.pushes += 1;
    if (!this.online) throw new Error('Network request failed');
    for (const m of mutations) {
      // Stable ids make a replayed push a no-op rather than a duplicate.
      if (!this.log.some((existing) => existing.id === m.id)) this.log.push(m);
    }
    this.broadcast(mutations);
  }

  async pull(_outingId: string, cursor: string | null): Promise<RemoteChanges> {
    this.pulls += 1;
    if (!this.online) throw new Error('Network request failed');
    const from = cursor ? Number(cursor) : 0;
    const mutations = this.log.slice(from);
    return { mutations, cursor: String(this.log.length) };
  }

  subscribe(_outingId: string, onChange: (changes: RemoteChanges) => void): () => void {
    this.subscribers.add(onChange);
    return () => this.subscribers.delete(onChange);
  }

  /** Simulates another device having written something while we were away. */
  seed(mutations: Mutation[]): void {
    for (const m of mutations) this.log.push(m);
  }

  private broadcast(mutations: Mutation[]): void {
    for (const fn of this.subscribers) fn({ mutations, cursor: String(this.log.length) });
  }
}
