import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

// The Info.plist that prebuild would write, after every config plugin has run.
const infoPlist = JSON.parse(
  execFileSync("npx", ["expo", "config", "--type", "introspect", "--json"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "ignore"],
  }),
).ios.infoPlist;

// App Store Connect rejects an upload whose binary references a protected API
// with no purpose string, even when the app never calls it (ITMS-90683, #188).
// expo-location always compiles in CMMotionActivityManager.
test("Info.plist carries a motion purpose string for expo-location's motion code", () => {
  assert.match(infoPlist.NSMotionUsageDescription ?? "", /\S/);
});

test("Info.plist asks for location only while in use", () => {
  assert.match(infoPlist.NSLocationWhenInUseUsageDescription ?? "", /\S/);
  assert.equal(infoPlist.NSLocationAlwaysUsageDescription, undefined);
  assert.equal(infoPlist.NSLocationAlwaysAndWhenInUseUsageDescription, undefined);
});
