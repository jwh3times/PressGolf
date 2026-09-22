import { colors, ink, moneyColor } from '../tokens';
import { AA_BODY, contrastRatio, parseColor, ratio, relativeLuminance } from '../contrast';

/**
 * What this test is for, and what it is not for.
 *
 * Six of the ten ink levels do not meet WCAG AA for body text, and three of
 * those are used at 10-11px. That is a real barrier and it is recorded here as
 * a number rather than left as an impression.
 *
 * It is deliberately not a failing test. The opacities came from the prototype
 * and carry the app's whole feel, and the app is used outdoors where contrast
 * is already under attack — raising them is a design decision, not a fix to be
 * smuggled in by a red build. So the shape is a ratchet: the measured ratios
 * are pinned, and the set of levels below AA is pinned. Darken a token and this
 * fails. Fix one and this fails too, asking for the list to be updated. Either
 * way the palette cannot move without somebody saying so out loud.
 */

/** Measured over `colors.screen`, to two places. See KNOWN_BELOW_AA below. */
const IN_LEVELS: Record<keyof typeof ink, number> = {
  full: 16.48,
  strong: 10.69,
  body: 8.8,
  muted: 4.78,
  soft: 4.09,
  faint: 3.48,
  dim: 3.25,
  ghost: 2.65,
  trace: 2.3,
  whisper: 2.07,
};

/**
 * The levels that fail AA today, worst last. `ghost`, `trace` and `whisper` are
 * the sharp end: they carry hint text that explains what is happening to
 * somebody's money, at 10-11px, across settings, join, groups and sync status.
 */
const KNOWN_BELOW_AA = ['soft', 'faint', 'dim', 'ghost', 'trace', 'whisper'];

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

describe('the ink levels, measured', () => {
  it.each(Object.entries(IN_LEVELS))('ink.%s reads at %s:1 over the screen', (level, expected) => {
    expect(ratio(ink[level as keyof typeof ink], colors.screen)).toBe(expected);
  });

  it('has exactly these six below AA for body text, and no others', () => {
    const below = Object.keys(ink).filter(
      (level) => contrastRatio(ink[level as keyof typeof ink], colors.screen) < AA_BODY,
    );
    expect(below).toEqual(KNOWN_BELOW_AA);
  });

  it('does not get better on any other surface, so this is the palette and not the screen', () => {
    for (const [name, surface] of Object.entries(SURFACES)) {
      const below = Object.keys(ink).filter(
        (level) => contrastRatio(ink[level as keyof typeof ink], surface) < AA_BODY,
      );
      expect({ [name]: below }).toEqual({ [name]: KNOWN_BELOW_AA });
    }
  });

  it('leaves ink.muted with almost no headroom on the lightest card', () => {
    // 4.59:1 against a 4.5:1 bar. The only passing level that a slightly
    // lighter card would push under, so it is worth knowing it is there.
    expect(ratio(ink.muted, colors.cardActive)).toBe(4.59);
    expect(contrastRatio(ink.muted, colors.cardActive)).toBeGreaterThan(AA_BODY);
  });
});

describe('the money colours', () => {
  /**
   * Worth recording, because it is the opposite of what you would guess: the
   * money colours are the safest part of the palette, not the riskiest. Every
   * one clears AA comfortably on every surface.
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

  it('shows won and lost well clear of the bar', () => {
    expect(ratio(moneyColor(1500), colors.screen)).toBe(12.06);
    expect(ratio(moneyColor(-1500), colors.screen)).toBe(8.44);
  });

  it('draws level money below AA, which is the one gap in the money path', () => {
    // moneyColor(0) is ink.soft. A settled-up figure is the least urgent number
    // on the screen, but it is still a number about money rendered at 4.09:1.
    expect(moneyColor(0)).toBe(ink.soft);
    expect(ratio(moneyColor(0), colors.screen)).toBe(4.09);
    expect(contrastRatio(moneyColor(0), colors.screen)).toBeLessThan(AA_BODY);
  });
});
