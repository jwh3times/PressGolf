/**
 * Design tokens lifted from the Press prototype.
 *
 * The values are the prototype's, verbatim — the rgba() ink levels in
 * particular carry the whole feel of the thing, so they are named rather than
 * re-derived. The app is dark-only by design: it is used outdoors in daylight
 * with the brightness up, and a light theme would be a different design.
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

/** Ink at the opacities the prototype uses. Named by role, not by number. */
export const ink = {
  full: '#F2EFE6',
  strong: 'rgba(242,239,230,.8)',
  body: 'rgba(242,239,230,.72)',
  muted: 'rgba(242,239,230,.5)',
  soft: 'rgba(242,239,230,.45)',
  faint: 'rgba(242,239,230,.4)',
  dim: 'rgba(242,239,230,.38)',
  ghost: 'rgba(242,239,230,.32)',
  trace: 'rgba(242,239,230,.28)',
  whisper: 'rgba(242,239,230,.25)',
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
 * The prototype's eyebrow label: 10px mono, wide tracking, uppercase.
 * It appears above nearly every section, so it lives here rather than being
 * re-typed a dozen times.
 */
export const eyebrow = {
  fontFamily: fonts.mono,
  fontSize: 10,
  letterSpacing: 2,
  textTransform: 'uppercase' as const,
  color: ink.faint,
};

/** Money figures are always mono — columns of numbers have to line up. */
export function moneyColor(cents: number): string {
  if (cents > 0) return colors.accent;
  if (cents < 0) return colors.clay;
  return ink.soft;
}
