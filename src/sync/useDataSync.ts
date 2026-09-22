import { useCallback, useEffect, useRef, useState } from 'react';
import { deletions } from './diff';
import { pushSnapshot, reconcile } from './remote';
import { fromRows, toRows, type Documents, type Snapshot } from './rows';

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
  onAdoptRemote: (documents: Documents) => void;
}): SyncState {
  const { enabled, documents, onAdoptRemote } = options;
  const [state, setState] = useState<SyncState>(OFF);

  // What we believe the server is holding. Later pushes diff against this to
  // work out what was deleted, rather than pulling the whole lot again.
  const serverHas = useRef<Snapshot | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);
  const adopt = useRef(onAdoptRemote);

  useEffect(() => {
    adopt.current = onAdoptRemote;
  }, [onAdoptRemote]);

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
      return;
    }
    if (serverHas.current) return;

    let cancelled = false;
    void (async () => {
      inFlight.current = true;
      setState({ status: 'syncing', at: null, message: null });
      try {
        const local = toRows(documents);
        const outcome = await reconcile(local);
        if (cancelled) return;
        if (outcome.status === 'adopted-remote') {
          serverHas.current = outcome.snapshot;
          adopt.current(fromRows(outcome.snapshot));
        } else {
          serverHas.current = local;
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
      inFlight.current = true;
      void (async () => {
        setState((prev) => ({ ...prev, status: 'syncing' }));
        try {
          const local = toRows(documents);
          const prune = deletions(serverHas.current ?? local, local);
          await pushSnapshot(local, { prune });
          serverHas.current = local;
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

  // `off` is derived rather than stored, so it can never be left behind by a
  // sign-out that raced with a push.
  return enabled ? state : OFF;
}
