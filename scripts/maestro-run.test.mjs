import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// Stands in for Maestro: records the attempt in the JUnit file it was given,
// creates the screenshot directory, logs the flow it ran, and exits with the
// next code listed for that flow in $FAKE_STATE/<flow>.results (0 when none).
const FAKE_MAESTRO = `#!/bin/sh
out=""; dir=""; flow=""
while [ $# -gt 0 ]; do
  case "$1" in
    --output) out="$2"; shift ;;
    --test-output-dir) dir="$2"; shift ;;
    *.yml) flow="$(basename "$1" .yml)" ;;
  esac
  shift
done
mkdir -p "$dir"
count="$FAKE_STATE/$flow.count"
n=$(cat "$count" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$count"
echo "$flow attempt $n" > "$out"
echo "maestro $flow" >> "$FAKE_STATE/log"
code=$(cut -d, -f"$n" "$FAKE_STATE/$flow.results" 2>/dev/null)
exit "\${code:-0}"
`;

// Stands in for xcrun and adb: logs each call so a test can see when the
// text size changed relative to the flows.
const FAKE_TOOL = (name) => `#!/bin/sh
echo "${name} $*" >> "$FAKE_STATE/log"
`;

/**
 * A scratch workspace with fake tools on PATH and a flows directory holding
 * the named flows. `results` maps a flow to the exit code of each attempt.
 */
