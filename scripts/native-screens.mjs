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
// A screen a system notification banner covered (#112) is reported but not
// compared, and is not recorded as a baseline. The app cannot see the banner,
// so it is found by its pixels: see systemBanner().
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
// the ratios consecutive nightlies report for an unchanged app: those reached
// 0.009%, and a change of accent colour moved the least-touched screen 0.027%
// (both as pixelmatch 8 counts them; it counts fewer pixels than 7 did).
const DEFAULT_MAX_DIFF_RATIO = 0.0002;
// pixelmatch's per-pixel colour tolerance (0 to 1).
const PIXEL_THRESHOLD = 0.1;
// A month, short or in full, and nothing that merely starts like one ("Marcus").
const MONTH = "(Jan(uary)?|Feb(ruary)?|Mar(ch)?|Apr(il)?|May|June?|July?|Aug(ust)?|Sep(t(ember)?)?|Oct(ober)?|Nov(ember)?|Dec(ember)?)";
// Labels whose text changes from day to day without the app changing: a date
// ("Sep 21"), or the month the season started in ("since June").
const DATED = new RegExp(`\\b${MONTH} \\d{1,2}\\b`);
const SEASON = new RegExp(`\\bsince ${MONTH}\\b`);
// "since May" is far narrower than "since September", and the mask is cut to
// the text in the new capture only. So a season line is masked this many
// times its own height further on each side, to cover the baseline's too.
const SEASON_PAD = 3;
// A system notification banner (#112): a light-grey slab across the top of the
// screen, in a dark app. The light-mode banner on iOS is about 9% of the screen
// tall; nothing the app draws makes even 0.5% of solid light-grey rows.
const BANNER = { within: 0.3, minHeight: 0.04, rowShare: 0.5, inset: 0.08 };

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
    if (b && (DATED.test(label) || SEASON.test(label))) {
      const pad = SEASON.test(label) ? SEASON_PAD * (b.y2 - b.y1) : 0;
      rects.push({ x1: Math.floor((b.x1 - pad) * scale), y1: Math.floor(b.y1 * scale), x2: Math.ceil((b.x2 + pad) * scale), y2: Math.ceil(b.y2 * scale) });
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
 * Whether a system notification banner covers the top of the screen. The app
 * cannot see it, so the hierarchy does not show it; only the pixels do.
 * Returns the banner's rows in pixels, or null.
 */
export function systemBanner(image) {
  const { width, height, data } = image;
  const x1 = Math.floor(width * BANNER.inset);
  const x2 = Math.ceil(width * (1 - BANNER.inset));
  // A banner floats below the status bar: the slab needs the screen's own
  // colour above and below it, so a band running off either end doesn't count.
  let start = null;
  let best = null;
  for (let y = 0; y < Math.floor(height * BANNER.within); y++) {
    let light = 0;
    for (let x = x1; x < x2; x++) {
      const i = (y * width + x) * 4;
      const lo = Math.min(data[i], data[i + 1], data[i + 2]);
      const hi = Math.max(data[i], data[i + 1], data[i + 2]);
      if (lo >= 140 && hi - lo <= 40) light++;
    }
    if (light / (x2 - x1) >= BANNER.rowShare) {
      start ??= y;
    } else {
      if (start > 0 && (!best || y - start > best.y2 - best.y1)) best = { y1: start, y2: y };
      start = null;
    }
  }
  return best && best.y2 - best.y1 >= height * BANNER.minHeight ? best : null;
}

/**
 * Compares every capture with its baseline. Returns one result per capture,
 * with status match, diff, missing (no baseline yet), size (the screen size
 * changed) or banner (a system banner covered it, so it was not compared), and
 * writes images for each diff under `report`.
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
    if (systemBanner(actual)) {
      if (report) {
        const base = path.join(report, baselineName(c)).replace(/\.png$/, "");
        mkdirSync(path.dirname(base), { recursive: true });
        copyFileSync(c.png, `${base}.actual.png`);
      }
      return { ...where, status: "banner" };
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

/**
 * Copies every capture into the baselines, except one a system banner covered,
 * which would leave the banner in the baseline. Returns the baseline paths
 * written and skipped.
 */
export function recordBaselines({ output, baselines = DEFAULT_BASELINES }) {
  const written = [];
  const skipped = [];
  for (const c of collectCaptures(output)) {
    const name = baselineName(c).split(path.sep).join("/");
    if (systemBanner(PNG.sync.read(readFileSync(c.png)))) {
      skipped.push(name);
      continue;
    }
    const target = path.join(baselines, baselineName(c));
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(c.png, target);
    written.push(name);
  }
  return { written: written.sort(), skipped: skipped.sort() };
}

const pct = (r) => `${(r * 100).toFixed(2)}%`;

/** A Markdown section for the nightly report. */
export function renderMarkdown(results) {
  const count = (s) => results.filter((r) => r.status === s).length;
  const lines = ["## Native screenshots", ""];
  if (results.length === 0) return lines.concat("No checkpoint screenshots were captured.", "").join("\n");
  const banner = count("banner") ? ` · ${count("banner")} under a system banner, not compared` : "";
  lines.push(`${count("match")} match · ${count("diff")} differ · ${count("missing")} without a baseline · ${count("size")} changed size${banner}`, "");
  const notes = {
    diff: (r) => `${pct(r.ratio)} of pixels differ`,
    missing: () => "no baseline",
    size: (r) => `screen size changed (${r.detail})`,
    banner: () => "a system notification banner covered the screen, so it was not compared",
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
    const { written, skipped } = recordBaselines({ output, baselines });
    console.log(`Recorded ${written.length} baselines:\n${written.join("\n")}`);
    for (const name of skipped) {
      console.log(`::warning title=Native baselines::${name} was not recorded: a system notification banner covered it`);
    }
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
