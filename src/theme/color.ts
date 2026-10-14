/**
 * Arithmetic on the colours the themes are made of. Opaque colours are
 * `#RRGGBB`, which is also what lets a screen append two hex digits of alpha.
 */
import { contrastRatio, parseColor } from './contrast';

function hex(channel: number): string {
  return Math.round(Math.min(255, Math.max(0, channel)))
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
}

/** `amount` of the way from one opaque colour to another. */
export function mix(from: string, to: string, amount: number): string {
  const a = parseColor(from);
  const b = parseColor(to);
  return `#${hex(a[0] + (b[0] - a[0]) * amount)}${hex(a[1] + (b[1] - a[1]) * amount)}${hex(a[2] + (b[2] - a[2]) * amount)}`;
}

/** An opaque colour at the given opacity. */
export function alpha(color: string, opacity: number): string {
  const [r, g, b] = parseColor(color);
  return `rgba(${r},${g},${b},${opacity})`;
}

/**
 * The least opacity, to two places, at which `color` laid over `surface` reads
 * at `target`:1 or better. 1 if it never does.
 */
export function opacityFor(color: string, surface: string, target: number): number {
  for (let step = 1; step <= 100; step++) {
    if (contrastRatio(alpha(color, step / 100), surface) >= target) return step / 100;
  }
  return 1;
}

function toHsl(color: string): [number, number, number] {
  const [r, g, b] = parseColor(color).map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][Math.floor(h / 60) % 6];
  return `#${hex((r + m) * 255)}${hex((g + m) * 255)}${hex((b + m) * 255)}`;
}

/**
 * `color` made darker or lighter, keeping its hue and saturation, only as far
 * as it takes to read at `target`:1 over `surface`. A colour that already does
 * is returned as it is.
 */
export function readable(color: string, surface: string, target: number, direction: 'darker' | 'lighter'): string {
  if (contrastRatio(color, surface) >= target) return color;
  const [h, s, l] = toHsl(color);
  for (let step = 1; step <= 100; step++) {
    const lightness = direction === 'darker' ? l * (1 - step / 100) : l + (1 - l) * (step / 100);
    const candidate = fromHsl(h, s, lightness);
    if (contrastRatio(candidate, surface) >= target) return candidate;
  }
  return direction === 'darker' ? '#000000' : '#FFFFFF';
}
