import {
  LARGE_TEXT_SCALE,
  MAX_CONTROL_SCALE,
  accessibilityControlScale,
  needsLargeTextLayout,
} from '../useLargeText';

describe('needsLargeTextLayout', () => {
  it('keeps the compact layout below the accessibility threshold', () => {
    expect(needsLargeTextLayout(LARGE_TEXT_SCALE - 0.01)).toBe(false);
  });

  it('stacks dense rows at and above the accessibility threshold', () => {
    expect(needsLargeTextLayout(LARGE_TEXT_SCALE)).toBe(true);
    expect(needsLargeTextLayout(3.1)).toBe(true);
  });
});

describe('accessibilityControlScale', () => {
  it('grows controls with font scale and caps only at the usable layout limit', () => {
    expect(accessibilityControlScale(1)).toBe(1);
    expect(accessibilityControlScale(1.75)).toBe(1.75);
    expect(accessibilityControlScale(3.1)).toBe(MAX_CONTROL_SCALE);
  });
});
