/**
 * Feature flags.
 *
 * DEMO_MODE seeds a fully played example round — the Saturday Dogs at Pine
 * Hollow — so the app has something to show before a real group exists. Demo
 * and live data live in separate storage namespaces, so switching the flag
 * never mixes fake money into a real season ledger.
 *
 * Build-time default comes from the environment; the user can flip it at
 * runtime in Settings, and that choice is what actually persists.
 */
export const DEMO_MODE_DEFAULT: boolean =
  (process.env.EXPO_PUBLIC_DEMO_MODE ?? 'true').toLowerCase() !== 'false';

/** Storage namespace per dataset, so the two never see each other. */
export function storageNamespace(demoMode: boolean): string {
  return demoMode ? 'press:demo' : 'press:live';
}

/**
 * 1 — rounds only.
 * 2 — outings: a round can belong to a bigger day with field-wide pots.
 * 3 — the course library (#378): a phone that syncs clears its courses and the
 *     days on them once, as the server did.
 * 4 — the tournament round (#410) replaces the practice round: rounds open at
 *     the update keep what they showed, and the next new round shows advice.
 */
export const STORAGE_VERSION = 4;
