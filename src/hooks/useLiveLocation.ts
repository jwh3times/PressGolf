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

/**
 * GPS on demand. `start` runs it for `LIVE_FOR_MS` (or restarts the minute if
 * it is already running); `fixNow` takes one careful fix, for marking a green.
 * Everything stops when the component using it goes away.
 */
export function useLiveLocation() {
  const [state, setState] = useState<LiveLocation>({ status: 'idle' });
  const subscription = useRef<Location.LocationSubscription | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

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
    };
  }, [halt]);

  const start = useCallback(async () => {
    halt();
    setState((prev) => (prev.status === 'located' ? { ...prev, live: true } : { status: 'finding' }));
    try {
      if (!(await allowed())) {
        if (mounted.current) setState({ status: 'denied' });
        return;
      }
      const watch = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 1 },
        (location) => {
          if (mounted.current) setState({ status: 'located', fix: toFix(location), live: true });
        },
      );
      if (!mounted.current) {
        watch.remove();
        return;
      }
      subscription.current = watch;
      timer.current = setTimeout(() => {
        halt();
        setState((prev) => (prev.status === 'located' ? { ...prev, live: false } : { status: 'idle' }));
      }, LIVE_FOR_MS);
    } catch (error) {
      halt();
      if (mounted.current) setState({ status: 'failed', message: describe(error) });
    }
  }, [halt]);

  /** One fix at the best accuracy the phone has. Null when permission is refused. */
  const fixNow = useCallback(async (): Promise<Fix | null> => {
    if (!(await allowed())) {
      if (mounted.current) setState({ status: 'denied' });
      return null;
    }
    return toFix(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Highest }));
  }, []);

  return { state, start, fixNow };
}
