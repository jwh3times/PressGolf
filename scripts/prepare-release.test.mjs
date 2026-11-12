import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { checkCut } from "./check-changelog.mjs";
import { planRelease, releaseNotes } from "./prepare-release.mjs";

// A changelog in this repository's shape: a preamble, `Unreleased`, then dated releases.
const changelog = (unreleased) => `# Changelog

Every notable change to Press is recorded here.

## [Unreleased]

${unreleased}

## [1.4.0] - 2026-11-10

### Added

- Tracked shots.
`;

const plan = (unreleased, bump = "auto") =>
  planRelease({ changelog: changelog(unreleased), version: "1.4.0", bump, date: "2026-11-20" });

test("auto releases a patch when Unreleased holds only fixes", () => {
  assert.equal(plan("### Fixed\n\n- A score no longer double-counts.").version, "1.4.1");
});

test("auto releases a minor when Unreleased adds, changes or removes anything, alone or with fixes", () => {
  for (const unreleased of [
    "### Added\n\n- Club spreads.",
    "### Changed\n\n- Suggestions use your carries.",
    "### Removed\n\n- The old bag screen.",
    "### Fixed\n\n- A crash.\n\n### Added\n\n- Club spreads.",
  ]) {
    assert.equal(plan(unreleased).version, "1.5.0", unreleased);
  }
});

test("an explicit bump overrides auto, and only an explicit one reaches a major", () => {
  const fixes = "### Fixed\n\n- A crash.";
  assert.equal(plan(fixes, "patch").version, "1.4.1");
  assert.equal(plan(fixes, "minor").version, "1.5.0");
  assert.equal(plan(fixes, "major").version, "2.0.0");
  assert.equal(plan("### Removed\n\n- Guest scoring.").version, "1.5.0");
});

test("auto treats a security fix as a patch", () => {
  assert.equal(plan("### Security\n\n- A patched dependency.\n\n### Fixed\n\n- A crash.").version, "1.4.1");
});

test("auto refuses a kind of change it can't size, and an explicit bump releases it", () => {
  for (const unreleased of ["### Notes\n\n- Something.", "- An entry under no heading."]) {
    assert.throws(() => plan(unreleased), /choose patch, minor or major/, unreleased);
    assert.equal(plan(unreleased, "minor").version, "1.5.0");
  }
});

test("refuses to release an Unreleased with no entries, whatever the bump", () => {
  for (const unreleased of ["No unreleased changes.", "", "### Fixed\n"]) {
    for (const bump of ["auto", "major"]) {
      assert.throws(() => plan(unreleased, bump), /Unreleased has no entries/, JSON.stringify(unreleased));
    }
  }
});

test("cuts Unreleased into a dated section and starts a new, empty Unreleased", () => {
  assert.equal(
    plan("### Added\n\n- Club spreads.\n\n### Fixed\n\n- A crash.").changelog,
    `# Changelog

Every notable change to Press is recorded here.

## [Unreleased]

No unreleased changes.

## [1.5.0] - 2026-11-20

### Added

- Club spreads.

### Fixed

- A crash.

## [1.4.0] - 2026-11-10

### Added

- Tracked shots.
`,
  );
});

test("moves a link footer on to the new version, as the changelog check requires", () => {
  const repo = "https://github.com/jwh3times/PressGolf";
  const footer = `\n[Unreleased]: ${repo}/compare/v1.4.0...HEAD\n[1.4.0]: ${repo}/compare/v1.3.0...v1.4.0\n`;
  const { changelog: cut } = planRelease({
    changelog: changelog("### Fixed\n\n- A crash.") + footer,
    version: "1.4.0",
    bump: "auto",
    date: "2026-11-20",
  });
  assert.ok(
    cut.endsWith(
      `- Tracked shots.\n\n[Unreleased]: ${repo}/compare/v1.4.1...HEAD\n[1.4.1]: ${repo}/compare/v1.4.0...v1.4.1\n[1.4.0]: ${repo}/compare/v1.3.0...v1.4.0\n`,
    ),
    cut,
  );
  assert.deepEqual(checkCut({ changelog: cut, version: "1.4.1" }), []);
});

test("keeps a footer out of the release when Unreleased is the last section", () => {
  const repo = "https://github.com/o/r";
  const { changelog: cut } = planRelease({
    changelog: `# Changelog\n\n## [Unreleased]\n\n### Added\n\n- The first thing.\n\n[Unreleased]: ${repo}/compare/v0.1.0...HEAD\n`,
    version: "0.1.0",
    bump: "auto",
    date: "2026-11-20",
  });
  assert.equal(
    cut,
    `# Changelog\n\n## [Unreleased]\n\nNo unreleased changes.\n\n## [0.2.0] - 2026-11-20\n\n### Added\n\n- The first thing.\n\n[Unreleased]: ${repo}/compare/v0.2.0...HEAD\n[0.2.0]: ${repo}/compare/v0.1.0...v0.2.0\n`,
  );
});

