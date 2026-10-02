/**
 * Points the app's Supabase client at the local stack before anything imports it.
 *
 * `npm run test:integration` sets SUPABASE_TEST_URL and SUPABASE_TEST_ANON_KEY
 * from `supabase status`. Running the file any other way fails here, loudly,
 * rather than quietly skipping every test as "not configured".
 */
const url = process.env.SUPABASE_TEST_URL;
const key = process.env.SUPABASE_TEST_ANON_KEY;
if (!url || !key) {
  throw new Error('SUPABASE_TEST_URL and SUPABASE_TEST_ANON_KEY are not set. Run `npm run test:integration`.');
}
process.env.EXPO_PUBLIC_SUPABASE_URL = url;
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = key;

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Only the confirmation email's redirect uses it, and local auth sends no email.
jest.mock('expo-linking', () => ({ createURL: (path: string) => `press://${path}` }));
