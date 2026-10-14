/**
 * The app's themes: every colour it draws with.
 *
 * A theme is a base (dark or light, each also at high contrast) and an accent.
 * The dark base with the green accent is the prototype's, verbatim but for one
 * deliberate exception: the ink scale was re-derived to meet WCAG AA, which the
 * prototype's ten levels did not. It is the default because the app is used
 * outdoors in daylight with the brightness up.
 *
 * Only that palette is written out. The others give their surfaces and their
 * ink, and everything else is worked out from the contrast it has to reach, so
 * no theme can be added that reads worse than its floor.
 */
import { alpha, mix, opacityFor, readable } from './color';
import { AA_BODY, contrastRatio } from './contrast';

const colors = {
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

  /**
   * Gradient stops for the live-round, hole and outing cards. Text on them
   * stops at `ink.soft`: `ink.quiet` reads 4.33:1 on the light end.
   */
  gradientFrom: '#1C2C21',
  gradientTo: '#131C16',

  /** Tab bar glass, and the nearly solid fill Android uses in its place. */
  glass: 'rgba(18,25,20,.82)',
  glassSolid: 'rgba(18,25,20,.97)',

  /** Won, in money and on the card. The accent's green, whatever the accent. */
  up: '#8BE0AE',
  /** The Wolf's colour. */
  pink: '#E8A0C8',
};

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
const ink = {
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
};

/** Hairlines and fills, again at the prototype's exact opacities. */
const line = {
  hair: 'rgba(242,239,230,.06)',
  soft: 'rgba(242,239,230,.07)',
  card: 'rgba(242,239,230,.08)',
  strong: 'rgba(242,239,230,.09)',
  bright: 'rgba(242,239,230,.1)',
  control: 'rgba(242,239,230,.12)',
  dashed: 'rgba(242,239,230,.22)',
  button: 'rgba(242,239,230,.18)',
  avatar: 'rgba(242,239,230,.16)',
};

const fill = {
  control: 'rgba(242,239,230,.07)',
  subtle: 'rgba(242,239,230,.06)',
  wash: 'rgba(242,239,230,.03)',
};

export type ThemeBase = 'dark' | 'darkContrast' | 'light' | 'lightContrast';
export type ThemeAccent = 'green' | 'blue' | 'violet' | 'gold';

export interface ThemeChoice {
  base: ThemeBase;
  accent: ThemeAccent;
}

export const DEFAULT_THEME_CHOICE: ThemeChoice = { base: 'dark', accent: 'green' };

export const THEME_BASES: { id: ThemeBase; label: string; hint: string }[] = [
  { id: 'dark', label: 'Dark', hint: 'The original. Made for a bright day with the brightness up.' },
  { id: 'darkContrast', label: 'Dark, high contrast', hint: 'Black, with brighter text and firmer outlines.' },
  { id: 'light', label: 'Light', hint: 'Paper, with dark text.' },
  { id: 'lightContrast', label: 'Light, high contrast', hint: 'White, with black text and firmer outlines.' },
];

export const THEME_ACCENTS: { id: ThemeAccent; label: string; color: string }[] = [
  { id: 'green', label: 'Green', color: colors.accent },
  { id: 'blue', label: 'Blue', color: colors.blue },
  { id: 'violet', label: 'Violet', color: colors.violet },
  { id: 'gold', label: 'Gold', color: colors.gold },
];

export interface Theme {
  base: ThemeBase;
  accent: ThemeAccent;
  /** Which way the system's own furniture should go: status bar, keyboard, alerts. */
  scheme: 'dark' | 'light';
  /** The least contrast any text is allowed against any surface. */
  floor: number;
  colors: Record<keyof typeof colors, string>;
  ink: Record<keyof typeof ink, string>;
  line: Record<keyof typeof line, string>;
  fill: Record<keyof typeof fill, string>;
  /**
   * A colour that comes with the data and not with the theme (a player's, a
   * game's), made readable here. Always `#RRGGBB`.
   */
  tint: (color: string) => string;
}

export const darkTheme: Theme = {
  base: 'dark',
  accent: 'green',
  scheme: 'dark',
  floor: AA_BODY,
  colors,
  ink,
  line,
  fill,
  // The data's colours were chosen for this palette.
  tint: (color) => color,
};

/** WCAG AAA for body text, the floor of the high-contrast bases. */
export const AAA_BODY = 7;

interface BaseSpec {
  scheme: 'dark' | 'light';
  floor: number;
  /** The colour text is, before opacity. */
  ink: string;
  base: string;
  screen: string;
  card: string;
  cardDeep: string;
  /** How much of the accent is mixed into a card that is switched on, and into the live-round gradient. */
  active: number;
  gradient: [number, number];
  /** What the ink levels below `full` read at, over the hardest surface. */
  levels: [strong: number, body: number, muted: number, soft: number, quiet: number];
  /** Outlines of controls reach this; hairlines stay decoration. */
  outline: number;
  /** How much firmer than the dark base's the hairlines and fills are. */
  rule: number;
}

