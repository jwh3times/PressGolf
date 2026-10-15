import { mix, readable } from './color';
import { contrastRatio } from './contrast';
import { AAA_BODY, type Theme } from './themes';

/**
 * The colours of the drawn hole map (#125), for a theme.
 *
 * The ground is the theme's own surface, so the map sits in the app rather than
 * on top of it. Fairway, green and tees are washes of grass green over it: they
 * are where the ball should go, and nothing depends on telling them apart from
 * the rough. Hazards do depend on it, so each is pushed until it reaches the
 * contrast WCAG asks of graphics that carry meaning (3:1, or 4.5:1 on the
 * high-contrast bases) against both the rough and the fairway, whichever it
 * sits on. Red and yellow penalty areas differ in their outline as well as
 * their name in the distances, never in colour alone.
 */
export interface CourseColors {
  ground: string;
  fairway: string;
  green: string;
  tee: string;
  sand: string;
  water: string;
  /** The outline of a yellow penalty area. */
  yellowStakes: string;
  /** The outline of a red penalty area, and of out of bounds' white stakes on a light map. */
  redStakes: string;
  /** The course's edge and out-of-bounds lines. */
  boundary: string;
  /** The hole's line of play, faint: a guide, not a feature. */
  line: string;
}

const GRASS = '#5DAA6B';
const SAND = '#E6D3A0';
const WATER = '#4F9FE3';

/** The contrast a hazard needs against what it sits on. */
export const graphicFloor = (theme: Theme) => (theme.floor === AAA_BODY ? 4.5 : 3);

const made = new Map<Theme, CourseColors>();

export function courseColors(theme: Theme): CourseColors {
  const cached = made.get(theme);
  if (cached) return cached;
  const dark = theme.scheme === 'dark';
  const ground = theme.colors.cardDeep;
  const fairway = mix(ground, GRASS, dark ? 0.3 : 0.28);
  const floor = graphicFloor(theme);
  const direction = dark ? 'lighter' : 'darker';
  // Against whichever of the two it reads worse on.
  const standOut = (color: string) => {
    let out = color;
    for (let pass = 0; pass < 3; pass++) {
      const worst = contrastRatio(out, ground) < contrastRatio(out, fairway) ? ground : fairway;
      out = readable(out, worst, floor, direction);
    }
    return out;
  };
  const colors: CourseColors = {
    ground,
    fairway,
    green: mix(ground, GRASS, dark ? 0.55 : 0.5),
    tee: mix(ground, GRASS, dark ? 0.42 : 0.4),
    sand: standOut(SAND),
    water: standOut(WATER),
    yellowStakes: standOut(theme.colors.gold),
    redStakes: standOut('#E0533F'),
    boundary: theme.ink.full,
    line: theme.ink.soft,
  };
  made.set(theme, colors);
  return colors;
}
