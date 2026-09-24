/**
 * Design tokens lifted from the Press prototype.
 *
 * The values are the prototype's, with one deliberate exception: the ink scale
 * was re-derived to meet WCAG AA, which the prototype's ten levels did not.
 * Everything else — the greens, the money colours, the hairlines, the radii —
 * is verbatim, because it carries the whole feel of the thing.
 *
 * The app is dark-only by design: it is used outdoors in daylight with the
 * brightness up, and a light theme would be a different design.
 */

export const colors = {
  /** App background, darkest. */
  base: '#0A0E0B',
  /** Screen background inside the device. */
  screen: '#0C120E',
  /** Standard card. */
  card: '#131A15',
  /** Slightly darker card used by the settlement breakdown. */
  cardDeep: '#111713',
  /** Card when a format is switched on. */
  cardActive: '#16211A',

  /** The green everything important is. */
  accent: '#8BE0AE',
  accentSoft: 'rgba(139,224,174,.22)',
  accentLine: 'rgba(139,224,174,.2)',

  /** Paper-white text. */
  ink: '#F2EFE6',

  /** Money and junk colours. */
  gold: '#E8C46A',
  blue: '#7FB6E8',
  clay: '#E89A7F',
  violet: '#C9A8E8',

  /** Gradient stops for the live-round card. */
  gradientFrom: '#1C2C21',
  gradientTo: '#131C16',

  /** Tab bar glass. */
  glass: 'rgba(18,25,20,.82)',
} as const;

/**
 * Ink, at opacities that all clear WCAG AA for body text. Named by role, not by
 * number.
 *
 * The prototype had ten levels and six of them failed AA — the faintest read at
 * 2.07:1 while carrying the text that explains what is happening to somebody's
 * money. There is no arrangement of ten levels that passes: the alpha needed for
 * 4.5:1 on the lightest card is .493, which is above six of the ten, so they all
 * collapse to one value. Six levels is what this background actually affords.
 *
 * Little was lost in the collapse. The bottom three sat at .32, .28 and .25 —
 * a hierarchy of 0.07 alpha, which nobody has ever perceived. `faint` folded
 * into `soft` for the same reason.
 *
 * Ratios are over `colors.screen`; `theme/contrast.ts` measures them and
 * `__tests__/contrast.test.ts` holds every level to its number.
 */
export const ink = {
  /** 16.48:1 — headings, figures, anything that is the point of the screen. */
  full: '#F2EFE6',
  /** 10.69:1 */
  strong: 'rgba(242,239,230,.8)',
  /** 8.80:1 — running text. */
  body: 'rgba(242,239,230,.72)',
  /** 6.77:1 — secondary text that still has to be read. */
  muted: 'rgba(242,239,230,.62)',
  /** 5.55:1 — eyebrows, meta, supporting detail. */
  soft: 'rgba(242,239,230,.55)',
  /** 4.59:1 on the lightest card — the floor. Nothing may go below this. */
  quiet: 'rgba(242,239,230,.5)',
} as const;

/** Hairlines and fills, again at the prototype's exact opacities. */
export const line = {
  hair: 'rgba(242,239,230,.06)',
  soft: 'rgba(242,239,230,.07)',
  card: 'rgba(242,239,230,.08)',
  strong: 'rgba(242,239,230,.09)',
  bright: 'rgba(242,239,230,.1)',
  control: 'rgba(242,239,230,.12)',
  dashed: 'rgba(242,239,230,.22)',
  button: 'rgba(242,239,230,.18)',
  avatar: 'rgba(242,239,230,.16)',
} as const;

export const fill = {
  control: 'rgba(242,239,230,.07)',
  subtle: 'rgba(242,239,230,.06)',
  wash: 'rgba(242,239,230,.03)',
} as const;

export const fonts = {
  serif: 'InstrumentSerif_400Regular',
  sans: 'InstrumentSans_400Regular',
  sansMedium: 'InstrumentSans_500Medium',
  sansSemi: 'InstrumentSans_600SemiBold',
  sansBold: 'InstrumentSans_700Bold',
  mono: 'JetBrainsMono_400Regular',
  monoMedium: 'JetBrainsMono_500Medium',
  monoBold: 'JetBrainsMono_700Bold',
} as const;

/**
 * Smallest permitted base text size. React Native uses numeric logical units
 * here rather than CSS units such as rem; Text applies the device's font scale
 * to these values by default.
 */
export const MIN_FONT_SIZE = 10;

export const radius = {
  chip: 999,
  sm: 5,
  md: 11,
  card: 14,
  panel: 16,
  format: 18,
  hero: 22,
} as const;

/**
 * The prototype's eyebrow label: 10-unit mono, wide tracking, uppercase.
 * It appears above nearly every section, so it lives here rather than being
 * re-typed a dozen times.
 */
export const eyebrow = {
  fontFamily: fonts.mono,
  fontSize: 10,
  letterSpacing: 2,
  textTransform: 'uppercase' as const,
  color: ink.soft,
};

/** Money figures are always mono — columns of numbers have to line up. */
export function moneyColor(cents: number): string {
  if (cents > 0) return colors.accent;
  if (cents < 0) return colors.clay;
  return ink.soft;
}
