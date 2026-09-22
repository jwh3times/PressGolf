import { colors, fill, ink, line, moneyColor } from '../tokens';
import { AA_BODY, contrastRatio, parseColor, ratio, relativeLuminance } from '../contrast';

/**
 * The palette's contrast, held to a number.
 *
 * This started as a ratchet over a palette where six of ten ink levels failed
 * WCAG AA. Those six are gone: the scale was rebuilt at six levels that all
 * clear AA on every surface in the app, so this is now a floor rather than a
 * record of a known problem. Nothing in `ink` may drop below 4.5:1 again
 * without this failing.
 *
 * The floor is real and close. `ink.quiet` reads 4.59:1 on the lightest card
 * against a bar of 4.5, so there is about a hundredth of alpha in hand. That is
 * deliberate — it is the faintest the app is allowed to whisper — and it means
 * darkening any surface is also a contrast change, which the surface test below
 * is there to catch.
 */

/** Measured over `colors.screen`, to two places. */
const INK_LEVELS: Record<keyof typeof ink, number> = {
  full: 16.48,
  strong: 10.69,
  body: 8.8,
  muted: 6.77,
  soft: 5.55,
  quiet: 4.78,
};

/** Every opaque surface ink is laid on. */
const SURFACES = {
  screen: colors.screen,
  card: colors.card,
  cardDeep: colors.cardDeep,
  cardActive: colors.cardActive,
  base: colors.base,
};

describe('contrastRatio', () => {
  it('gives the two ends of the scale', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 5);
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });

  it('is 1:1 for a colour on itself', () => {
    expect(contrastRatio('#8BE0AE', '#8BE0AE')).toBeCloseTo(1, 5);
  });

  it('composites alpha over the backdrop rather than ignoring it', () => {
    // Fully transparent ink is the background, and so has no contrast with it.
    expect(contrastRatio('rgba(242,239,230,0)', colors.screen)).toBeCloseTo(1, 5);
    // Fully opaque ink is the ink.
    expect(contrastRatio('rgba(242,239,230,1)', colors.screen)).toBeCloseTo(
      contrastRatio(colors.ink, colors.screen),
      5,
    );
  });

  it('refuses a background it cannot see through to', () => {
    expect(() => contrastRatio(colors.ink, 'rgba(0,0,0,.5)')).toThrow(/opaque/);
  });

  it('refuses a notation the tokens do not use', () => {
    expect(() => parseColor('hsl(120 50% 50%)')).toThrow(/Cannot parse/);
    expect(() => parseColor('#FFF')).toThrow(/Cannot parse/);
    expect(() => parseColor('rebeccapurple')).toThrow(/Cannot parse/);
  });

  it('reads both notations the tokens do use', () => {
    expect(parseColor('#F2EFE6')).toEqual([242, 239, 230, 1]);
    expect(parseColor('rgba(242,239,230,.32)')).toEqual([242, 239, 230, 0.32]);
    expect(parseColor('rgb(242, 239, 230)')).toEqual([242, 239, 230, 1]);
  });

  it('weights green the heaviest, as the eye does', () => {
    expect(relativeLuminance([0, 255, 0])).toBeGreaterThan(relativeLuminance([255, 0, 0]));
    expect(relativeLuminance([255, 0, 0])).toBeGreaterThan(relativeLuminance([0, 0, 255]));
  });
});

describe('the ink levels', () => {
  it.each(Object.entries(INK_LEVELS))('ink.%s reads at %s:1 over the screen', (level, expected) => {
    expect(ratio(ink[level as keyof typeof ink], colors.screen)).toBe(expected);
  });

  it('has every level clear of AA for body text', () => {
    const below = Object.keys(ink).filter(
      (level) => contrastRatio(ink[level as keyof typeof ink], colors.screen) < AA_BODY,
    );
    expect(below).toEqual([]);
  });

  it('stays clear on every surface, not just the darkest one', () => {
    for (const [name, surface] of Object.entries(SURFACES)) {
      const below = Object.keys(ink).filter(
        (level) => contrastRatio(ink[level as keyof typeof ink], surface) < AA_BODY,
      );
      expect({ [name]: below }).toEqual({ [name]: [] });
    }
  });

  it('is six levels, because that is what this background affords', () => {
    // The alpha needed for 4.5:1 on the lightest card is .493. Any level below
    // that fails, so a seventh faint level cannot be added without failing too.
    expect(Object.keys(ink)).toEqual(['full', 'strong', 'body', 'muted', 'soft', 'quiet']);
  });

  it('descends without two levels landing on the same ratio', () => {
    const ratios = Object.values(ink).map((value) => ratio(value, colors.screen));
    expect(ratios).toEqual([...ratios].sort((a, b) => b - a));
    expect(new Set(ratios).size).toBe(ratios.length);
  });

  it('holds ink.quiet at the floor, with the little headroom it has', () => {
    // 4.59:1 against a 4.5:1 bar on the lightest card. This is the tightest
    // number in the palette and the reason the surfaces are tested above.
    expect(ratio(ink.quiet, colors.cardActive)).toBe(4.59);
    expect(contrastRatio(ink.quiet, colors.cardActive)).toBeGreaterThan(AA_BODY);
  });
});

describe('the money colours', () => {
  /**
   * The money colours were never the problem, despite being the thing most
   * often worried about. Every one clears AA comfortably on every surface.
   */
  it.each([
    ['accent', colors.accent],
    ['clay', colors.clay],
    ['gold', colors.gold],
    ['blue', colors.blue],
    ['violet', colors.violet],
  ])('%s clears AA on every surface', (_name, colour) => {
    for (const surface of Object.values(SURFACES)) {
      expect(contrastRatio(colour, surface)).toBeGreaterThan(AA_BODY);
    }
  });

  it('shows won, lost and level all above the bar', () => {
    expect(ratio(moneyColor(1500), colors.screen)).toBe(12.06);
    expect(ratio(moneyColor(-1500), colors.screen)).toBe(8.44);
    // Level money used to be the one gap in the money path, at 4.09:1.
    expect(moneyColor(0)).toBe(ink.soft);
    expect(ratio(moneyColor(0), colors.screen)).toBe(5.55);
  });
});

describe('hairlines and fills', () => {
  /**
   * Deliberately not held to AA. These are separators, borders and washes —
   * WCAG's 4.5:1 is for text, and its 3:1 non-text rule covers UI components
   * and meaningful graphics, not decoration. A hairline at 1.1:1 is doing its
   * job. What matters is that nothing renders text in them, which is why they
   * live in their own tokens rather than at the bottom of the ink scale.
   */
  it('is all well below text contrast, as decoration should be', () => {
    for (const value of [...Object.values(line), ...Object.values(fill)]) {
      expect(contrastRatio(value, colors.screen)).toBeLessThan(AA_BODY);
    }
  });
});
