#!/usr/bin/env node
// Tags a release on main (#311): CI runs this once every other job has passed for a push to main.
// A release PR sets the version (docs/agents/releases.md); the merge that lands it gets the annotated
// tag `v<version>`, "Release v<version>", as the maintainer used to make by hand. Every other merge
// leaves the version alone, so its tag already exists and nothing happens.
//
//   node scripts/release-tag.mjs

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// What to do for `packageVersion`: tag it, or skip it as already tagged. Throws when app.json's
// version, the one a store build ships, isn't package.json's: no tag is better than a wrong one.
export function releaseTagFor({ packageVersion, appVersion, tags }) {
  if (appVersion !== packageVersion) {
    throw new Error(`package.json is at ${packageVersion} but app.json's expo.version is ${appVersion}; tagging nothing.`);
  }
  const tag = `v${packageVersion}`;
  return tags.includes(tag) ? { action: "skip", tag } : { action: "tag", tag, message: `Release ${tag}` };
}

const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), "utf8"));

export function main() {
  // The remote's tags, not the checkout's: a shallow checkout fetches none.
  const tags = git("ls-remote", "--tags", "origin", "refs/tags/v*")
    .split("\n")
    .map((line) => line.split("\t")[1]?.replace(/^refs\/tags\//, "").replace(/\^\{\}$/, ""))
    .filter(Boolean);
  const decision = releaseTagFor({
    packageVersion: readJson("package.json").version,
    appVersion: readJson("app.json").expo?.version,
    tags,
  });
  if (decision.action === "skip") {
    console.log(`${decision.tag} is already tagged; nothing to do.`);
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
