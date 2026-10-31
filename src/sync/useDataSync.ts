import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { pullMoveNotices, pullSharedOutings, pushChanges, reconcile } from './remote';
import { changesAnything, mergeShared } from './merge-shared';
import { applyMoveNotices, keepingPhoneOnly, type MoveNotice } from './move-notices';
import { emptySnapshot, fromRows, toRows, type Documents, type Snapshot } from './rows';

export interface SyncState {
  /**
   * off      — no server on this build, or nobody signed in, or demo data.
   * syncing  — a push or a pull is in flight.
   * synced   — the server has what this phone has.
   * pending  — there are edits the server has not been told about yet.
   * error    — the last attempt failed. The round carries on regardless.
   */
  status: 'off' | 'syncing' | 'synced' | 'pending' | 'error';
  at: number | null;
  message: string | null;
}

export interface DataSync extends SyncState {
  /**
   * Drops a push still waiting on the debounce and resolves once anything in
   * flight has finished. Deleting an account calls this so no push can land
   * during it; the caller turns sync off first.
   */
  settle(): Promise<void>;
}

const OFF: SyncState = { status: 'off', at: null, message: null };

/** Long enough that a hole's worth of taps goes up as one write. */
const PUSH_DELAY_MS = 2500;

/**
 * Keeps one account's data on the server.
 *
 * Nothing here is on the path of an edit. The store has already saved to the
 * phone by the time this runs, and every failure leaves the app exactly as it
 * was — the status goes to `error`, the intent stays in the local data, and
 * the next change tries again. That is the whole point: the back nine has no
 * signal, and scoring cannot wait for a server.
 */
export function useDataSync(options: {
  enabled: boolean;
  documents: Documents;
  /** Takes the server's copy of what it names: everything, or only the bag. */
  onAdoptRemote: (documents: Partial<Documents>) => void;
  onSharedData: (documents: Documents) => void;
  /** An organiser's account went: applies these to what the store holds. */
  onMoveNotices: (notices: MoveNotice[]) => void;
}): DataSync {
  const { enabled, documents, onAdoptRemote, onSharedData, onMoveNotices } = options;
  const [state, setState] = useState<SyncState>(OFF);

  // What we believe the server is holding. Later pushes diff against this to
  // work out what was deleted, rather than pulling the whole lot again.
  const serverHas = useRef<Snapshot | null>(null);
  // The shared outings as last pulled: which of the phone's rows are someone else's.
  const sharedHas = useRef<Snapshot>(emptySnapshot());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  // The work behind inFlight, for settle to wait on.
  const running = useRef<Promise<void>>(Promise.resolve());
  // Goes up each time sync goes off, so a push that outlives it knows to leave things alone.
  const session = useRef(0);
  const adopt = useRef(onAdoptRemote);
  const shared = useRef(onSharedData);
  const moved = useRef(onMoveNotices);
  const latest = useRef(documents);

  useEffect(() => {
    adopt.current = onAdoptRemote;
    shared.current = onSharedData;
    moved.current = onMoveNotices;
    latest.current = documents;
  }, [onAdoptRemote, onSharedData, onMoveNotices, documents]);

  const fail = useCallback((error: unknown) => {
    setState({
      status: 'error',
      at: Date.now(),
      message: error instanceof Error ? error.message : 'Could not reach the server.',
    });
  }, []);

  // First contact: pull, and either adopt what is there or send ours up.
  // Signing out or switching to demo data drops the belief about the server,
  // so the next sign-in starts with a pull rather than a blind push.
  useEffect(() => {
    if (!enabled) {
      serverHas.current = null;
      session.current += 1;
      return;
    }
    if (serverHas.current) return;

    let cancelled = false;
    running.current = (async () => {
      inFlight.current = true;
      setState({ status: 'syncing', at: null, message: null });
      try {
        // Before every push, on this path and the debounced one. An organiser's day
        // that's gone makes a push throw, and it would never reach a pull that told it.
        const notices = await pullMoveNotices();
        if (cancelled) return;
        const held = applyMoveNotices(documents, notices);
        if (held !== documents) moved.current(notices);
        const local = toRows(held);
        const outcome = await reconcile(local);
        if (cancelled) return;
        sharedHas.current = outcome.shared;
        if (outcome.status === 'adopted-remote') {
          serverHas.current = outcome.snapshot;
          adopt.current(keepingPhoneOnly(held, fromRows(outcome.snapshot)));
        } else {
          serverHas.current = outcome.status === 'pushed' ? outcome.own : local;
          if (outcome.status === 'pushed' && (outcome.clubs || outcome.bag_settings)) {
            const bag = fromRows({ ...emptySnapshot(), clubs: outcome.clubs ?? [], bag_settings: outcome.bag_settings ?? [] });
            adopt.current({
              ...(outcome.clubs ? { clubs: bag.clubs } : {}),
              ...(bag.usualScore ? { usualScore: bag.usualScore } : {}),
            });
          }
        }
        setState({ status: 'synced', at: Date.now(), message: null });
      } catch (error) {
        if (!cancelled) fail(error);
      } finally {
        inFlight.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
    // `documents` is deliberately not a dependency: this runs once per session,
    // and the effect below follows the data from then on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, fail]);

  // Everything after that: push what changed, debounced.
  useEffect(() => {
    if (!enabled) return;

    const push = () => {
      if (inFlight.current || !serverHas.current) return;
      const server = serverHas.current;
      const started = session.current;
      inFlight.current = true;
      running.current = (async () => {
        setState((prev) => ({ ...prev, status: 'syncing' }));
        try {
          const notices = await pullMoveNotices();
          if (session.current !== started) return;
          const held = applyMoveNotices(documents, notices);
          if (held !== documents) moved.current(notices);
          const pushed = await pushChanges(toRows(held), server, sharedHas.current);
          // Sync went off meanwhile. Writing this down would undo the reset, and
          // coming back on would then skip first contact, trusting a server that
          // a failed account deletion may have emptied.
          if (session.current !== started) return;
          serverHas.current = pushed;
          // Only now, with this phone's edits safely up, is it safe to let the
          // server's copy of a shared day win.
          sharedHas.current = await pullSharedOutings();
          if (session.current !== started) return;
          const incoming = fromRows(sharedHas.current);
          // The store may not have rendered the notices yet.
          const current = applyMoveNotices(latest.current, notices);
          const merged = mergeShared(current, incoming);
          if (changesAnything(current, merged)) shared.current(merged);
          setState({ status: 'synced', at: Date.now(), message: null });
        } catch (error) {
          fail(error);
        } finally {
          inFlight.current = false;
        }
      })();
    };

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(push, PUSH_DELAY_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [enabled, documents, fail]);

  const settle = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    return running.current;
  }, []);

  // `off` is derived rather than stored, so it can never be left behind by a
  // sign-out that raced with a push.
  return useMemo(() => ({ ...(enabled ? state : OFF), settle }), [enabled, state, settle]);
}