const BASES: Record<Exclude<ThemeBase, 'dark'>, BaseSpec> = {
  darkContrast: {
    scheme: 'dark',
    floor: AAA_BODY,
    ink: '#FFFFFF',
    base: '#000000',
    screen: '#000000',
    card: '#0B0F0C',
    cardDeep: '#060907',
    active: 0.07,
    gradient: [0.1, 0.03],
    levels: [13, 11.3, 9.8, 8.4, 7.3],
    outline: 3,
    rule: 2.5,
  },
  light: {
    scheme: 'light',
    floor: AA_BODY,
    ink: '#111A14',
    base: '#EAE6DA',
    screen: '#F4F1E8',
    card: '#FCFAF5',
    cardDeep: '#F8F5EE',
    active: 0.14,
    gradient: [0.24, 0.08],
    levels: [10.5, 8.6, 6.7, 5.5, 4.7],
    outline: 1.6,
    rule: 1.5,
  },
  lightContrast: {
    scheme: 'light',
    floor: AAA_BODY,
    ink: '#000000',
    base: '#FFFFFF',
    screen: '#FFFFFF',
    card: '#FFFFFF',
    cardDeep: '#F4F4F1',
    active: 0.14,
    gradient: [0.22, 0.08],
    levels: [13, 11.3, 9.8, 8.4, 7.3],
    outline: 3,
    rule: 2.5,
  },
};

const RAW_ACCENT: Record<ThemeAccent, string> = {
  green: colors.accent,
  blue: colors.blue,
  violet: colors.violet,
  gold: colors.gold,
};

/** Of several surfaces, the one text reads worst on. */
function hardest(inkColor: string, surfaces: string[]): string {
  return surfaces.reduce((worst, s) => (contrastRatio(inkColor, s) < contrastRatio(inkColor, worst) ? s : worst));
}

function build(base: ThemeBase, accent: ThemeAccent): Theme {
  const raw = RAW_ACCENT[accent];

  if (base === 'dark') {
    if (accent === 'green') return darkTheme;
    // The same dark palette with the accent's hue where the green's was.
    return {
      ...darkTheme,
      accent,
      colors: {
        ...colors,
        accent: raw,
        accentSoft: alpha(raw, 0.22),
        accentLine: alpha(raw, 0.2),
        cardActive: mix(colors.card, raw, 0.03),
        gradientFrom: mix(colors.card, raw, 0.08),
        gradientTo: mix(colors.card, raw, 0.01),
      },
    };
  }

  const spec = BASES[base];
  const cardActive = mix(spec.card, raw, spec.active);
  const gradientFrom = mix(spec.card, raw, spec.gradient[0]);
  const gradientTo = mix(spec.card, raw, spec.gradient[1]);
  const surfaces = [spec.base, spec.screen, spec.card, spec.cardDeep, cardActive, gradientFrom, gradientTo];
  const worst = hardest(spec.ink, surfaces);

  const direction = spec.scheme === 'dark' ? 'lighter' : 'darker';
  // A little over the floor: tinted text often sits on a wash of its own colour.
  const tinted = new Map<string, string>();
  const tint = (color: string) => {
    let made = tinted.get(color);
    if (!made) {
      made = readable(color, worst, spec.floor * 1.1, direction);
      tinted.set(color, made);
    }
    return made;
  };

  const level = (target: number) => alpha(spec.ink, opacityFor(spec.ink, worst, target));
  const [strong, body, muted, soft, quiet] = spec.levels;

  // A hairline or fill as much firmer than the dark base's as the base asks.
  const rule = (dark: string) => {
    const over = contrastRatio(dark, colors.screen) - 1;
    return alpha(spec.ink, opacityFor(spec.ink, spec.screen, 1 + over * spec.rule));
  };
  const outline = (dark: string) => {
    const ruled = rule(dark);
    return contrastRatio(ruled, spec.screen) >= spec.outline
      ? ruled
      : alpha(spec.ink, opacityFor(spec.ink, spec.screen, spec.outline));
  };

  const accentColor = tint(raw);
  return {
    base,
    accent,
    scheme: spec.scheme,
    floor: spec.floor,
    colors: {
      base: spec.base,
      screen: spec.screen,
      card: spec.card,
      cardDeep: spec.cardDeep,
      cardActive,
      accent: accentColor,
      accentSoft: alpha(accentColor, 0.22),
      accentLine: alpha(accentColor, spec.floor === AAA_BODY ? 0.5 : 0.3),
      ink: spec.ink,
      gold: tint(colors.gold),
      blue: tint(colors.blue),
      clay: tint(colors.clay),
      violet: tint(colors.violet),
      gradientFrom,
      gradientTo,
      glass: alpha(spec.card, 0.86),
      glassSolid: alpha(spec.card, 0.97),
      up: tint(colors.up),
      pink: tint(colors.pink),
    },
    ink: {
      full: spec.ink,
      strong: level(strong),
      body: level(body),
      muted: level(muted),
      soft: level(soft),
      quiet: level(quiet),
    },
    line: {
      hair: rule(line.hair),
      soft: rule(line.soft),
      card: rule(line.card),
      strong: rule(line.strong),
      bright: rule(line.bright),
      control: outline(line.control),
      dashed: outline(line.dashed),
      button: outline(line.button),
      avatar: outline(line.avatar),
    },
    fill: {
      control: rule(fill.control),
      subtle: rule(fill.subtle),
      wash: rule(fill.wash),
    },
    tint,
  };
}

const made = new Map<string, Theme>();

/** The theme for a choice. The same object every time, so style sheets built for it are kept. */
export function themeFor({ base, accent }: ThemeChoice): Theme {
  const key = `${base}/${accent}`;
  let theme = made.get(key);
  if (!theme) {
    theme = build(base, accent);
    made.set(key, theme);
  }
  return theme;
}

/** Money figures: up, down, and level. */
export function moneyColor(theme: Theme, cents: number): string {
  if (cents > 0) return theme.colors.up;
  if (cents < 0) return theme.colors.clay;
  return theme.ink.soft;
}
