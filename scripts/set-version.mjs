#!/usr/bin/env node
// Sets the release line for a release PR: `package.json` and its lockfile, through npm, and
// `app.json`'s `expo.version`, the store version, which must stay equal to it
// (docs/agents/releases.md, `Bump command`). Running it twice with the same version changes nothing.
//
//   node scripts/set-version.mjs 1.1.0

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// app.json's text with `expo.version` set, keeping the rest of the file as written.
export function setExpoVersion(text, version) {
  const expo = text.indexOf('"expo"');
  if (expo === -1) throw new Error('app.json has no "expo" object.');
  const pattern = /("version"\s*:\s*")[^"]*(")/y;
  const at = text.slice(expo).search(/"version"\s*:/);
  if (at === -1) throw new Error("app.json has no expo.version.");
  pattern.lastIndex = expo + at;
  const next = text.replace(pattern, (_, open, close) => `${open}${version}${close}`);
  if (JSON.parse(next).expo?.version !== version) {
    throw new Error("app.json's first version after \"expo\" is not expo.version.");
  }
  return next;
}

export function main(argv) {
  const version = argv[0];
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? "")) {
    throw new Error("Usage: node scripts/set-version.mjs <major.minor.patch>");
  }
  // One command string: the version was checked above, and npm is a .cmd shim on Windows.
  execSync(`npm version ${version} --no-git-tag-version --allow-same-version`, { cwd: root, stdio: "ignore" });
  const file = path.join(root, "app.json");
  writeFileSync(file, setExpoVersion(readFileSync(file, "utf8"), version));
  console.log(`package.json and app.json are at ${version}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`set-version: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
