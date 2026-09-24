import fs from 'fs';
import path from 'path';
import { MIN_FONT_SIZE } from '../tokens';

const SRC = path.join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name === '__tests__') return [];
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

interface StaticSize {
  index: number;
  size: number;
}

/** Finds the literal forms used for text sizing without executing source code. */
function staticTextSizes(source: string): StaticSize[] {
  const sizes: StaticSize[] = [];

  for (const match of source.matchAll(/fontSize\s*:\s*(-?\d+(?:\.\d+)?)\b/g)) {
    sizes.push({ index: match.index, size: Number(match[1]) });
  }

  // Also inspect literal outcomes of expressions such as the Avatar's
  // `size < 28 ? 10 : 10.5`; the condition's number is not a font size.
  for (const match of source.matchAll(
    /fontSize\s*:\s*[^,\n}]*\?\s*(-?\d+(?:\.\d+)?)\s*:\s*(-?\d+(?:\.\d+)?)/g,
  )) {
    sizes.push({ index: match.index, size: Number(match[1]) });
    sizes.push({ index: match.index, size: Number(match[2]) });
  }

  // These primitives expose their font size as `size`, so a static call site
  // is part of the same floor even though the underlying fontSize is internal.
  for (const match of source.matchAll(
    /<(?:Display|Money|Mono)\b[^>]*\bsize=(?:\{\s*)?["']?(-?\d+(?:\.\d+)?)/g,
  )) {
    sizes.push({ index: match.index, size: Number(match[1]) });
  }

  return sizes;
}

function lineAt(source: string, index: number): number {
  return source.slice(0, index).split('\n').length;
}

const files = sourceFiles(SRC);

describe('the type-size floor', () => {
  it('recognises every static form the app uses', () => {
    const sample = `
      const direct = { fontSize: 8.5 };
      const conditional = { fontSize: compact ? 9 : 10.5 };
      const mono = <Mono size={7} />;
    `;
    expect(staticTextSizes(sample).map(({ size }) => size)).toEqual([8.5, 9, 10.5, 7]);
  });

  it(`keeps statically declared text at ${MIN_FONT_SIZE} or larger`, () => {
    const offenders = files.flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return staticTextSizes(source)
        .filter(({ size }) => size < MIN_FONT_SIZE)
        .map(({ index, size }) => ({
          file: path.relative(SRC, file),
          line: lineAt(source, index),
          size,
        }));
    });

    expect(files.length).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });
});
