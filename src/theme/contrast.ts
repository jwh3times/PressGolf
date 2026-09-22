/**
 * Contrast measurement for the design tokens.
 *
 * The ink levels in `tokens.ts` are one paper white at a dozen opacities over a
 * near-black screen, so what any of them actually reads at is invisible from
 * the file: `.32` is a contrast ratio of 2.65:1, and nothing says so. This
 * works it out, so the accompanying test can hold the palette to a number
 * rather than to an opinion.
 *
 * WCAG 2.1 contrast, which is a ratio between relative luminances. A
 * translucent colour is composited over its backdrop before being measured —
 * text is never drawn on nothing, and here the alpha is the entire subject.
 */

/** WCAG 2.1 AA for body text. */
export const AA_BODY = 4.5;

/**
 * WCAG 2.1 AA for large text. Large means 24px regular or 18.66px bold — a bar
 * nothing in this app clears, since the smallest ink levels are used at 10-11px.
 */
export const AA_LARGE = 3;

export type Rgb = readonly [number, number, number];
export type Rgba = readonly [number, number, number, number];

const HEX = /^#([0-9a-f]{6})$/i;
const FUNCTIONAL = /^rgba?\(([^)]+)\)$/i;

/**
 * Parses the two notations `tokens.ts` uses — `#RRGGBB` and `rgba(r,g,b,a)` —
 * and refuses anything else rather than guessing at it.
 */
export function parseColor(value: string): Rgba {
  const hex = HEX.exec(value.trim());
  if (hex) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff, 1];
  }

  const fn = FUNCTIONAL.exec(value.trim());
  if (fn) {
    const parts = fn[1].split(',').map((p) => Number(p.trim()));
    if (parts.length < 3 || parts.length > 4 || parts.some(Number.isNaN)) {
      throw new Error(`Cannot parse colour: ${value}`);
    }
    const [r, g, b, a = 1] = parts;
    return [r, g, b, a];
  }

  throw new Error(`Cannot parse colour: ${value}`);
}

/** Lays a possibly-translucent colour over an opaque backdrop. */
export function composite(foreground: Rgba, backdrop: Rgb): Rgb {
  const a = foreground[3];
  return [
    foreground[0] * a + backdrop[0] * (1 - a),
    foreground[1] * a + backdrop[1] * (1 - a),
    foreground[2] * a + backdrop[2] * (1 - a),
  ];
}

/** WCAG relative luminance: sRGB linearised, then weighted for the eye. */
export function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * The contrast ratio between a foreground and an opaque background, from 1:1
 * (identical) to 21:1 (black on white). The foreground may be translucent and
 * is composited first; the background may not, because there would be nothing
 * to composite it over.
 */
export function contrastRatio(foreground: string, background: string): number {
  const backdrop = parseColor(background);
  if (backdrop[3] !== 1) {
    throw new Error(`Background must be opaque, got: ${background}`);
  }

  const opaqueBackdrop: Rgb = [backdrop[0], backdrop[1], backdrop[2]];
  const front = composite(parseColor(foreground), opaqueBackdrop);

  const a = relativeLuminance(front);
  const b = relativeLuminance(opaqueBackdrop);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Rounded to two places, which is how the ratios are quoted and compared. */
export function ratio(foreground: string, background: string): number {
  return Math.round(contrastRatio(foreground, background) * 100) / 100;
}