function workspace(flows, results = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "maestro-run-"));
  const bin = path.join(root, "bin");
  const state = path.join(root, "state");
  const flowDir = path.join(root, "flows");
  for (const dir of [bin, state, flowDir]) mkdirSync(dir);
  writeFileSync(path.join(bin, "maestro"), FAKE_MAESTRO);
  for (const tool of ["xcrun", "adb"]) writeFileSync(path.join(bin, tool), FAKE_TOOL(tool));
  for (const tool of ["maestro", "xcrun", "adb"]) chmodSync(path.join(bin, tool), 0o755);
  for (const flow of flows) writeFileSync(path.join(flowDir, `${flow}.yml`), "appId: test\n---\n");
  for (const [flow, codes] of Object.entries(results)) {
    writeFileSync(path.join(state, `${flow}.results`), codes.join(","));
  }
  const githubEnv = path.join(root, "github-env");
  writeFileSync(githubEnv, "");
  const output = path.join(root, "out");

  const run = (script, args) =>
    spawnSync("sh", [script, ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        GITHUB_ENV: githubEnv,
        FAKE_STATE: state,
        MAESTRO_FLOWS: flowDir,
      },
    });
  const read = (file) => (existsSync(file) ? readFileSync(file, "utf8").trim() : null);

  return {
    output,
    run,
    githubEnv: () => readFileSync(githubEnv, "utf8"),
    log: () => (read(path.join(state, "log")) ?? "").split("\n").filter(Boolean),
    read: (...parts) => read(path.join(output, ...parts)),
    exists: (...parts) => existsSync(path.join(output, ...parts)),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

const hasSh = spawnSync("sh", ["-c", "exit 0"]).status === 0;

/** Runs .maestro/run.sh over `flows`, with each flow's attempts exiting as `results` says. */
function runFlows(flows, results) {
  const ws = workspace(flows, results);
  const run = ws.run(".maestro/run.sh", ["device-1", ws.output]);
  return { ...ws, status: run.status, stdout: run.stdout };
}

test("a first attempt that fails and a retry that passes keeps both reports and flags the failure", { skip: !hasSh }, () => {
  const run = runFlows(["round"], { round: [1, 0] });
  try {
    assert.equal(run.status, 0);
    assert.equal(run.read("round", "junit-attempt-1.xml"), "round attempt 1");
    assert.equal(run.read("round", "junit-attempt-2.xml"), "round attempt 2");
    assert.ok(run.exists("round", "attempt-1"));
    assert.ok(run.exists("round", "attempt-2"));
    assert.match(run.githubEnv(), /^MAESTRO_ATTEMPT_FAILED=true$/m);
  } finally {
    run.cleanup();
  }
});

test("a first attempt that passes runs once and flags nothing", { skip: !hasSh }, () => {
  const run = runFlows(["round"], { round: [0] });
  try {
    assert.equal(run.status, 0);
    assert.equal(run.read("round", "junit-attempt-1.xml"), "round attempt 1");
    assert.equal(run.read("round", "junit-attempt-2.xml"), null);
    assert.equal(run.githubEnv(), "");
  } finally {
    run.cleanup();
  }
});

test("two failed attempts fail the run", { skip: !hasSh }, () => {
  const run = runFlows(["round"], { round: [1, 1] });
  try {
    assert.equal(run.status, 1);
    assert.equal(run.read("round", "junit-attempt-2.xml"), "round attempt 2");
    assert.match(run.githubEnv(), /^MAESTRO_ATTEMPT_FAILED=true$/m);
  } finally {
    run.cleanup();
  }
});

test("every flow runs in name order, each with its own retry and its own output", { skip: !hasSh }, () => {
  const run = runFlows(["round", "card-entry", "outing"], { "card-entry": [1, 0] });
  try {
    assert.equal(run.status, 0);
    assert.deepEqual(run.log(), ["maestro card-entry", "maestro card-entry", "maestro outing", "maestro round"]);
    assert.equal(run.read("card-entry", "junit-attempt-2.xml"), "card-entry attempt 2");
    assert.equal(run.read("outing", "junit-attempt-1.xml"), "outing attempt 1");
    assert.equal(run.read("outing", "junit-attempt-2.xml"), null);
    assert.match(run.stdout, /attempt 1 of 2 failed: card-entry/);
  } finally {
    run.cleanup();
  }
});

test("a flow that fails twice fails the run but the later flows still run", { skip: !hasSh }, () => {
  const run = runFlows(["a-first", "b-second"], { "a-first": [1, 1] });
  try {
    assert.equal(run.status, 1);
    assert.deepEqual(run.log(), ["maestro a-first", "maestro a-first", "maestro b-second"]);
    assert.equal(run.read("b-second", "junit-attempt-1.xml"), "b-second attempt 1");
  } finally {
    run.cleanup();
  }
});

test("no flows to run is a failure, not a silent pass", { skip: !hasSh }, () => {
  const run = runFlows([]);
  try {
    assert.equal(run.status, 1);
  } finally {
    run.cleanup();
  }
});

/** Runs .maestro/passes.sh for `platform` over `flows`. */
function runPasses(platform, flows, results) {
  const ws = workspace(flows, results);
  const run = ws.run(".maestro/passes.sh", [platform, "device-1", ws.output]);
  return { ...ws, status: run.status };
}

test("iOS runs the flows at default size, then at the largest Dynamic Type size, then restores it", { skip: !hasSh }, () => {
  const run = runPasses("ios", ["round"]);
  try {
    assert.equal(run.status, 0);
    assert.deepEqual(run.log(), [
      "maestro round",
      "xcrun simctl ui device-1 content_size accessibility-extra-extra-extra-large",
      "maestro round",
      "xcrun simctl ui device-1 content_size large",
    ]);
    assert.equal(run.read("default", "round", "junit-attempt-1.xml"), "round attempt 1");
    assert.equal(run.read("large-text", "round", "junit-attempt-1.xml"), "round attempt 2");
  } finally {
    run.cleanup();
  }
});

test("Android runs the flows at default size, then at font scale 2.0, then restores it", { skip: !hasSh }, () => {
  const run = runPasses("android", ["round"]);
  try {
    assert.equal(run.status, 0);
    assert.deepEqual(run.log(), [
      "maestro round",
      "adb -s device-1 shell settings put system font_scale 2.0",
      "maestro round",
      "adb -s device-1 shell settings put system font_scale 1.0",
    ]);
  } finally {
    run.cleanup();
  }
});

test("a failure in the default pass still runs the large-text pass, and fails overall", { skip: !hasSh }, () => {
  const run = runPasses("ios", ["round"], { round: [1, 1, 0] });
  try {
    assert.equal(run.status, 1);
    assert.equal(run.log().filter((line) => line === "maestro round").length, 3);
    assert.equal(run.read("large-text", "round", "junit-attempt-1.xml"), "round attempt 3");
  } finally {
    run.cleanup();
  }
});

test("a failure only at large text fails overall", { skip: !hasSh }, () => {
  const run = runPasses("android", ["round"], { round: [0, 1, 1] });
  try {
    assert.equal(run.status, 1);
  } finally {
    run.cleanup();
  }
});

test("an unknown platform is refused before anything runs", { skip: !hasSh }, () => {
  const run = runPasses("web", ["round"]);
  try {
    assert.equal(run.status, 2);
    assert.deepEqual(run.log(), []);
  } finally {
    run.cleanup();
  }
});

test("the iOS status bar is pinned through the simulator's override", { skip: !hasSh }, () => {
  const ws = workspace([]);
  try {
    const run = ws.run(".maestro/pin-status-bar.sh", ["ios", "device-1"]);
    assert.equal(run.status, 0);
    assert.deepEqual(ws.log(), [
      "xcrun simctl status_bar device-1 override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3 --dataNetwork wifi",
    ]);
  } finally {
    ws.cleanup();
  }
});

test("the Android status bar is pinned through System UI demo mode", { skip: !hasSh }, () => {
  const ws = workspace([]);
  try {
    const run = ws.run(".maestro/pin-status-bar.sh", ["android", "device-1"]);
    assert.equal(run.status, 0);
    const log = ws.log();
    assert.equal(log[0], "adb -s device-1 shell settings put global sysui_demo_allowed 1");
    assert.match(log[1], /demo -e command enter$/);
    assert.ok(log.some((line) => /command clock -e hhmm 0941$/.test(line)));
    assert.ok(log.some((line) => /command battery -e level 100 -e plugged false$/.test(line)));
  } finally {
    ws.cleanup();
  }
});
