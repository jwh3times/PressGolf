import { LARGE_TEXT_SCALE, needsLargeTextLayout } from '../useLargeText';

describe('needsLargeTextLayout', () => {
  it('keeps the compact layout below the accessibility threshold', () => {
    expect(needsLargeTextLayout(LARGE_TEXT_SCALE - 0.01)).toBe(false);
  });

  it('stacks dense rows at and above the accessibility threshold', () => {
    expect(needsLargeTextLayout(LARGE_TEXT_SCALE)).toBe(true);
    expect(needsLargeTextLayout(3.1)).toBe(true);
  });
});
