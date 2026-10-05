#!/usr/bin/env node
// Compares the nightly's native screenshots against stored baselines (#66).
//
// Each checkpoint step in the Maestro flows saves a screenshot and the view hierarchy of the same moment. This compares
// each screenshot with .maestro/baselines/<platform>/<size>/<flow>--<checkpoint>.png
// and writes the expected, actual and diff images of any screen that differs.
// Text that changes by itself, such as the demo data's dates (it is seeded
// relative to today), is masked out using the hierarchy's bounds.
//
// A region that legitimately varies can be left out through
// .maestro/baselines/ignore.json: a list of { platform, screen ("flow/checkpoint"),
// top (the share of the screen's height to skip from the top), reason }.
//
// Report-only: a difference never fails the nightly.
//
// Usage:
//   node scripts/native-screens.mjs compare <output-root> [--baselines dir] [--report dir]
//          [--max-diff-ratio r] [--markdown out.md]
//   node scripts/native-screens.mjs record <output-root> [--baselines dir]
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { checkpointFiles, parseBounds, viewportOf } from "./maestro-output.mjs";

const DEFAULT_BASELINES = ".maestro/baselines";
// Share of pixels allowed to differ before a screen is reported. Tune it from
// the ratios consecutive nightlies report for an unchanged app.
const DEFAULT_MAX_DIFF_RATIO = 0.002;
// pixelmatch's per-pixel colour tolerance (0 to 1).
const PIXEL_THRESHOLD = 0.1;
// Labels whose text changes from day to day without the app changing.
const VOLATILE = /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2}\b/;

/** Every checkpoint screenshot, paired with the hierarchy captured with it. */
export function collectCaptures(output) {
  return checkpointFiles(output, "screenshots").map((c) => ({
    ...c,
    png: c.file,
    hierarchy: c.file.replace(`${path.sep}screenshots${path.sep}`, `${path.sep}screen-hierarchy${path.sep}`).replace(/\.png$/, ".json"),
  }));
}

const baselineName = (c) => path.join(c.platform, c.size, `${c.flow}--${c.checkpoint}.png`);

