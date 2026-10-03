#!/usr/bin/env node
// Lints the native accessibility tree the nightly Maestro flows capture (#67).
//
// Each flow passes through checkpoints (.maestro/subflows/checkpoint.yml) that
// make Maestro save the screen's view hierarchy. This reads those dumps and
// reports, for each platform, text size and screen:
//
//   unlabelled    a tappable control with no accessible text (Android only:
//                 Maestro's iOS hierarchy carries no roles or traits);
//   small-target  a tap target under 44×44 pt on iOS or 48×48 dp on Android;
//   ambiguous     two or more tappable controls sharing one accessible name.
//
// iOS dumps say nothing about what is tappable, so a label counts as a control
// there when Android marks the same label clickable at the same checkpoint and
// text size; the flows are identical on both platforms, so the screens match.
// A label iOS shows more often than Android has it clickable (a player's
// initials as both row text and a chip) can't be pinned to the control, so it
// is skipped there. Ambiguity is reported from Android, which shares the labels.
//
// Report-only: the nightly never fails on a finding. Accepted exceptions live
// in .maestro/a11y-allowlist.json, each with a reason.
//
// Usage: node scripts/a11y-lint.mjs <maestro-output-root> [--allowlist file]
//          [--android-density n] [--markdown out.md] [--json out.json]
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { checkpointFiles, parseBounds, viewportOf } from "./maestro-output.mjs";

const MIN_POINTS = { ios: 44, android: 48 };
// A Pixel 6 emulator, the nightly's Android profile, renders 2.625 px per dp.
const DEFAULT_ANDROID_DENSITY = 2.625;

const ownLabel = (a) => (a.accessibilityText || a.text || a.hintText || "").trim();

/** Every text below a node, the way TalkBack reads an unlabelled container. */
function descendantText(n) {
  return (n.children ?? []).map((c) => ownLabel(c.attributes ?? {}) || descendantText(c)).filter(Boolean).join(" ");
}

const isSystemUi = (a) => /^com\.android\.systemui:/.test(a["resource-id"] ?? "");

/** The labelled elements of a screen, with Android's clickable flag. System UI is left out. */
function elements(tree) {
  const out = [];
  const walk = (n) => {
    const a = n.attributes ?? {};
    if (isSystemUi(a)) return;
    const bounds = parseBounds(a.bounds);
    if (bounds) {
      out.push({
        label: ownLabel(a) || (a.clickable === "true" ? descendantText(n) : ""),
        clickable: a.clickable === "true",
        bounds,
      });
    }
    for (const c of n.children ?? []) walk(c);
  };
  walk(tree);
  return { elements: out, viewport: viewportOf(tree) };
}

/** Cut off by the edge of the screen, so its size there says nothing. */
function clipped(b, viewport) {
  if (!viewport) return false;
  return b.x1 <= viewport.x1 || b.y1 <= viewport.y1 || b.x2 >= viewport.x2 || b.y2 >= viewport.y2;
}

const key = (s) => `${s.size}|${s.flow}|${s.checkpoint}`;

/**
 * Lints every captured screen. `screens` are { platform, size, flow,
 * checkpoint, tree }; the result is a flat list of findings.
 */