test("reads a CRLF checkout the same, and writes CRLF back", () => {
  const lf = plan("### Added\n\n- Club spreads.");
  const crlf = planRelease({
    changelog: changelog("### Added\n\n- Club spreads.").replaceAll("\n", "\r\n"),
    version: "1.4.0",
    bump: "auto",
    date: "2026-11-20",
  });
  assert.equal(crlf.version, "1.5.0");
  assert.equal(crlf.changelog, lf.changelog.replaceAll("\n", "\r\n"));
});

const released = `# Changelog

## [Unreleased]

No unreleased changes.

## [1.5.0] - 2026-11-20

### Added

- Club spreads.

## [1.4.0] - 2026-11-10

### Fixed

- A crash.

[Unreleased]: https://github.com/o/r/compare/v1.5.0...HEAD
`;

test("a release's notes are its section, without the heading", () => {
  assert.equal(releaseNotes(released, "1.5.0"), "### Added\n\n- Club spreads.");
});

test("the last release's notes stop before the link footer", () => {
  assert.equal(releaseNotes(released, "1.4.0"), "### Fixed\n\n- A crash.");
  assert.equal(releaseNotes(released.replaceAll("\n", "\r\n"), "1.4.0"), "### Fixed\n\n- A crash.");
});

test("refuses notes for a version the changelog has no section for", () => {
  assert.throws(() => releaseNotes(released, "1.6.0"), /no \[1\.6\.0\] section/);
  assert.throws(() => releaseNotes(released, "1.5"), /no \[1\.5\] section/);
});

test("this repository's changelog has notes for its version, and cuts a release the check accepts", () => {
  const real = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
  const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.match(releaseNotes(real, version), /^### \w+/);
  const withEntry = real.replace(/^## \[Unreleased\]\r?\n[\s\S]*?(?=^## \[)/m, "## [Unreleased]\n\n### Fixed\n\n- A crash.\n\n");
  const next = planRelease({ changelog: withEntry, version, bump: "auto", date: "2026-11-20" });
  assert.deepEqual(checkCut({ changelog: next.changelog, version: next.version }), []);
  assert.equal(releaseNotes(next.changelog, next.version), "### Fixed\n\n- A crash.");
});

test("refuses a bump it doesn't know", () => {
  assert.throws(() => plan("### Fixed\n\n- A crash.", "huge"), /huge.*auto, patch, minor or major/);
});

// The Prepare release workflow (#323) is a thin wrapper around this module: started by hand, it opens
// the release PR with the GitHub App's token, so pull-request CI runs on it, and never merges it.
const workflow = () =>
  readFileSync(new URL("../.github/workflows/prepare-release.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");

test("Prepare release is started only by hand, with the bump as a choice that defaults to auto", () => {
  const text = workflow();
  assert.match(text, /^on:\n  workflow_dispatch:\n/m);
  assert.doesNotMatch(text, /^  (push|pull_request|schedule|workflow_run):/m);
  assert.match(text, /bump:\n(?: {8}.*\n)*? {8}type: choice\n(?: {8}.*\n)*? {8}default: auto\n/);
  assert.match(text, /options: \[auto, patch, minor, major\]/);
});

test("Prepare release plans through this module and refreshes the web baselines", () => {
  const text = workflow();
  assert.match(text, /node scripts\/prepare-release\.mjs prepare "\$BUMP"/);
  assert.match(text, /node scripts\/test-web\.mjs --update-snapshots/);
});

test("Prepare release opens the PR with the App's token, refuses a second, and never merges", () => {
  const text = workflow();
  assert.match(text, /uses: actions\/create-github-app-token@[0-9a-f]{40} # v\d/);
  assert.match(text, /client-id: \$\{\{ secrets\.RELEASE_APP_CLIENT_ID \}\}/);
  assert.match(text, /private-key: \$\{\{ secrets\.RELEASE_APP_PRIVATE_KEY \}\}/);
  // The checkout pushes with the App's token, and the PR is opened with it.
  assert.match(text, /token: \$\{\{ steps\.app\.outputs\.token \}\}/);
  assert.match(text, /GH_TOKEN: \$\{\{ steps\.app\.outputs\.token \}\}\n(?: {8}.*\n)*? {8}run: \|\n(?: {10}.*\n)*? {10}gh pr create/);
  assert.match(text, /startswith\("release\/"\)/);
  assert.doesNotMatch(text, /gh pr merge/);
  assert.match(text, /gh workflow run native-e2e\.yml --ref "release\/v\$VERSION"/);
});
