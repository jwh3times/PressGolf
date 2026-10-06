import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { PNG } from "pngjs";
import { compareScreens, collectCaptures, recordBaselines, renderMarkdown } from "./native-screens.mjs";

/** A width×height PNG filled with one colour, with optional rectangles painted over it. */
function png(width, height, colour, rects = []) {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const paint = rects.find((r) => x >= r.x1 && x < r.x2 && y >= r.y1 && y < r.y2)?.colour ?? colour;
      image.data.set([...paint, 255], (y * width + x) * 4);
    }
  }
  return PNG.sync.write(image);
}

const GREEN = [20, 40, 30];
const WHITE = [250, 250, 250];

/** A hierarchy with the given labelled elements, its root spanning width×height points. */
const hierarchy = (width, height, labelled = []) => ({
  attributes: {},
  children: [
    {
      attributes: { bounds: `[0,0][${width},${height}]` },
      children: labelled.map(([label, b]) => ({ attributes: { accessibilityText: label, bounds: b }, children: [] })),
    },
  ],
});

/** Writes one checkpoint capture the way Maestro lays it out, and returns the workspace. */
function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), "native-screens-"));
  const out = path.join(root, "output");
  const baselines = path.join(root, "baselines");
  const capture = ({ platform = "ios", size = "default", flow = "round", attempt = 1, name = "home", image, tree }) => {
    const dir = path.join(out, `maestro-${platform}`, size, flow, `attempt-${attempt}`, "2026-10-03_0300", "Complete a round");
    mkdirSync(path.join(dir, "screenshots"), { recursive: true });
    mkdirSync(path.join(dir, "screen-hierarchy"), { recursive: true });
    const file = `step-008-assertCondition-checkpoint_${name}`;
    writeFileSync(path.join(dir, "screenshots", `${file}.png`), image);
    writeFileSync(path.join(dir, "screen-hierarchy", `${file}.json`), JSON.stringify(tree ?? hierarchy(10, 10)));
  };
  const baseline = (rel, image) => {
    mkdirSync(path.dirname(path.join(baselines, rel)), { recursive: true });
    writeFileSync(path.join(baselines, rel), image);
  };
  return { root, out, baselines, capture, baseline, report: path.join(root, "report"), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("captures are found by checkpoint name, the latest attempt winning", () => {
  const ws = workspace();
  try {
    ws.capture({ attempt: 1, image: png(4, 4, GREEN) });
    ws.capture({ attempt: 2, image: png(4, 4, WHITE) });
    ws.capture({ platform: "android", size: "large-text", flow: "outing", name: "pots", image: png(4, 4, GREEN) });
    const captures = collectCaptures(ws.out);
    assert.deepEqual(
      captures.map((c) => `${c.platform}/${c.size}/${c.flow}/${c.checkpoint}/${c.attempt}`).sort(),
      ["android/large-text/outing/pots/1", "ios/default/round/home/2"],
    );
    assert.ok(captures.every((c) => existsSync(c.hierarchy)));
  } finally {
    ws.cleanup();
  }
});

test("a screen matching its baseline passes, and one that differs writes the expected, actual and diff images", () => {
  const ws = workspace();
  try {
    ws.capture({ name: "home", image: png(10, 10, GREEN) });
    ws.capture({ name: "settle", image: png(10, 10, GREEN, [{ x1: 0, y1: 0, x2: 5, y2: 10, colour: WHITE }]) });
    ws.baseline("ios/default/round--home.png", png(10, 10, GREEN));
    ws.baseline("ios/default/round--settle.png", png(10, 10, GREEN));

    const results = compareScreens({ output: ws.out, baselines: ws.baselines, report: ws.report });
    const by = Object.fromEntries(results.map((r) => [r.checkpoint, r]));
    assert.equal(by.home.status, "match");
    assert.equal(by.settle.status, "diff");
    assert.equal(by.settle.ratio, 0.5);
    for (const kind of ["expected", "actual", "diff"]) {
      assert.ok(existsSync(path.join(ws.report, "ios", "default", `round--settle.${kind}.png`)), kind);
    }
  } finally {
    ws.cleanup();
  }
});

test("a difference within the allowed noise still matches", () => {
  const ws = workspace();
  try {
    ws.capture({ image: png(10, 10, GREEN, [{ x1: 0, y1: 0, x2: 1, y2: 1, colour: WHITE }]) });
    ws.baseline("ios/default/round--home.png", png(10, 10, GREEN));
    const [result] = compareScreens({ output: ws.out, baselines: ws.baselines, report: ws.report, maxDiffRatio: 0.02 });
    assert.equal(result.status, "match");
    assert.equal(result.ratio, 0.01);
  } finally {
    ws.cleanup();
  }
});

test("a date in the demo data is masked out, scaled from points to pixels", () => {
  const ws = workspace();
  try {
    // A 5×5 pt screen captured at 2× is 10×10 px; the date sits in the top-left 2×2 pt.
    const tree = hierarchy(5, 5, [["index 2.1 · Sep 21, 2026 · tap to edit", "[0,0][2,2]"]]);
    ws.capture({ image: png(10, 10, GREEN, [{ x1: 0, y1: 0, x2: 4, y2: 4, colour: WHITE }]), tree });
    ws.baseline("ios/default/round--home.png", png(10, 10, GREEN));
    const [result] = compareScreens({ output: ws.out, baselines: ws.baselines, report: ws.report });
    assert.equal(result.status, "match");
    assert.equal(result.ratio, 0);
  } finally {
    ws.cleanup();
  }
});

test("the season's starting month is masked out, but a player's name that starts like a month is not", () => {
  const ws = workspace();
  try {
    // Home's ledger line names a month with no day: "since May" one day, "since June" the next.
    const season = hierarchy(5, 5, [["18 rounds · since June ›", "[0,0][2,2]"]]);
    ws.capture({ image: png(10, 10, GREEN, [{ x1: 0, y1: 0, x2: 4, y2: 4, colour: WHITE }]), tree: season });
    ws.baseline("ios/default/round--home.png", png(10, 10, GREEN));
    const [masked] = compareScreens({ output: ws.out, baselines: ws.baselines, report: ws.report });
    assert.equal(masked.status, "match");
    assert.equal(masked.ratio, 0);
  } finally {
    ws.cleanup();
  }

  const other = workspace();
  try {
    const name = hierarchy(5, 5, [["Marcus has played 3 since joining", "[0,0][2,2]"]]);
    other.capture({ image: png(10, 10, GREEN, [{ x1: 0, y1: 0, x2: 4, y2: 4, colour: WHITE }]), tree: name });
    other.baseline("ios/default/round--home.png", png(10, 10, GREEN));
    const [seen] = compareScreens({ output: other.out, baselines: other.baselines, report: other.report });
    assert.equal(seen.status, "diff");
  } finally {
    other.cleanup();
  }
});

test("a screen with no baseline, or a different size, is reported rather than compared", () => {
  const ws = workspace();
  try {
    ws.capture({ name: "home", image: png(10, 10, GREEN) });
    ws.capture({ name: "settle", image: png(10, 12, GREEN) });
    ws.baseline("ios/default/round--settle.png", png(10, 10, GREEN));
    const results = compareScreens({ output: ws.out, baselines: ws.baselines, report: ws.report });
    const by = Object.fromEntries(results.map((r) => [r.checkpoint, r.status]));
    assert.deepEqual(by, { home: "missing", settle: "size" });
  } finally {
    ws.cleanup();
  }
});

test("recording copies every capture into the baselines, named by platform, text size, flow and checkpoint", () => {
  const ws = workspace();
  try {
    ws.capture({ platform: "android", size: "large-text", flow: "card-entry", name: "score_card", image: png(3, 3, WHITE) });
    const written = recordBaselines({ output: ws.out, baselines: ws.baselines });
    assert.deepEqual(written, ["android/large-text/card-entry--score_card.png"]);
    assert.deepEqual(readFileSync(path.join(ws.baselines, written[0])), png(3, 3, WHITE));
  } finally {
    ws.cleanup();
  }
});

test("the report counts each outcome and lists every screen that needs a look", () => {
  const md = renderMarkdown([
    { platform: "ios", size: "default", flow: "round", checkpoint: "home", status: "match", ratio: 0 },
    { platform: "ios", size: "default", flow: "round", checkpoint: "settle", status: "diff", ratio: 0.0123 },
    { platform: "android", size: "large-text", flow: "outing", checkpoint: "pots", status: "missing" },
  ]);
  assert.match(md, /1 match · 1 differ · 1 without a baseline/);
  assert.match(md, /ios · default · round\/settle.*1\.23%/);
  assert.match(md, /android · large-text · outing\/pots.*no baseline/);
  assert.doesNotMatch(md, /round\/home/);
});

test("an ignored band of a screen is left out of the comparison, and needs a reason", () => {
  const ws = workspace();
  try {
    // The top 2 of 10 rows differ.
    ws.capture({ image: png(10, 10, GREEN, [{ x1: 0, y1: 0, x2: 10, y2: 2, colour: WHITE }]) });
    ws.baseline("ios/default/round--home.png", png(10, 10, GREEN));
    const ignore = [{ platform: "ios", screen: "round/home", top: 0.2, reason: "the screen behind a sheet shows above it" }];
    const [masked] = compareScreens({ output: ws.out, baselines: ws.baselines, report: ws.report, ignore });
    assert.equal(masked.status, "match");
    assert.equal(masked.ratio, 0);

    const other = [{ platform: "android", screen: "round/home", top: 0.2, reason: "another platform" }];
    assert.equal(compareScreens({ output: ws.out, baselines: ws.baselines, report: ws.report, ignore: other })[0].status, "diff");
    assert.throws(
      () => compareScreens({ output: ws.out, baselines: ws.baselines, ignore: [{ platform: "ios", screen: "round/home", top: 0.2 }] }),
      /reason/,
    );
  } finally {
    ws.cleanup();
  }
});
