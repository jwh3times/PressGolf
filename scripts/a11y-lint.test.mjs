import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { applyAllowlist, collectScreens, lintScreens, renderMarkdown } from "./a11y-lint.mjs";

// Nodes shaped like Maestro's hierarchy dumps: attributes are strings, and
// Android marks tappable nodes with clickable, while iOS reports no role.
const node = (attributes, children = []) => ({ attributes, children });
const android = (bounds, attrs = {}, children = []) =>
  node({ bounds, clickable: "false", class: "android.view.ViewGroup", ...attrs }, children);
const tap = (bounds, attrs = {}, children = []) => android(bounds, { ...attrs, clickable: "true" }, children);
const ios = (bounds, label, children = []) => node({ bounds, accessibilityText: label, enabled: "true" }, children);

// A Pixel 6 is 1080×2400 px at density 2.625, so 48 dp is 126 px. As in a
// real dump, the status bar's window comes first, in a frame with no id.
const androidScreen = (...children) =>
  node({}, [
    android("[0,0][1080,128]", {}, [
      android("[0,0][1080,128]", { "resource-id": "com.android.systemui:id/status_bar" }, [
        tap("[10,10][40,40]", { "resource-id": "com.android.systemui:id/clock" }),
      ]),
    ]),
    android("[0,0][1080,2400]", {}, children),
  ]);
const iosScreen = (...children) => node({}, [ios("[0,0][402,874]", "Press", children)]);

function screen(platform, tree, extra = {}) {
  return { platform, size: "default", flow: "round", checkpoint: "home", tree, ...extra };
}

const rules = (findings) => findings.map((f) => `${f.rule}:${f.label}`).sort();

test("an Android tappable with no text of its own or below it is unlabelled", () => {
  const findings = lintScreens([
    screen("android", androidScreen(tap("[100,300][400,500]"), tap("[100,600][400,800]", {}, [android("[110,610][390,790]", { text: "Save card" })]))),
  ]);
  assert.deepEqual(rules(findings), ["unlabelled:"]);
});

test("Android sizes are measured in dp, and a target under 48 dp is small", () => {
  const findings = lintScreens(
    [screen("android", androidScreen(tap("[100,300][220,420]", { accessibilityText: "Lower" }), tap("[300,300][426,426]", { accessibilityText: "Raise" })))],
    { androidDensity: 2.625 },
  );
  assert.deepEqual(rules(findings), ["small-target:Lower"]);
  assert.match(findings[0].detail, /46×46 dp/);
});

test("system UI outside the app is never linted", () => {
  assert.deepEqual(lintScreens([screen("android", androidScreen())]), []);
});

test("a target cut off by the screen edge is not called small", () => {
  const findings = lintScreens([screen("android", androidScreen(tap("[1040,300][1080,420]", { accessibilityText: "Hole 9" })))]);
  assert.deepEqual(findings, []);
});

test("two tappables sharing a name on one screen are ambiguous, once, reported from Android", () => {
  const findings = lintScreens([
    screen(
      "android",
      androidScreen(
        tap("[100,300][300,500]", { accessibilityText: "increase" }),
        tap("[100,600][300,800]", { accessibilityText: "increase" }),
        tap("[100,900][300,1100]", { accessibilityText: "increase" }),
      ),
    ),
  ]);
  assert.deepEqual(rules(findings), ["ambiguous:increase"]);
  assert.match(findings[0].detail, /3 controls/);
});

test("iOS treats an element as tappable when Android's matching checkpoint does, and measures in points", () => {
  const findings = lintScreens([
    screen("android", androidScreen(tap("[100,300][300,500]", { accessibilityText: "Lower the allowance" }))),
    screen(
      "ios",
      iosScreen(
        ios("[260,337][290,367]", "Lower the allowance"),
        // Static text: Android has nothing tappable by this name.
        ios("[20,20][40,30]", "GROUP NAME"),
      ),
    ),
  ]);
  assert.deepEqual(
    findings.map((f) => `${f.platform}:${f.rule}:${f.label}`),
    ["ios:small-target:Lower the allowance"],
  );
  assert.match(findings[0].detail, /30×30 pt/);
});

test("iOS repeats a label on a node and its child with the same bounds; that is one control, not two", () => {
  const findings = lintScreens([
    screen("android", androidScreen(tap("[100,300][300,500]", { accessibilityText: "Done" }))),
    screen("ios", iosScreen(ios("[300,40][380,90]", "Done", [ios("[300,40][380,90]", "Done")]))),
  ]);
  assert.deepEqual(findings, []);
});

