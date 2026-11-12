#!/usr/bin/env node
// Plans a release for the Prepare release workflow (#323): the next version and the changelog with
// `Unreleased` cut into a dated section, and the notes the GitHub Release carries
// (docs/agents/releases.md).
//
//   node scripts/prepare-release.mjs prepare <auto|patch|minor|major>
//     Cuts CHANGELOG.md, sets the version through scripts/set-version.mjs, and prints the new
//     version (also written to $GITHUB_OUTPUT as `version` in Actions).
//   node scripts/prepare-release.mjs notes <version>
//     Prints that version's section of CHANGELOG.md.

import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { declaredVersion } from "./next-version.mjs";
import { main as setVersion } from "./set-version.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The kinds of change (`### Added`, …) that hold at least one entry; an entry under no heading is "".
function kindsOf(body) {
  const kinds = new Set();
  let kind = "";
  for (const line of body.split("\n")) {
    const heading = line.match(/^### (.+)$/);
    if (heading) kind = heading[1].trim();
    else if (line.startsWith("- ")) kinds.add(kind);
  }
  return [...kinds];
}

// A line of a Keep a Changelog link footer: `[1.4.0]: https://…`.
const FOOTER_LINK = /^\[[^\]]+\]: \S/;

// Where the section headed at `start` ends: at the next section, the link footer, or the end of the
// file.
function sectionEnd(lines, start) {
  const next = lines.findIndex((line, index) => index > start && (line.startsWith("## [") || FOOTER_LINK.test(line)));
  return next === -1 ? lines.length : next;
}

function unreleasedBounds(lines) {
  const start = lines.findIndex((line) => /^## \[Unreleased\]/.test(line));
  if (start === -1) throw new Error("CHANGELOG.md has no ## [Unreleased] section.");
  return { start, end: sectionEnd(lines, start) };
}

// The footer's `[Unreleased]` link moved on to compare from `next`, and a link for `next` itself
// after it. A changelog with no footer is returned as it is.
function moveFooter(lines, previous, next) {
  const at = lines.findIndex((line) => /^\[Unreleased\]: \S*\/compare\/\S+\.\.\.HEAD\s*$/.test(line));
  if (at === -1) return lines;
  const base = lines[at].match(/^\[Unreleased\]: (\S*)\/compare\//)[1];
  return [
    ...lines.slice(0, at),
    `[Unreleased]: ${base}/compare/v${next}...HEAD`,
    `[${next}]: ${base}/compare/v${previous}...v${next}`,
    ...lines.slice(at + 1),
  ];
}

function bumped(version, level) {
  const [major, minor, patch] = version.split(".").map(Number);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

// Keep a Changelog's kinds of change, by the release they need. `auto` never chooses a major.
const MINOR = ["Added", "Changed", "Deprecated", "Removed"];
const PATCH = ["Fixed", "Security"];

function autoLevel(kinds) {
  const unknown = kinds.filter((kind) => !MINOR.includes(kind) && !PATCH.includes(kind));
  if (unknown.length > 0) {
    const names = unknown.map((kind) => (kind ? `"${kind}"` : "an entry under no heading")).join(", ");
    throw new Error(`auto can't size ${names}: choose patch, minor or major.`);
  }
  return kinds.some((kind) => MINOR.includes(kind)) ? "minor" : "patch";
}

// The body of `version`'s section in `changelog`, without its heading: the GitHub Release's notes.
export function releaseNotes(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith(`## [${version}] - `));
  if (start === -1) throw new Error(`CHANGELOG.md has no [${version}] section.`);
  return lines.slice(start + 1, sectionEnd(lines, start)).join("\n").trim();
}

// The release a Prepare release run makes from `changelog` at `version`: the new version and the
// changelog with Unreleased cut into its section, dated `date` (YYYY-MM-DD). Throws, saying why, when
// there is nothing to release or `auto` can't size it.
export function planRelease({ changelog, version, bump, date }) {
  if (!["auto", "patch", "minor", "major"].includes(bump)) {
    throw new Error(`The bump is "${bump}"; it must be auto, patch, minor or major.`);
  }
  const eol = changelog.includes("\r\n") ? "\r\n" : "\n";
  const lines = changelog.split(/\r?\n/);
  const { start, end } = unreleasedBounds(lines);
  const body = lines.slice(start + 1, end).join("\n").trim();
  const kinds = kindsOf(body);
  if (kinds.length === 0) {
    throw new Error("Unreleased has no entries, so there is nothing to release.");
  }
  const next = bumped(version, bump === "auto" ? autoLevel(kinds) : bump);
  const cut = [
    ...lines.slice(0, start + 1),
    "",
    "No unreleased changes.",
    "",
    `## [${next}] - ${date}`,
    "",
    ...body.split("\n"),
    "",
    ...lines.slice(end),
  ];
  return { version: next, changelog: moveFooter(cut, version, next).join(eol) };
}

const changelogPath = path.join(root, "CHANGELOG.md");

export function main(argv) {
  const [command, arg] = argv;
  if (command === "notes" && arg) {
    process.stdout.write(`${releaseNotes(readFileSync(changelogPath, "utf8"), arg)}\n`);
    return;
  }
  if (command !== "prepare" || !arg) {
    throw new Error("Usage: node scripts/prepare-release.mjs prepare <auto|patch|minor|major> | notes <version>");
  }
  const plan = planRelease({
    changelog: readFileSync(changelogPath, "utf8"),
    version: declaredVersion(root),
    bump: arg,
    date: new Date().toISOString().slice(0, 10),
  });
  writeFileSync(changelogPath, plan.changelog);
  setVersion([plan.version]);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `version=${plan.version}\n`);
  console.log(plan.version);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    // In Actions, an annotation, so a refusal's reason shows on the run's summary.
    const prefix = process.env.GITHUB_ACTIONS === "true" ? "::error::" : "";
    console.error(`${prefix}prepare-release: ${error instanceof Error ? error.message : error}`);
    process.exitCode = 1;
  }
}
