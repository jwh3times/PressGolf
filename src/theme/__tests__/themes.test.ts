import { PLAYER_COLORS } from '../../domain/factory';
import { FIELD_FORMATS, FORMATS } from '../../domain/formats';
import { AA_BODY, contrastRatio, parseColor, ratio } from '../contrast';
import { AAA_BODY, darkTheme, THEME_ACCENTS, THEME_BASES, themeFor, type Theme } from '../themes';

/**
 * Every theme, held to its floor: 4.5:1 (AA) for the standard bases and 7:1
 * (AAA) for the high-contrast ones. The default theme's own figures are pinned
 * in `contrast.test.ts`; this is what keeps the derived ones honest.
 */

const ALL = THEME_BASES.flatMap((base) =>
  THEME_ACCENTS.map((accent) => [`${base.id}/${accent.id}`, themeFor({ base: base.id, accent: accent.id })] as const),
);
const DERIVED = ALL.filter(([, theme]) => theme.base !== 'dark');

/** Surfaces text is laid on. The dark base keeps the five its own test has always held. */
function surfaces(theme: Theme): string[] {
  const { base, screen, card, cardDeep, cardActive, gradientFrom, gradientTo } = theme.colors;
  const all = [base, screen, card, cardDeep, cardActive];
  return theme.base === 'dark' ? all : [...all, gradientFrom, gradientTo];
}

function worst(color: string, theme: Theme): number {
  return Math.min(...surfaces(theme).map((s) => contrastRatio(color, s)));
}

const DATA_COLOURS = [
  ...new Set([
    ...PLAYER_COLORS,
    ...Object.values(FORMATS).map((f) => f.color),
    ...Object.values(FIELD_FORMATS).map((f) => f.color),
  ]),
];

describe('every theme', () => {
  it('is sixteen: four bases, each with four accents', () => {
    expect(ALL).toHaveLength(16);
    expect(new Set(ALL.map(([, t]) => t)).size).toBe(16);
  });

  it('sets the high-contrast bases at AAA and the others at AA', () => {
    for (const [, theme] of ALL) {
      expect(theme.floor).toBe(theme.base.endsWith('Contrast') ? AAA_BODY : AA_BODY);
    }
  });

  it.each(ALL)('%s: every ink level clears the floor on every surface', (_name, theme) => {
    const below = Object.entries(theme.ink).filter(([, value]) => worst(value, theme) < theme.floor);
    expect(below).toEqual([]);
  });

  it.each(ALL)('%s: the ink levels descend, none landing on another', (_name, theme) => {
    const ratios = Object.values(theme.ink).map((value) => ratio(value, theme.colors.screen));
    expect(ratios).toEqual([...ratios].sort((a, b) => b - a));
    expect(new Set(ratios).size).toBe(ratios.length);
  });

  it.each(ALL)('%s: the accent and the money colours clear the floor on every surface', (_name, theme) => {
    const { accent, up, clay, gold, blue, violet, pink } = theme.colors;
    const below = Object.entries({ accent, up, clay, gold, blue, violet, pink }).filter(
      ([, value]) => worst(value, theme) < theme.floor,
    );
    expect(below).toEqual([]);
  });

  it.each(ALL)("%s: players' and games' colours are made readable", (_name, theme) => {
    const below = DATA_COLOURS.filter((color) => worst(theme.tint(color), theme) < theme.floor);
    expect(below).toEqual([]);
  });

  it.each(ALL)('%s: text on the accent, as on a primary button, clears the floor', (_name, theme) => {
    expect(contrastRatio(theme.colors.screen, theme.colors.accent)).toBeGreaterThanOrEqual(theme.floor);
  });

  it.each(ALL)('%s: money won keeps the green, whatever the accent', (_name, theme) => {
    expect(theme.colors.up).toBe(theme.tint(darkTheme.colors.accent));
    const [r, g, b] = parseColor(theme.colors.up);
    expect(g).toBeGreaterThan(Math.max(r, b));
  });
});

describe('the derived bases', () => {
  it.each(DERIVED)('%s: hairlines and fills stay decoration, below text contrast', (_name, theme) => {
    const { hair, soft, card, strong, bright } = theme.line;
    for (const value of [hair, soft, card, strong, bright, ...Object.values(theme.fill)]) {
      expect(contrastRatio(value, theme.colors.screen)).toBeLessThan(AA_BODY);
    }
  });

  it.each(DERIVED.filter(([, t]) => t.floor === AAA_BODY))(
    '%s: outlines of controls reach 3:1, the non-text minimum',
    (_name, theme) => {
      const { control, dashed, button, avatar } = theme.line;
      for (const value of [control, dashed, button, avatar]) {
        expect(contrastRatio(value, theme.colors.screen)).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it.each(DERIVED)('%s: tints only what needs it, and the same way each time', (_name, theme) => {
    const once = theme.tint('#E8A0C8');
    expect(theme.tint('#E8A0C8')).toBe(once);
    // A colour already readable is left alone.
    expect(theme.tint(theme.ink.full)).toBe(theme.ink.full);
  });

  it('points light bases one way and dark ones the other', () => {
    expect(themeFor({ base: 'light', accent: 'green' }).scheme).toBe('light');
    expect(themeFor({ base: 'lightContrast', accent: 'green' }).scheme).toBe('light');
    expect(themeFor({ base: 'darkContrast', accent: 'green' }).scheme).toBe('dark');
  });
});

describe('the dark base', () => {
  it('with the green accent is the original palette, untouched', () => {
    expect(themeFor({ base: 'dark', accent: 'green' })).toBe(darkTheme);
    expect(darkTheme.tint('#123456')).toBe('#123456');
  });

  it('with another accent changes only what the accent colours', () => {
    const blue = themeFor({ base: 'dark', accent: 'blue' });
    expect(blue.ink).toBe(darkTheme.ink);
    expect(blue.line).toBe(darkTheme.line);
    expect(blue.colors.accent).toBe(darkTheme.colors.blue);
    expect(blue.colors.screen).toBe(darkTheme.colors.screen);
    expect(blue.colors.up).toBe(darkTheme.colors.accent);
  });
});

it('gives the same theme object for the same choice, so style sheets are kept', () => {
  expect(themeFor({ base: 'light', accent: 'gold' })).toBe(themeFor({ base: 'light', accent: 'gold' }));
});