export function lintScreens(screens, { androidDensity = DEFAULT_ANDROID_DENSITY } = {}) {
  // How many controls Android has by each label, per checkpoint, lent to the
  // matching iOS screen.
  const androidTappable = new Map();
  for (const s of screens.filter((s) => s.platform === "android")) {
    const counts = new Map();
    for (const e of elements(s.tree).elements.filter((e) => e.clickable && e.label)) {
      counts.set(e.label, (counts.get(e.label) ?? 0) + 1);
    }
    androidTappable.set(key(s), counts);
  }

  const findings = [];
  for (const s of screens) {
    const { elements: all, viewport } = elements(s.tree);
    const report = (rule, label, detail) =>
      findings.push({ platform: s.platform, size: s.size, flow: s.flow, checkpoint: s.checkpoint, rule, label, detail });

    let controls;
    if (s.platform === "android") {
      controls = all.filter((e) => e.clickable);
      for (const e of controls.filter((e) => !e.label)) {
        report("unlabelled", "", `a tappable control at ${fmtBounds(e.bounds)} has no accessible text`);
      }
    } else {
      const tappable = androidTappable.get(key(s)) ?? new Map();
      // iOS repeats a label on a node and its child with the same bounds.
      const seen = new Set();
      const labelled = all.filter((e) => {
        const id = `${e.label}|${fmtBounds(e.bounds)}`;
        if (!tappable.has(e.label) || seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      const shown = new Map();
      for (const e of labelled) shown.set(e.label, (shown.get(e.label) ?? 0) + 1);
      controls = labelled.filter((e) => shown.get(e.label) <= tappable.get(e.label));
    }

    const unit = s.platform === "android" ? "dp" : "pt";
    const scale = s.platform === "android" ? androidDensity : 1;
    for (const e of controls) {
      if (!e.label || clipped(e.bounds, viewport)) continue;
      const w = Math.round((e.bounds.x2 - e.bounds.x1) / scale);
      const h = Math.round((e.bounds.y2 - e.bounds.y1) / scale);
      const min = MIN_POINTS[s.platform];
      if (w < min || h < min) report("small-target", e.label, `${w}×${h} ${unit}, under ${min}×${min} ${unit}`);
    }

    if (s.platform !== "android") continue;
    const byName = new Map();
    for (const e of controls.filter((e) => e.label)) byName.set(e.label, (byName.get(e.label) ?? 0) + 1);
    for (const [label, count] of byName) {
      if (count > 1) report("ambiguous", label, `${count} controls share this name`);
    }
  }
  return findings;
}

const fmtBounds = (b) => `[${b.x1},${b.y1}][${b.x2},${b.y2}]`;

/**
 * Splits findings into those still reported and those an allowlist entry
 * accepts. An entry matches on rule, a label regex, and optionally platform
 * and a "flow/checkpoint" regex; every entry must say why it is accepted.
 */
export function applyAllowlist(findings, allowlist) {
  for (const entry of allowlist) {
    if (!entry.reason?.trim()) throw new Error(`Allowlist entry for ${entry.rule} "${entry.label}" needs a reason`);
  }
  const matches = (f, e) =>
    e.rule === f.rule &&
    new RegExp(e.label).test(f.label) &&
    (!e.platform || e.platform === f.platform) &&
    (!e.screen || new RegExp(e.screen).test(`${f.flow}/${f.checkpoint}`));
  const kept = [];
  const allowed = [];
  for (const f of findings) (allowlist.some((e) => matches(f, e)) ? allowed : kept).push(f);
  return { kept, allowed };
}

/** A Markdown section for the nightly report. */
export function renderMarkdown({ kept, allowed, screens }) {
  const lines = ["## Native accessibility tree", ""];
  if (kept.length === 0) {
    lines.push(`No findings across ${screens} screens.`);
  } else {
    lines.push(`${kept.length} findings across ${screens} screens.`, "");
    const groups = new Map();
    for (const f of kept) {
      const heading = `${f.platform} · ${f.size} · ${f.flow}/${f.checkpoint}`;
      if (!groups.has(heading)) groups.set(heading, []);
      groups.get(heading).push(f);
    }
    for (const [heading, list] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`### ${heading}`, "");
      for (const f of list) lines.push(`- **${f.rule}** ${f.label ? `"${f.label}"` : "(no name)"}: ${f.detail}`);
      lines.push("");
    }
  }
  if (allowed.length) lines.push("", `${allowed.length} more accepted by \`.maestro/a11y-allowlist.json\`.`);
  return lines.join("\n").trimEnd() + "\n";
}

/** Every checkpoint's hierarchy under a nightly's output, latest attempt only. */
export function collectScreens(root) {
  return checkpointFiles(root, "screen-hierarchy").map((s) => ({ ...s, tree: JSON.parse(readFileSync(s.file, "utf8")) }));
}

function main(argv) {
  const [root, ...rest] = argv;
  if (!root) {
    console.error("Usage: node scripts/a11y-lint.mjs <maestro-output-root> [--allowlist file] [--android-density n] [--markdown out.md] [--json out.json]");
    return 2;
  }
  const opt = (name) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const allowlistFile = opt("--allowlist") ?? ".maestro/a11y-allowlist.json";
  const allowlist = existsSync(allowlistFile) ? JSON.parse(readFileSync(allowlistFile, "utf8")) : [];
  const density = Number(opt("--android-density")) || DEFAULT_ANDROID_DENSITY;

  const screens = collectScreens(root);
  const result = applyAllowlist(lintScreens(screens, { androidDensity: density }), allowlist);
  const markdown = renderMarkdown({ ...result, screens: screens.length });
  if (opt("--markdown")) writeFileSync(opt("--markdown"), markdown);
  if (opt("--json")) writeFileSync(opt("--json"), JSON.stringify(result, null, 2));
  process.stdout.write(markdown);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
