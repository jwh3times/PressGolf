import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// The Edge Functions run on Deno and import supabase-js by a versioned
// specifier (`npm:@supabase/supabase-js@<version>`). Dependabot reads only the
// root npm manifest, so that pin never moves on its own, and every merge to
// main deploys it (#363). This holds it to the version the app's lockfile
// resolves: a supabase-js bump goes red here until the functions move with it,
// and so does an import that drops its version and floats.
const root = fileURLToPath(new URL("..", import.meta.url));
const functionsDir = join(root, "supabase", "functions");

const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const appVersion = lock.packages["node_modules/@supabase/supabase-js"]?.version;

// Every quoted string naming the package, whatever its prefix (npm:, jsr:, a
// URL) or subpath (`/cors`). The version, when there is one, follows the name.
const quoted = /(['"`])([^'"`\n]*@supabase\/supabase-js(?![\w-])[^'"`\n]*)\1(\s*:)?/g;
const versioned = /@supabase\/supabase-js@([^/'"`\s]+)/;

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx|js|mjs|json|jsonc|lock)$/.test(entry.name) ? [path] : [];
  });
}

let found;
// Collected on first use, so a missing supabase/functions fails a named test.
function specifiers() {
  found ??= sourceFiles(functionsDir).flatMap((path) => {
    const file = relative(root, path).replaceAll("\\", "/");
    const isJson = /\.(json|jsonc|lock)$/.test(path);
    return [...readFileSync(path, "utf8").matchAll(quoted)]
      // An import map's key (`"@supabase/supabase-js": "npm:…@2.119.2"`) is a
      // name, not an import: its value carries the version.
      .filter((match) => !(isJson && match[3] && !versioned.test(match[2])))
      .map((match) => ({ file, specifier: match[2], version: match[2].match(versioned)?.[1] }));
  });
  return found;
}

test("the lockfile resolves @supabase/supabase-js", () => {
  assert.match(appVersion ?? "", /^\d+\.\d+\.\d+/);
});

test("the Edge Functions import @supabase/supabase-js", () => {
  // Guards the checks below: with nothing found, both would pass on an empty list.
  assert.ok(specifiers().length > 0, `no @supabase/supabase-js import under ${functionsDir}`);
});

test("every @supabase/supabase-js import in the Edge Functions carries a version", () => {
  const floating = specifiers().filter((s) => s.version === undefined);
  assert.deepEqual(
    floating,
    [],
    "pin these to an exact version: every merge to main deploys the functions",
  );
});

test("every Edge Function pins the @supabase/supabase-js version the app's lockfile resolves", () => {
  const stale = specifiers().filter((s) => s.version !== undefined && s.version !== appVersion);
  assert.deepEqual(
    stale,
    [],
    `move these to ${appVersion}, the version package-lock.json resolves`,
  );
});
