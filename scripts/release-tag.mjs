#!/usr/bin/env node
// Tags a release on main (#311): CI runs this once every other job has passed for a push to main.
// A release PR sets the version (docs/agents/releases.md); the merge that lands it gets the annotated
// tag `v<version>`, "Release v<version>", as the maintainer used to make by hand. Every other merge
// leaves the version alone, so its tag already exists and nothing happens.
//
// In Actions it writes `released` (true when this commit is the release, tagged now or by an earlier
// attempt of the same run) and `tag` to $GITHUB_OUTPUT: the GitHub Release and the store build
// follow only a release (#323).
//
//   node scripts/release-tag.mjs

import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// What to do for `packageVersion`: tag it; resume it, when its tag is already on `head` (a rerun of
// the release commit); or skip it as released earlier. `tagCommit` is the commit the existing tag
// points at. Throws when app.json's version, the one a store build ships, isn't package.json's: no
// tag is better than a wrong one.
export function releaseTagFor({ packageVersion, appVersion, tags, tagCommit, head }) {
  if (appVersion !== packageVersion) {
    throw new Error(`package.json is at ${packageVersion} but app.json's expo.version is ${appVersion}; tagging nothing.`);
  }
  const tag = `v${packageVersion}`;
  if (!tags.includes(tag)) return { action: "tag", tag, message: `Release ${tag}` };
  return head && tagCommit === head ? { action: "resume", tag } : { action: "skip", tag };
}

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));

// Each remote `v*` tag with the commit it points at: an annotated tag's peeled `^{}` line names the
// commit, where its plain line names the tag object.
function remoteTags() {
  const commits = new Map();
  for (const line of git("ls-remote", "--tags", "origin", "refs/tags/v*").split("\n")) {
    const [sha, ref] = line.split("\t");
    if (!ref) continue;
    const name = ref.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, "");
    if (ref.endsWith("^{}") || !commits.has(name)) commits.set(name, sha);
  }
  return commits;
}

function output(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, lines.join(""));
}

export function main() {
  // The remote's tags, not the checkout's: a shallow checkout fetches none.
  const tags = remoteTags();
  const packageVersion = readJson("package.json").version;
  const decision = releaseTagFor({
    packageVersion,
    appVersion: readJson("app.json").expo?.version,
    tags: [...tags.keys()],
    tagCommit: tags.get(`v${packageVersion}`),
    head: git("rev-parse", "HEAD").trim(),
  });
  output({ released: decision.action !== "skip", tag: decision.tag });
  if (decision.action === "skip") {
    console.log(`${decision.tag} is already tagged; nothing to do.`);
    return;
  }
  if (decision.action === "resume") {
    console.log(`${decision.tag} is already on this commit; the release continues.`);
    return;
  }
  // An annotated tag needs a tagger; this one is the Actions bot.
  const bot = ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com"];
  git(...bot, "tag", "-a", decision.tag, "-m", decision.message);
  git("push", "origin", `refs/tags/${decision.tag}`);
  console.log(`Tagged ${decision.tag} on ${git("rev-parse", "--short", "HEAD").trim()}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(`release-tag: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
