import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { injectSkillBanner, syncMirrors } from "./sync-agents.mjs";

function makeFixtureRoot({ withAgents = true } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "pressgolf-sync-"));
  if (withAgents) {
    mkdirSync(path.join(root, ".claude", "agents"), { recursive: true });
  }
  mkdirSync(path.join(root, ".agents", "skills", "demo", "agents"), {
    recursive: true,
  });
  writeFileSync(
    path.join(root, ".agents", "skills", "demo", "SKILL.md"),
    [
      "---",
      "name: demo",
      "description: A demo skill.",
      "---",
      "",
      "Body.",
    ].join("\n"),
  );
  writeFileSync(
    path.join(root, ".agents", "skills", "demo", "agents", "openai.yaml"),
    "instructions: do the thing\n",
  );
  return root;
}

test("injectSkillBanner inserts a YAML-comment banner as line 2, keeping frontmatter valid", () => {
  const raw = [
    "---",
    "name: demo",
    "description: Demo.",
    "---",
    "",
    "Body.",
  ].join("\n");
  const result = injectSkillBanner(".agents/skills/demo/SKILL.md", raw);
  const lines = result.split("\n");
  assert.equal(lines[0], "---");
  assert.match(lines[1], /^# GENERATED — do not edit/);
  assert.equal(lines[2], "name: demo");
  assert.match(result, /---\n[\s\S]*name: demo/);
});

test("syncMirrors generates .claude/skills from .agents/skills, copying non-SKILL.md files byte-for-byte", () => {
  const root = makeFixtureRoot();
  try {
    syncMirrors(root, { check: false });
    const skillMd = readFileSync(
      path.join(root, ".claude", "skills", "demo", "SKILL.md"),
      "utf8",
    );
    assert.match(skillMd, /^---\n# GENERATED/);
    assert.match(skillMd, /name: demo/);

    const yaml = readFileSync(
      path.join(root, ".claude", "skills", "demo", "agents", "openai.yaml"),
      "utf8",
    );
    assert.equal(yaml, "instructions: do the thing\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("syncMirrors --check reports drift without writing, and non-check mode prunes orphans", () => {
  const root = makeFixtureRoot();
  try {
    syncMirrors(root, { check: false });

    // Remove the source file; the generated copy is now orphaned.
    rmSync(
      path.join(root, ".agents", "skills", "demo", "agents", "openai.yaml"),
    );

    const checked = syncMirrors(root, { check: true });
    assert.ok(
      checked.stale.some((f) => f.includes("openai.yaml")),
      "expected orphaned generated file to be reported as stale",
    );

    syncMirrors(root, { check: false });
    assert.throws(() =>
      readFileSync(
        path.join(root, ".claude", "skills", "demo", "agents", "openai.yaml"),
      ),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("syncMirrors reports and removes a stray symlink in the generated tree (regression guard)", () => {
  const root = makeFixtureRoot();
  mkdirSync(path.join(root, ".claude", "skills"), { recursive: true });
  const stray = path.join(root, ".claude", "skills", "stray-symlink");
  symlinkSync(path.join(root, ".agents", "skills", "demo"), stray, "junction");
  try {
    const checked = syncMirrors(root, { check: true });
    assert.ok(
      checked.stale.includes(".claude/skills/stray-symlink (orphaned)"),
      "expected the stray symlink to be reported before pruning",
    );

    syncMirrors(root, { check: false });
    assert.throws(() => lstatSync(stray));
    // Pruning the link must not follow it into the authored source.
    assert.ok(existsSync(path.join(root, ".agents", "skills", "demo", "SKILL.md")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("syncMirrors runs the skills direction when there are no specialist agents", () => {
  const root = makeFixtureRoot({ withAgents: false });
  try {
    const { stale } = syncMirrors(root, { check: false });
    assert.deepEqual(stale, []);
    assert.deepEqual(syncMirrors(root, { check: true }).stale, []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("syncMirrors removes the folder of a deleted skill, not just its files", () => {
  const root = makeFixtureRoot();
  try {
    syncMirrors(root, { check: false });
    rmSync(path.join(root, ".agents", "skills", "demo"), { recursive: true });

    syncMirrors(root, { check: false });
    assert.equal(existsSync(path.join(root, ".claude", "skills", "demo")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
