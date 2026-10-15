import { contrastRatio } from '../contrast';
import { courseColors, graphicFloor } from '../course-colors';
import { THEME_ACCENTS, THEME_BASES, themeFor } from '../themes';

const themes = THEME_BASES.flatMap((base) => THEME_ACCENTS.map((accent) => themeFor({ base: base.id, accent: accent.id })));

describe('courseColors', () => {
  it.each(themes.map((t) => [`${t.base}/${t.accent}`, t] as const))(
    '%s: every hazard stands out from the rough and the fairway',
    (_name, theme) => {
      const c = courseColors(theme);
      const floor = graphicFloor(theme);
      for (const hazard of [c.sand, c.water, c.yellowStakes, c.redStakes, c.boundary]) {
        expect(contrastRatio(hazard, c.ground)).toBeGreaterThanOrEqual(floor);
        expect(contrastRatio(hazard, c.fairway)).toBeGreaterThanOrEqual(floor);
      }
      expect(c.ground).toBe(theme.colors.cardDeep);
    },
  );

  it('is the same object for the same theme, so styles built from it are kept', () => {
    expect(courseColors(themes[0])).toBe(courseColors(themes[0]));
  });
});
