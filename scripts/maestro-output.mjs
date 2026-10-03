// Reads what the nightly's Maestro flows leave behind (.github/workflows/native-e2e.yml):
// <root>/maestro-<platform>/<size>/<flow>/attempt-N/<session>/<flow name>/
//   screenshots/step-NNN-…-checkpoint_<name>.png and screen-hierarchy/….json,
// written by .maestro/subflows/checkpoint.yml. Shared by the accessibility
// lint (#67) and the screenshot comparison (#66).
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

const CHECKPOINT = /-checkpoint_([a-z0-9_]+)\.(png|json)$/;

/** "[x1,y1][x2,y2]" → { x1, y1, x2, y2 }, or null when absent or malformed. */
export function parseBounds(bounds) {
  const m = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(bounds ?? "");
  return m ? { x1: +m[1], y1: +m[2], x2: +m[3], y2: +m[4] } : null;
}

export const area = (b) => (b.x2 - b.x1) * (b.y2 - b.y1);

/** The screen's bounds: the largest window in the dump (Android lists the status bar's first). */
export function viewportOf(tree) {
  let viewport = null;
  const walk = (n) => {
    const b = parseBounds(n.attributes?.bounds);
    if (b && (!viewport || area(b) > area(viewport))) viewport = b;
    for (const c of n.children ?? []) walk(c);
  };
  walk(tree);
  return viewport;
}

/**
 * Checkpoint files of one kind ("screenshots" or "screen-hierarchy") under a
 * nightly's output, keeping only each flow's latest attempt.
 */
export function checkpointFiles(root, kind) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (path.basename(dir) === kind && CHECKPOINT.test(entry.name)) files.push(full);
    }
  };
  if (existsSync(root)) walk(root);

  const latest = new Map();
  for (const file of files) {
    const parts = path.relative(root, file).split(path.sep);
    const platform = /^maestro-(ios|android)$/.exec(parts[0])?.[1];
    const attempt = Number(/^attempt-(\d+)$/.exec(parts[3] ?? "")?.[1]);
    if (!platform || !attempt) continue;
    const capture = { platform, size: parts[1], flow: parts[2], checkpoint: CHECKPOINT.exec(file)[1], attempt, file };
    const id = `${platform}|${capture.size}|${capture.flow}|${capture.checkpoint}`;
    if (!latest.has(id) || latest.get(id).attempt < attempt) latest.set(id, capture);
  }
  return [...latest.values()];
}
