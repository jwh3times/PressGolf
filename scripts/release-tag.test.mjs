import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { releaseTagFor } from "./release-tag.mjs";

const readCi = () => readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");

/**
 * The CI workflow's jobs, by key, each as its own block of text: enough to read `if:`, `needs:` and
 * `permissions:`. No YAML parser is a dependency, so this reads ci.yml as it is laid out: jobs at two
 * spaces, their keys at four, and `needs:` as a one-line list.
 */
function ciJobs() {
  const text = readCi();
  const jobs = text.slice(text.indexOf("\njobs:\n"));
  const blocks = jobs.split(/\n(?=  [a-z][a-z-]*:\n)/).slice(1);
  return Object.fromEntries(blocks.map((block) => [block.match(/^  ([a-z-]+):/)[1], block]));
}
const needsOf = (block) => (block.match(/^    needs: \[(.*)\]$/m)?.[1] ?? "").split(",").map((n) => n.trim()).filter(Boolean);
const ifOf = (block) => block.match(/^    if: (.*)$/m)?.[1] ?? null;

// CI tags a release once its merge to main has passed (#311): the release PR set the version, and
// nothing tags an ordinary merge, which leaves the version alone (docs/agents/releases.md).
test("tags a version that has no tag yet", () => {
  assert.deepEqual(releaseTagFor({ packageVersion: "1.5.0", appVersion: "1.5.0", tags: ["v1.3.0", "v1.4.0"] }), {
    action: "tag",
    tag: "v1.5.0",
    message: "Release v1.5.0",
  });
});

test("skips a version already tagged: every ordinary merge", () => {
  assert.deepEqual(releaseTagFor({ packageVersion: "1.4.0", appVersion: "1.4.0", tags: ["v1.3.0", "v1.4.0"] }), {
    action: "skip",
    tag: "v1.4.0",
  });
});

// A rerun of the release commit's run finds its own tag: the GitHub Release and the store build still
// follow, but nothing is tagged twice (#323).
test("resumes a release whose tag is already on this commit", () => {
  assert.deepEqual(
    releaseTagFor({ packageVersion: "1.5.0", appVersion: "1.5.0", tags: ["v1.4.0", "v1.5.0"], tagCommit: "abc123", head: "abc123" }),
    { action: "resume", tag: "v1.5.0" },
  );
  assert.deepEqual(
    releaseTagFor({ packageVersion: "1.5.0", appVersion: "1.5.0", tags: ["v1.5.0"], tagCommit: "abc123", head: "def456" }),
    { action: "skip", tag: "v1.5.0" },
  );
});

test("refuses to tag when app.json's version isn't package.json's, naming both", () => {
  assert.throws(
    () => releaseTagFor({ packageVersion: "1.5.0", appVersion: "1.4.0", tags: ["v1.4.0"] }),
    /package\.json.*1\.5\.0.*app\.json.*1\.4\.0/,
  );
});

test("CI tags only a push to main, once every other job that runs there has passed", () => {
  const jobs = ciJobs();
  const tag = Object.entries(jobs).find(([, block]) => /^    name: Tag the release$/m.test(block));
  assert.ok(tag, "ci.yml has a job named \"Tag the release\"");
  const [key, block] = tag;
  assert.equal(ifOf(block), "github.event_name == 'push' && github.ref == 'refs/heads/main'");
  assert.match(block, /node scripts\/release-tag\.mjs/);
  // Every other job runs on a push to main, but for those that run only on pull requests and those
  // that follow the tag.
  const onMain = Object.entries(jobs)
    .filter(([other, b]) => other !== key && ifOf(b) !== "github.event_name == 'pull_request'" && !needsOf(b).includes(key))
    .map(([other]) => other);
  assert.deepEqual([...needsOf(block)].sort(), onMain.sort());
});

test("only the tag job can write to the repository", () => {
  assert.match(readCi(), /^permissions:\n  contents: read$/m);
  const writers = Object.entries(ciJobs()).filter(([, block]) => /contents: write/.test(block));
  assert.deepEqual(
    writers.map(([, block]) => block.match(/^    name: (.*)$/m)[1]),
    ["Tag the release"],
  );
});

const jobNamed = (name) => Object.entries(ciJobs()).find(([, block]) => block.includes(`\n    name: ${name}\n`));

// The tag job says whether this commit is a release, and publishes its GitHub Release with the
// changelog section as the notes, once only (#323).
test("the tag job publishes a release's GitHub Release, with its changelog section as the notes", () => {
  const [, block] = jobNamed("Tag the release");
  assert.match(block, /^    outputs:\n      released: \$\{\{ steps\.tag\.outputs\.released \}\}$/m);
  assert.match(block, /^        id: tag$/m);
  assert.match(block, /^        if: steps\.tag\.outputs\.released == 'true'$/m);
  assert.match(block, /node scripts\/prepare-release\.mjs notes/);
  assert.match(block, /gh release view "\$TAG" .*\|\| gh release create "\$TAG"/);
});

// Store builds follow a release (#323): only once the tag job has passed, so only after every other
// job on main, in the production environment that holds the Expo token, waiting for the builds.
test("Store build follows only a release, in production, and waits for both builds", () => {
  const found = jobNamed("Store build");
  assert.ok(found, "ci.yml has a job named \"Store build\"");
  const [, block] = found;
  const [tagKey] = jobNamed("Tag the release");
  assert.deepEqual(needsOf(block), [tagKey]);
  assert.equal(ifOf(block), `needs.${tagKey}.outputs.released == 'true'`);
  assert.match(block, /^    environment: production$/m);
  assert.match(block, /EXPO_TOKEN: \$\{\{ secrets\.EXPO_TOKEN \}\}/);
  // A pinned CLI, since this job holds the token; nothing bumps it, so it moves by hand.
  assert.match(block, /npx eas-cli@\d+\.\d+\.\d+ build --profile production --platform all --auto-submit --non-interactive/);
  assert.doesNotMatch(block, /--no-wait/);
});

test("no job but Store build sees the Expo token", () => {
  const dir = new URL("../.github/workflows/", import.meta.url);
  const readers = readdirSync(dir)
    .filter((file) => /\.ya?ml$/.test(file))
    .flatMap((file) => {
      const text = readFileSync(new URL(file, dir), "utf8").replace(/\r\n/g, "\n");
      return text.includes("EXPO_TOKEN") ? text.split(/\n(?=  [a-z][a-z-]*:\n)/).filter((b) => b.includes("EXPO_TOKEN")) : [];
    })
    .map((block) => block.match(/^    name: (.*)$/m)?.[1]);
  assert.deepEqual(readers, ["Store build"]);
});
