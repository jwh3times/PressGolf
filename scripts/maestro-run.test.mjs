import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Stands in for Maestro: records the attempt in the JUnit file it was given,
// creates the screenshot directory, and exits with the next code in FAKE_RESULTS.
const FAKE_MAESTRO = `#!/bin/sh
out=""; dir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --output) out="$2"; shift ;;
    --test-output-dir) dir="$2"; shift ;;
  esac
  shift
done
mkdir -p "$dir"
n=$(cat "$FAKE_COUNT" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$FAKE_COUNT"
echo "attempt $n" > "$out"
exit "$(echo "$FAKE_RESULTS" | cut -d, -f"$n")"
`;

/** Runs .maestro/run.sh against the fake, with each attempt exiting as `results` says. */
function runSmoke(results) {
  const root = mkdtempSync(path.join(tmpdir(), "maestro-run-"));
  const bin = path.join(root, "bin");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "maestro"), FAKE_MAESTRO);
  chmodSync(path.join(bin, "maestro"), 0o755);
  const env = path.join(root, "github-env");
  writeFileSync(env, "");
  const output = path.join(root, "out");
  const run = spawnSync("sh", [".maestro/run.sh", "device-1", output], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      GITHUB_ENV: env,
      FAKE_COUNT: path.join(root, "count"),
      FAKE_RESULTS: results.join(","),
    },
  });
  const junit = (n) => path.join(output, `junit-attempt-${n}.xml`);
  return {
    status: run.status,
    githubEnv: readFileSync(env, "utf8"),
    junit: (n) => (existsSync(junit(n)) ? readFileSync(junit(n), "utf8").trim() : null),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const hasSh = spawnSync("sh", ["-c", "exit 0"]).status === 0;

test("a first attempt that fails and a retry that passes keeps both reports and flags the failure", { skip: !hasSh }, () => {
  const run = runSmoke([1, 0]);
  try {
    assert.equal(run.status, 0);
    assert.equal(run.junit(1), "attempt 1");
    assert.equal(run.junit(2), "attempt 2");
    assert.match(run.githubEnv, /^MAESTRO_ATTEMPT_FAILED=true$/m);
  } finally {
    run.cleanup();
  }
});

test("a first attempt that passes runs once and flags nothing", { skip: !hasSh }, () => {
  const run = runSmoke([0]);
  try {
    assert.equal(run.status, 0);
    assert.equal(run.junit(1), "attempt 1");
    assert.equal(run.junit(2), null);
    assert.equal(run.githubEnv, "");
  } finally {
    run.cleanup();
  }
});

test("two failed attempts fail the run", { skip: !hasSh }, () => {
  const run = runSmoke([1, 1]);
  try {
    assert.equal(run.status, 1);
    assert.equal(run.junit(2), "attempt 2");
    assert.match(run.githubEnv, /^MAESTRO_ATTEMPT_FAILED=true$/m);
  } finally {
    run.cleanup();
  }
});
