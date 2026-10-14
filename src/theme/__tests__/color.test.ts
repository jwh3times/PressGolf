import { contrastRatio } from '../contrast';
import { alpha, mix, opacityFor, readable } from '../color';

describe('colour arithmetic', () => {
  it('mixes two colours by the amount given', () => {
    expect(mix('#000000', '#FFFFFF', 0)).toBe('#000000');
    expect(mix('#000000', '#FFFFFF', 1)).toBe('#FFFFFF');
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });

  it('writes a colour at an opacity', () => {
    expect(alpha('#E89A7F', 0.4)).toBe('rgba(232,154,127,0.4)');
  });

  it('finds the least opacity that reaches a contrast, or gives up at full', () => {
    const a = opacityFor('#FFFFFF', '#000000', 4.5);
    expect(contrastRatio(alpha('#FFFFFF', a), '#000000')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(alpha('#FFFFFF', a - 0.01), '#000000')).toBeLessThan(4.5);
    expect(opacityFor('#777777', '#808080', 4.5)).toBe(1);
  });

  it('darkens or lightens a colour only as far as it has to', () => {
    expect(readable('#000000', '#FFFFFF', 4.5, 'darker')).toBe('#000000');
    const darker = readable('#8BE0AE', '#FFFFFF', 4.5, 'darker');
    expect(contrastRatio(darker, '#FFFFFF')).toBeGreaterThanOrEqual(4.5);
    const lighter = readable('#1D6D3E', '#000000', 7, 'lighter');
    expect(contrastRatio(lighter, '#000000')).toBeGreaterThanOrEqual(7);
    // Greys have no hue to keep, and still get there.
    expect(contrastRatio(readable('#808080', '#FFFFFF', 7, 'darker'), '#FFFFFF')).toBeGreaterThanOrEqual(7);
  });

  it('falls back to black or white when nothing short of them will do', () => {
    expect(readable('#FFFFFF', '#FFFFFF', 21, 'darker')).toBe('#000000');
    expect(readable('#000000', '#000000', 21, 'lighter')).toBe('#FFFFFF');
  });
});