/** Pixel rectangles of volatile text, scaled from the hierarchy's units to the screenshot. */
function masks(hierarchyFile, pngWidth) {
  if (!existsSync(hierarchyFile)) return [];
  const tree = JSON.parse(readFileSync(hierarchyFile, "utf8"));
  const viewport = viewportOf(tree);
  const scale = viewport ? pngWidth / (viewport.x2 - viewport.x1) : 1;
  const rects = [];
  const walk = (n) => {
    const a = n.attributes ?? {};
    const label = a.accessibilityText || a.text || "";
    const b = parseBounds(a.bounds);
    if (b && VOLATILE.test(label)) {
      rects.push({ x1: Math.floor(b.x1 * scale), y1: Math.floor(b.y1 * scale), x2: Math.ceil(b.x2 * scale), y2: Math.ceil(b.y2 * scale) });
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(tree);
  return rects;
}

/** Paints the rectangles a flat grey in place, so they compare equal. */
function paint(image, rects) {
  for (const r of rects) {
    for (let y = Math.max(0, r.y1); y < Math.min(image.height, r.y2); y++) {
      for (let x = Math.max(0, r.x1); x < Math.min(image.width, r.x2); x++) {
        image.data.set([128, 128, 128, 255], (y * image.width + x) * 4);
      }
    }
  }
}

/**
 * Compares every capture with its baseline. Returns one result per capture,
 * with status match, diff, missing (no baseline yet) or size (the screen size
 * changed), and writes images for each diff under `report`.
 */
export function compareScreens({ output, baselines = DEFAULT_BASELINES, report, maxDiffRatio = DEFAULT_MAX_DIFF_RATIO, ignore = [] }) {
  for (const entry of ignore) {
    if (!entry.reason?.trim()) throw new Error(`Ignore entry for ${entry.platform} ${entry.screen} needs a reason`);
  }
  return collectCaptures(output).map((c) => {
    const { png: _png, hierarchy: _hierarchy, file: _file, ...where } = c;
    const expectedFile = path.join(baselines, baselineName(c));
    if (!existsSync(expectedFile)) return { ...where, status: "missing" };

    const actual = PNG.sync.read(readFileSync(c.png));
    const expected = PNG.sync.read(readFileSync(expectedFile));
    if (actual.width !== expected.width || actual.height !== expected.height) {
      return { ...where, status: "size", detail: `${expected.width}×${expected.height} → ${actual.width}×${actual.height}` };
    }

    const rects = masks(c.hierarchy, actual.width);
    for (const entry of ignore) {
      if (entry.platform === c.platform && entry.screen === `${c.flow}/${c.checkpoint}`) {
        rects.push({ x1: 0, y1: 0, x2: actual.width, y2: Math.ceil(actual.height * entry.top) });
      }
    }
    paint(actual, rects);
    paint(expected, rects);
    const diff = new PNG({ width: actual.width, height: actual.height });
    const changed = pixelmatch(expected.data, actual.data, diff.data, actual.width, actual.height, { threshold: PIXEL_THRESHOLD });
    const ratio = changed / (actual.width * actual.height);
    if (ratio <= maxDiffRatio) return { ...where, status: "match", ratio };

    if (report) {
      const base = path.join(report, baselineName(c)).replace(/\.png$/, "");
      mkdirSync(path.dirname(base), { recursive: true });
      copyFileSync(expectedFile, `${base}.expected.png`);
      copyFileSync(c.png, `${base}.actual.png`);
      writeFileSync(`${base}.diff.png`, PNG.sync.write(diff));
    }
    return { ...where, status: "diff", ratio };
  });
}

/** Copies every capture into the baselines; returns the baseline paths written. */
export function recordBaselines({ output, baselines = DEFAULT_BASELINES }) {
  const written = [];
  for (const c of collectCaptures(output)) {
    const target = path.join(baselines, baselineName(c));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(c.png, target);
    written.push(baselineName(c).split(path.sep).join("/"));
  }
  return written.sort();
}

const pct = (r) => `${(r * 100).toFixed(2)}%`;

/** A Markdown section for the nightly report. */
export function renderMarkdown(results) {
  const count = (s) => results.filter((r) => r.status === s).length;
  const lines = ["## Native screenshots", ""];
  if (results.length === 0) return lines.concat("No checkpoint screenshots were captured.", "").join("\n");
  lines.push(`${count("match")} match · ${count("diff")} differ · ${count("missing")} without a baseline · ${count("size")} changed size`, "");
  const notes = {
    diff: (r) => `${pct(r.ratio)} of pixels differ`,
    missing: () => "no baseline",
    size: (r) => `screen size changed (${r.detail})`,
  };
  const attention = results.filter((r) => r.status !== "match");
  for (const r of attention.sort((a, b) => `${a.platform}${a.size}${a.flow}${a.checkpoint}`.localeCompare(`${b.platform}${b.size}${b.flow}${b.checkpoint}`))) {
    lines.push(`- ${r.platform} · ${r.size} · ${r.flow}/${r.checkpoint}: ${notes[r.status](r)}`);
  }
  const matched = results.filter((r) => r.status === "match" && r.ratio > 0);
  if (matched.length) {
    lines.push("", `Largest difference among matches: ${pct(Math.max(...matched.map((r) => r.ratio)))} (noise allowance ${pct(DEFAULT_MAX_DIFF_RATIO)} unless overridden).`);
  }
  return lines.join("\n").trimEnd() + "\n";
}

function main([command, output, ...rest]) {
  const opt = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const baselines = opt("--baselines") ?? DEFAULT_BASELINES;
  if (command === "record" && output) {
    const written = recordBaselines({ output, baselines });
    console.log(`Recorded ${written.length} baselines:\n${written.join("\n")}`);
    return 0;
  }
  if (command === "compare" && output) {
    const ignoreFile = path.join(baselines, "ignore.json");
    const results = compareScreens({
      output,
      baselines,
      ignore: existsSync(ignoreFile) ? JSON.parse(readFileSync(ignoreFile, "utf8")) : [],
      report: opt("--report"),
      maxDiffRatio: Number(opt("--max-diff-ratio")) || DEFAULT_MAX_DIFF_RATIO,
    });
    const markdown = renderMarkdown(results);
    if (opt("--markdown")) writeFileSync(opt("--markdown"), markdown);
    process.stdout.write(markdown);
    return 0;
  }
  console.error("Usage: node scripts/native-screens.mjs compare|record <output-root> [options]");
  return 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
