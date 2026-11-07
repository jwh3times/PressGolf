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

// What prebuild would write, after every config plugin has run.
const introspected = expoConfig("introspect");
const infoPlist = introspected.ios.infoPlist;

// The app's own AndroidManifest.xml permissions, as { name: "remove" | "declared" }.
// Library manifests are merged in later, at build time, so a permission a library
// adds (network state, wake lock) is not here unless the app blocks it.
const manifestPermissions = Object.fromEntries(
  (introspected._internal.modResults.android.manifest.manifest["uses-permission"] ?? []).map(({ $ }) => [
    $["android:name"],
    $["tools:node"] === "remove" ? "remove" : "declared",
  ]),
);

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

// A store build that declares a permission has to explain it on the Play listing
// and in the Data safety form (#278). Expo's Android template declares these three,
// and Press uses none of them. The advertising ID isn't declared by anything today;
// it is blocked because the Data safety form says Press never reads it.
const TEMPLATE_PERMISSIONS_PRESS_DOES_NOT_USE = [
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
];
const ADVERTISING_ID = "com.google.android.gms.permission.AD_ID";

for (const permission of [...TEMPLATE_PERMISSIONS_PRESS_DOES_NOT_USE, ADVERTISING_ID]) {
  test(`Android manifest removes ${permission}`, () => {
    assert.equal(manifestPermissions[permission], "remove");
  });
}

test("Android manifest keeps location, internet and vibrate, and never removes network state", () => {
  for (const permission of [
    "android.permission.ACCESS_FINE_LOCATION",
    "android.permission.ACCESS_COARSE_LOCATION",
    "android.permission.INTERNET",
    "android.permission.VIBRATE",
  ]) {
    assert.equal(manifestPermissions[permission], "declared", permission);
  }
  assert.notEqual(manifestPermissions["android.permission.ACCESS_NETWORK_STATE"], "remove");
});

// SDK 58's native template turns R8 on for Android release builds, and under it
// WorkManager (from react-native-maps) can't create its database: the release
// build crashed on launch (#250). Only the native smoke run catches that, an
// hour later, so this keeps the setting that turns R8 off from going quietly.
test("Android release builds stay unminified", () => {
  const entry = expoConfig("prebuild").plugins.find((p) => [].concat(p)[0] === "expo-build-properties");
  assert.equal(entry?.[1]?.android?.enableMinifyInReleaseBuilds, false);
});
