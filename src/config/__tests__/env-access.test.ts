import fs from 'fs';
import path from 'path';

/**
 * Stands in for two rules that came from `eslint-config-expo` and have no
 * oxlint equivalent: `expo/no-env-var-destructuring` and
 * `expo/no-dynamic-env-var`.
 *
 * They exist because Expo does not read the environment at run time — it
 * substitutes `process.env.EXPO_PUBLIC_…` into the bundle as a literal while
 * building. Anything the bundler cannot see statically is therefore not
 * replaced, and arrives as `undefined` on the device while working perfectly
 * on a laptop. That failure mode is silent, survives every other check here,
 * and this app reads its Supabase URL and key that way.
 */

const SRC = path.join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

/** Strips comments, so prose about `process.env` does not fail the check. */
function code(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const files = sourceFiles(SRC);

describe('environment variables are readable by the bundler', () => {
  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('never destructures process.env', () => {
    const offenders = files.filter((file) =>
      /(?:const|let|var)\s*\{[^}]*\}\s*=\s*process\.env/.test(code(file)),
    );
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('never indexes process.env dynamically', () => {
    // process.env[name] — the bundler cannot know what `name` is.
    const offenders = files.filter((file) => /process\.env\s*\[/.test(code(file)));
    expect(offenders.map((f) => path.relative(SRC, f))).toEqual([]);
  });

  it('only reads variables the bundler will inline', () => {
    // Expo substitutes EXPO_PUBLIC_* and NODE_ENV. Anything else is undefined
    // on a device however well it works in a terminal.
    const allowed = /^(EXPO_PUBLIC_[A-Z0-9_]+|NODE_ENV)$/;
    const bad: string[] = [];
    for (const file of files) {
      for (const [, name] of code(file).matchAll(/process\.env\.([A-Za-z0-9_]+)/g)) {
        if (!allowed.test(name)) bad.push(`${path.relative(SRC, file)}: ${name}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
