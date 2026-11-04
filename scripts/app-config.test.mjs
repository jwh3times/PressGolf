import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const expoConfig = (type) =>
  JSON.parse(
    execFileSync("npx", ["expo", "config", "--type", type, "--json"], {
      encoding: "utf8",
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );

// The Info.plist that prebuild would write, after every config plugin has run.
const infoPlist = expoConfig("introspect").ios.infoPlist;

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

// SDK 58's native template turns R8 on for Android release builds, and under it
// WorkManager (from react-native-maps) can't create its database: the release
// build crashed on launch (#250). Only the native smoke run catches that, an
// hour later, so this keeps the setting that turns R8 off from going quietly.
test("Android release builds stay unminified", () => {
  const entry = expoConfig("prebuild").plugins.find((p) => [].concat(p)[0] === "expo-build-properties");
  assert.equal(entry?.[1]?.android?.enableMinifyInReleaseBuilds, false);
});
