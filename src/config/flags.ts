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

export const STORAGE_VERSION = 1;
