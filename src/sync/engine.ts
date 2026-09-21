import type { Mutation, SyncState, SyncTransport } from './types';

export interface SyncEngineOptions {
  transport: SyncTransport;
  outingId: string;
  /** Called with remote mutations that should be folded into local state. */
  onRemote: (mutations: Mutation[]) => void;
  /** Persist the queue so it survives the app being killed in a car park. */
  saveQueue?: (mutations: Mutation[]) => void | Promise<void>;
  loadQueue?: () => Promise<Mutation[]>;
  saveCursor?: (cursor: string | null) => void | Promise<void>;
  loadCursor?: () => Promise<string | null>;
  onState?: (state: SyncState) => void;
  /** Overridable for tests. */
  now?: () => number;
}

/**
 * Offline-first sync.
 *
 * The local store is always the source of truth for writes. Nothing waits on
 * the network — a mutation is applied locally, appended to a durable queue, and
 * flushed whenever there happens to be signal. On a golf course that is
 * "sometimes, near the clubhouse", which is precisely why this cannot be a
 * request/response app.
 *
 * Failure is the normal case here, not the exception: a failed flush leaves the
 * queue exactly as it was and backs off. Nothing is dropped, and a mutation
 * that gets sent twice is harmless because every one carries a stable id and
 * addresses a single cell.
 */
export class SyncEngine {
  private queue: Mutation[] = [];
  private cursor: string | null = null;
  private state: SyncState = { status: 'offline', pending: 0, lastSyncedAt: null, lastError: null };
  /** The running drain loop, if any. Concurrent callers share it. */
  private loop: Promise<void> | null = null;
  /** A pass has been asked for and not yet started. */
  private again = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribe: (() => void) | null = null;
  private backoff = 1000;
  private stopped = false;

  constructor(private readonly options: SyncEngineOptions) {}

  private get now(): number {
    return (this.options.now ?? Date.now)();
  }

  async start(): Promise<void> {
    this.stopped = false;
    if (this.options.loadQueue) this.queue = await this.options.loadQueue();
    if (this.options.loadCursor) this.cursor = await this.options.loadCursor();
    this.emit({ pending: this.queue.length });

    if (this.options.transport.subscribe) {
      this.unsubscribe = this.options.transport.subscribe(this.options.outingId, (changes) => {
        if (changes.mutations.length) this.options.onRemote(changes.mutations);
        if (changes.cursor) void this.setCursor(changes.cursor);
      });
    }
    await this.sync();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  getState(): SyncState {
    return { ...this.state };
  }

  /** Queues a local edit. Never throws, never blocks on the network. */
  enqueue(mutation: Mutation): void {
    this.queue.push(mutation);
    void this.options.saveQueue?.(this.queue);
    this.emit({ pending: this.queue.length });
    void this.sync();
  }

  /**
   * Requests a sync, and resolves once a pass that began after this call has
   * finished.
   *
   * Calls that arrive while a pass is in flight are coalesced into one more
   * pass rather than dropped. Dropping them is the obvious implementation and
   * it is wrong: score a hole, score another before the first flush lands, and
   * the second edit sits in the queue until something unrelated happens to
   * trigger a sync.
   */
  sync(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.again = true;
    if (this.loop) return this.loop;
    this.loop = this.drain().finally(() => {
      this.loop = null;
    });
    return this.loop;
  }

  private async drain(): Promise<void> {
    while (this.again && !this.stopped) {
      this.again = false;
      await this.runOnce();
    }
  }

  /** One push-then-pull pass. Never throws: a dead radio is not exceptional. */
  private async runOnce(): Promise<void> {
    this.emit({ status: 'syncing' });

    try {
      if (this.queue.length) {
        // Snapshot the batch: anything enqueued while this is in flight stays
        // queued for the next pass rather than being silently dropped.
        const batch = this.queue.slice();
        await this.options.transport.push(this.options.outingId, batch);
        const sent = new Set(batch.map((m) => m.id));
        this.queue = this.queue.filter((m) => !sent.has(m.id));
        void this.options.saveQueue?.(this.queue);
      }

      const changes = await this.options.transport.pull(this.options.outingId, this.cursor);
      if (changes.mutations.length) this.options.onRemote(changes.mutations);
      if (changes.cursor) await this.setCursor(changes.cursor);

      this.backoff = 1000;
      this.emit({
        status: 'synced',
        pending: this.queue.length,
        lastSyncedAt: this.now,
        lastError: null,
      });
    } catch (error) {
      // No signal is the expected state on half a golf course, so this is not
      // an error condition — it is a reason to try again later.
      this.emit({
        status: 'offline',
        pending: this.queue.length,
        lastError: error instanceof Error ? error.message : String(error),
      });
      this.scheduleRetry();
    }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.timer) return;
    const delay = this.backoff;
    // Cap at half a minute: long enough not to hammer a dead radio, short
    // enough that walking back into signal syncs before anyone notices.
    this.backoff = Math.min(this.backoff * 2, 30000);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.sync();
    }, delay);
  }

  private async setCursor(cursor: string | null): Promise<void> {
    this.cursor = cursor;
    await this.options.saveCursor?.(cursor);
  }

  private emit(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    this.options.onState?.(this.getState());
  }
}

let deviceIdCache: string | null = null;

/** Stable per-install id, used to break timestamp ties identically everywhere. */
export function deviceId(generate: () => string = randomId): string {
  if (!deviceIdCache) deviceIdCache = generate();
  return deviceIdCache;
}

export function setDeviceId(id: string): void {
  deviceIdCache = id;
}

function randomId(): string {
  return `d_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
