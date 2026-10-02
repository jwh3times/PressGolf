// Builds the web export and runs the Playwright suite in the Playwright Linux
// container, the same image CI uses, so screenshots match the committed
// baselines whatever machine runs it. Docker is required.
//
// Usage: node scripts/test-web.mjs [playwright test args], e.g. --update-snapshots
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('node_modules/@playwright/test/package.json', 'utf8'));
const image = `mcr.microsoft.com/playwright:v${version}-noble`;

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('npx', ['expo', 'export', '--platform', 'web']);
run('docker', [
  'run', '--rm', '--ipc=host',
  '-v', `${process.cwd()}:/work`, '-w', '/work',
  image,
  'node', 'node_modules/@playwright/test/cli.js', 'test', ...process.argv.slice(2),
]);
