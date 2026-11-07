import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

// The Supabase CLI warns about a deprecated supabase/config.toml key a major
// version before it drops the key, and a dropped key is silently ignored: the
// local stack and CI's local-stack jobs would stop honouring that setting
// (#280). Every CLI command loads the config first, so `status` prints the
// warnings whether or not a stack is running. Its exit code doesn't matter, but
// it always reports something, which shows the CLI ran and read the config.
const { stdout, stderr } = spawnSync("npx", ["supabase", "status"], {
  encoding: "utf8",
  shell: process.platform === "win32",
  stdio: ["ignore", "pipe", "pipe"],
});

test("supabase/config.toml uses no key the installed Supabase CLI deprecates", () => {
  assert.notEqual(stdout.trim(), "", `the Supabase CLI didn't run:\n${stderr}`);
  const deprecated = stderr.split(/\r?\n/).filter((line) => /deprecated/i.test(line));
  assert.deepEqual(deprecated, []);
});
