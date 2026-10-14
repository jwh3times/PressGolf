/**
 * Design tokens lifted from the Press prototype.
 *
 * The values are the prototype's, with one deliberate exception: the ink scale
 * was re-derived to meet WCAG AA, which the prototype's ten levels did not.
 * Everything else — the greens, the money colours, the hairlines, the radii —
 * is verbatim, because it carries the whole feel of the thing.
 *
 * Colours are not here: they belong to a theme (`themes.ts`) and are read with
 * `useTheme()` or `makeStyles()` from `theme.tsx`, never from a module.
 */

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

/**
 * The smallest side of anything tapped: Android asks for 48 dp and iOS for
 * 44 pt, so 48 satisfies both.
 */
export const MIN_TAP_TARGET = 48;

export const radius = {
  chip: 999,
  sm: 5,
  md: 11,
  card: 14,
  panel: 16,
  format: 18,
  hero: 22,
} as const;
