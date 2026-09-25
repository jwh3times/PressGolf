#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const base = process.argv[2];
const target = Number(process.argv[3] ?? 90);

if (!base || !Number.isFinite(target) || target < 0 || target > 100) {
  console.error('Usage: node scripts/check-patch-coverage.mjs <base-ref> [target-percent]');
  process.exit(2);
}

const lcovPath = resolve('coverage/lcov.info');
if (!existsSync(lcovPath)) {
  console.error('coverage/lcov.info is missing. Run the coverage suite first.');
  process.exit(2);
}

const normalize = (path) => path.split('\\').join('/').replace(/^\.\//, '');

function repositoryPath(path) {
  const normalized = normalize(path);
  if (!resolve(path).startsWith(resolve('.'))) return normalized;
  return normalize(relative('.', resolve(path)).split(sep).join('/'));
}

function changedLines(diff) {
  const changed = new Map();
  let file = null;

  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      const path = line.slice(4).trim();
      file = path === '/dev/null' ? null : normalize(path.replace(/^b\//, ''));
      continue;
    }

    if (!file || !line.startsWith('@@ ')) continue;
    const match = line.match(/\+(\d+)(?:,(\d+))?/);
    if (!match) continue;

    const start = Number(match[1]);
    const count = match[2] == null ? 1 : Number(match[2]);
    const lines = changed.get(file) ?? new Set();
    for (let offset = 0; offset < count; offset += 1) lines.add(start + offset);
    changed.set(file, lines);
  }

  return changed;
}

function coveragePoints(lcov) {
  const coverage = new Map();
  let file = null;

  for (const line of lcov.split('\n')) {
    if (line.startsWith('SF:')) {
      file = repositoryPath(line.slice(3).trim());
      if (!coverage.has(file)) coverage.set(file, new Map());
      continue;
    }

    if (!file) continue;
    if (line.startsWith('DA:')) {
      const [lineNumber, hits] = line.slice(3).split(',').map(Number);
      const points = coverage.get(file).get(lineNumber) ?? [];
      points.push({ kind: 'line', hits });
      coverage.get(file).set(lineNumber, points);
    } else if (line.startsWith('BRDA:')) {
      const [lineNumber, block, branch, taken] = line.slice(5).split(',');
      const points = coverage.get(file).get(Number(lineNumber)) ?? [];
      points.push({
        kind: `branch ${block}:${branch}`,
        hits: taken === '-' ? 0 : Number(taken),
      });
      coverage.get(file).set(Number(lineNumber), points);
    }
  }

  return coverage;
}

let diff;
try {
  diff = execFileSync(
    'git',
    ['diff', '--unified=0', '--diff-filter=ACMR', `${base}...HEAD`, '--', 'src'],
    { encoding: 'utf8' },
  );
} catch (error) {
  console.error(`Could not compare this branch with ${base}.`);
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}

const changed = changedLines(diff);
const coverage = coveragePoints(readFileSync(lcovPath, 'utf8'));
const coverable = [];

for (const [file, lines] of changed) {
  const fileCoverage = coverage.get(file);
  if (!fileCoverage) continue;
  for (const line of lines) {
    for (const point of fileCoverage.get(line) ?? []) coverable.push({ file, line, ...point });
  }
}

if (coverable.length === 0) {
  console.log('Patch coverage: no new executable source lines.');
  process.exit(0);
}

const covered = coverable.filter(({ hits }) => hits > 0);
const percent = (covered.length / coverable.length) * 100;
console.log(`Patch coverage: ${covered.length}/${coverable.length} points (${percent.toFixed(2)}%; required ${target}%).`);

if (percent + Number.EPSILON < target) {
  const missed = coverable.filter(({ hits }) => hits === 0);
  console.error('New executable lines without coverage:');
  for (const { file, line, kind } of missed.slice(0, 50)) console.error(`  ${file}:${line} (${kind})`);
  if (missed.length > 50) console.error(`  …and ${missed.length - 50} more`);
  process.exit(1);
}
