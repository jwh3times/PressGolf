import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { setExpoVersion } from "./set-version.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

// package.json holds the release line the changelog check reads; app.json's expo.version is the
// store version. A release sets both (docs/agents/releases.md).
test("app.json's expo.version equals package.json's version", () => {
  assert.equal(JSON.parse(read("app.json")).expo.version, JSON.parse(read("package.json")).version);
});

test("sets expo.version and leaves the rest of the file as written", () => {
  const before = '{\r\n  "expo": {\r\n    "name": "Press",\r\n    "version": "1.0.0",\r\n    "ios": { "buildNumber": "7" }\r\n  }\r\n}\r\n';
  const after = setExpoVersion(before, "1.1.0");
  assert.equal(after, before.replace('"version": "1.0.0"', '"version": "1.1.0"'));
  assert.equal(setExpoVersion(after, "1.1.0"), after);
});

test("sets the version inside expo, not one before it", () => {
  const text = '{\n  "version": "9.9.9",\n  "expo": {\n    "version": "1.0.0"\n  }\n}\n';
  const after = JSON.parse(setExpoVersion(text, "1.2.0"));
  assert.equal(after.expo.version, "1.2.0");
  assert.equal(after.version, "9.9.9");
});

test("refuses an app.json whose expo object has no version", () => {
  assert.throws(() => setExpoVersion('{\n  "expo": {\n    "name": "Press"\n  }\n}\n', "1.1.0"), /expo\.version/);
  assert.throws(() => setExpoVersion('{\n  "name": "Press"\n}\n', "1.1.0"), /"expo"/);
});

test("this repository's app.json takes a new version", () => {
  const text = read("app.json");
  assert.equal(JSON.parse(setExpoVersion(text, "1.1.0")).expo.version, "1.1.0");
});
