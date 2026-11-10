import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LatLng } from '../domain/types';

/**
 * How long a tap keeps GPS running. Long enough to walk up to the ball and
 * watch the number settle; short enough that a forgotten tap doesn't cost the
 * battery the phone needs to keep the scorecard going to the eighteenth.
 */
export const LIVE_FOR_MS = 60_000;

export interface Fix {
  position: LatLng;
  /** Metres, 68% confidence. Null where the platform doesn't say (some browsers). */
  accuracy: number | null;
}

export type LiveLocation =
  | { status: 'idle' }
  /** Asking for permission, or waiting for the first fix. */
  | { status: 'finding' }
  | { status: 'denied' }
  | { status: 'failed'; message: string }
  /** `live` is false once the minute is up; the last fix stays on screen. */
  | { status: 'located'; fix: Fix; live: boolean };

const toFix = (location: Location.LocationObject): Fix => ({
  position: { lat: location.coords.latitude, lng: location.coords.longitude },
  accuracy: location.coords.accuracy ?? null,
});

async function allowed(): Promise<boolean> {
  const { granted } = await Location.requestForegroundPermissionsAsync();
  return granted;
}

const describe = (error: unknown) => (error instanceof Error ? error.message : 'Location is not available.');

/** Whether `fix` is closer than `best`. A fix that doesn't say how close it is never beats one that does. */
function better(fix: Fix, best: Fix | null): boolean {
  if (!best || best.accuracy == null) return true;
  return fix.accuracy != null && fix.accuracy < best.accuracy;
}

/**
 * GPS on demand. `start` runs it for `LIVE_FOR_MS` (or restarts the minute if
 * it is already running); `fixNow` takes one careful fix, for marking a green;
 * `fixWithin` waits for a close one, for marking the ball. Everything stops
 * when the component using it goes away.
 */
export function useLiveLocation() {
  const [state, setState] = useState<LiveLocation>({ status: 'idle' });
  const subscription = useRef<Location.LocationSubscription | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  /** Each fix the watch gives, for a `fixWithin` waiting on one. */
  const listener = useRef<((fix: Fix) => void) | null>(null);
  /** Ends the wait in progress with nothing. */
  const giveUp = useRef<(() => void) | null>(null);

  const halt = useCallback(() => {
    subscription.current?.remove();
    subscription.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      halt();
      giveUp.current?.();
    };
  }, [halt]);

  /** Runs the watch for a minute. True once it is running; false when location is refused or fails. */
  const start = useCallback(async (): Promise<boolean> => {
    halt();
    setState((prev) => (prev.status === 'located' ? { ...prev, live: true } : { status: 'finding' }));
    try {
      if (!(await allowed())) {
        if (mounted.current) setState({ status: 'denied' });
        return false;
      }
      const watch = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 1 },
        (location) => {
          const fix = toFix(location);
          if (mounted.current) setState({ status: 'located', fix, live: true });
          listener.current?.(fix);
        },
      );
      if (!mounted.current) {
        watch.remove();
        return false;
      }
      subscription.current = watch;
      timer.current = setTimeout(() => {
        halt();
        setState((prev) => (prev.status === 'located' ? { ...prev, live: false } : { status: 'idle' }));
      }, LIVE_FOR_MS);
      return true;
    } catch (error) {
      halt();
      if (mounted.current) setState({ status: 'failed', message: describe(error) });
      return false;
    }
  }, [halt]);

  /**
   * Runs the watch as `start` does, so the yardage shows, and waits for a fix
   * within `metres`. When `waitMs`, counted from when the watch is running,
   * runs out first it settles for the closest
   * fix so far, and throws when there was none. Null when location is refused
   * or fails, which the state already says, or when the component goes.
   */
  const fixWithin = useCallback(
    (metres: number, waitMs: number) =>
      new Promise<Fix | null>((resolve, reject) => {
        giveUp.current?.();
        let best: Fix | null = null;
        let done = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        const finish = (settle: () => void) => {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          if (listener.current === hear) listener.current = null;
          if (giveUp.current === stop) giveUp.current = null;
          settle();
        };
        const hear = (fix: Fix) => {
          if (better(fix, best)) best = fix;
          if (fix.accuracy != null && fix.accuracy <= metres) finish(() => resolve(fix));
        };
        const stop = () => finish(() => resolve(null));
        listener.current = hear;
        giveUp.current = stop;
        // The wait starts once GPS is running, so a permission prompt doesn't use it up.
        void start().then((watching) => {
          if (!watching) return stop();
          if (done) return;
          timeout = setTimeout(
            () =>
              finish(() =>
                best
                  ? resolve(best)
                  : reject(new Error(`No GPS fix came in ${Math.round(waitMs / 1000)} seconds. Try again in the open.`)),
              ),
            waitMs,
          );
        });
      }),
    [start],
  );

  /** One fix at the best accuracy the phone has. Null when permission is refused. */
  const fixNow = useCallback(async (): Promise<Fix | null> => {
    if (!(await allowed())) {
      if (mounted.current) setState({ status: 'denied' });
      return null;
    }
    return toFix(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }));
  }, []);

  return { state, start, fixNow, fixWithin };
}
