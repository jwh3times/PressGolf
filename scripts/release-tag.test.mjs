import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
  // Every other job runs on a push to main, but for those that run only on pull requests.
  const onMain = Object.entries(jobs)
    .filter(([other, b]) => other !== key && ifOf(b) !== "github.event_name == 'pull_request'")
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