test("an iOS label that is also plain text elsewhere on the screen can't be pinned to a control, so it is skipped", () => {
  const findings = lintScreens([
    screen("android", androidScreen(tap("[100,300][190,363]", { accessibilityText: "DP" }), android("[50,100][150,140]", { text: "DP" }))),
    screen("ios", iosScreen(ios("[20,10][60,25]", "DP"), ios("[100,300][134,323]", "DP"))),
  ]);
  assert.deepEqual(
    findings.map((f) => `${f.platform}:${f.rule}:${f.label}`),
    ["android:small-target:DP"],
  );
});

test("the allowlist drops matching findings and needs a reason for each entry", () => {
  const findings = [
    { platform: "android", size: "default", flow: "round", checkpoint: "home", rule: "small-target", label: "Lower", detail: "" },
    { platform: "ios", size: "large-text", flow: "round", checkpoint: "home", rule: "small-target", label: "Raise", detail: "" },
  ];
  const { kept, allowed } = applyAllowlist(findings, [{ rule: "small-target", label: "^Lower$", reason: "hitSlop widens it" }]);
  assert.deepEqual(rules(kept), ["small-target:Raise"]);
  assert.equal(allowed.length, 1);
  assert.throws(() => applyAllowlist(findings, [{ rule: "small-target", label: "Lower" }]), /reason/);
});

test("the report groups findings by control, numbers collapsed, with the usual size on each platform", () => {
  const at = (platform, size, label, width, height) => ({
    platform, size, flow: "card-entry", checkpoint: "score_card", rule: "small-target", label,
    width, height, detail: `${width}×${height} ${platform === "ios" ? "pt" : "dp"}`,
  });
  const findings = [
    at("ios", "default", "Hole 1, Marcus, empty", 34, 34),
    at("ios", "default", "Hole 2, Marcus, empty", 34, 34),
    at("android", "default", "Hole 1, Marcus, empty", 34, 34),
    at("android", "large-text", "Hole 1, Marcus, empty", 23, 34),
    { platform: "android", size: "default", flow: "handicaps", checkpoint: "format", rule: "ambiguous", label: "increase", count: 3, detail: "3 controls share this name" },
  ];
  const md = renderMarkdown({ kept: findings, allowed: [], screens: 4 });
  assert.match(md, /5 findings across 4 screens, 2 distinct/);
  assert.match(md, /### small-target/);
  assert.ok(md.includes('- "Hole #, Marcus, empty" ×4 · card-entry/score_card · android 23×34 dp, ios 34×34 pt'), md);
  assert.match(md, /### ambiguous/);
  assert.ok(md.includes('- "increase" ×1 · handicaps/format · up to 3 controls share this name'), md);
  assert.match(renderMarkdown({ kept: [], allowed: [], screens: 4 }), /No findings across 4 screens/);
});

test("a long report is cut to fit an issue body, and says so", () => {
  const findings = Array.from({ length: 3000 }, (_, i) => ({
    platform: "android", size: "default", flow: "round", checkpoint: "home", rule: "ambiguous",
    label: `control ${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + ((i / 26) % 26 | 0))}${String.fromCharCode(97 + ((i / 676) % 26 | 0))} with a long accessible name`, count: 2, detail: "2 controls share this name",
  }));
  const md = renderMarkdown({ kept: findings, allowed: [], screens: 1 });
  assert.ok(md.length < 30000);
  assert.match(md, /more in the run's a11y.json/);
});

test("checkpoint dumps are found in Maestro's output tree, the latest attempt winning", () => {
  const root = mkdtempSync(path.join(tmpdir(), "a11y-lint-"));
  try {
    const dump = (rel, tree) => {
      const file = path.join(root, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(tree));
    };
    const tree = androidScreen();
    dump("maestro-android/default/round/attempt-1/2026-10-03_0101/Complete a round/screen-hierarchy/step-007-assertCondition-checkpoint_home.json", tree);
    dump("maestro-android/default/round/attempt-2/2026-10-03_0105/Complete a round/screen-hierarchy/step-007-assertCondition-checkpoint_home.json", tree);
    // A failing step's dump is not a checkpoint.
    dump("maestro-android/default/round/attempt-2/2026-10-03_0105/Complete a round/screen-hierarchy/step-012-tapOnElement-Done.json", tree);
    dump("maestro-ios/large-text/outing/attempt-1/2026-10-03_0201/Check pots/screen-hierarchy/step-009-assertCondition-checkpoint_pots.json", tree);

    const screens = collectScreens(root);
    assert.deepEqual(
      screens.map((s) => `${s.platform}/${s.size}/${s.flow}/${s.checkpoint}/${s.attempt}`).sort(),
      ["android/default/round/home/2", "ios/large-text/outing/pots/1"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
