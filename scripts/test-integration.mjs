// Runs the sync integration tests against the local Supabase stack.
//
// Start the stack first (`npx supabase start`, Docker required). The URL and
// anon key come from `supabase status`; set SUPABASE_TEST_URL and
// SUPABASE_TEST_ANON_KEY yourself to point somewhere else, such as a stack
// started on non-default ports. Never point this at a real project: every run
// signs up throwaway accounts.
//
// Usage: node scripts/test-integration.mjs [jest args]
import { spawnSync } from 'node:child_process';

const shell = process.platform === 'win32';
// A Windows shell splits arguments on spaces, so quote any that have them.
const quote = (arg) => (shell && /\s/.test(arg) ? `"${arg}"` : arg);
const env = { ...process.env };

if (!env.SUPABASE_TEST_URL || !env.SUPABASE_TEST_ANON_KEY) {
  const status = spawnSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell });
  const json = status.stdout?.slice(status.stdout.indexOf('{'));
  if (status.status !== 0 || !json) {
    console.error('The local Supabase stack is not running. Start it with `npx supabase start`.');
    process.exit(1);
  }
  const { API_URL, ANON_KEY } = JSON.parse(json);
  env.SUPABASE_TEST_URL ??= API_URL;
  env.SUPABASE_TEST_ANON_KEY ??= ANON_KEY;
}

const host = new URL(env.SUPABASE_TEST_URL).hostname;
if (host !== '127.0.0.1' && host !== 'localhost') {
  console.error(`Refusing to run against ${host}: the integration tests only run against a local stack.`);
  process.exit(1);
}

const args = ['jest', '--config', 'jest.integration.config.js', '--runInBand', ...process.argv.slice(2)];
const jest = spawnSync('npx', args.map(quote), {
  stdio: 'inherit',
  env,
  shell,
});
process.exit(jest.status ?? 1);
