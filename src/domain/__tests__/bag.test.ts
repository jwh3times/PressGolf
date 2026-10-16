import { clubsToAdd, CLUB_NAMES, MAX_CLUBS, outOfOrder, parseCarry, STARTER_BAG, starterBag, withClub } from '../bag';
import type { Club } from '../types';

const bag = (...pairs: [string, number | null][]): Club[] => pairs.map(([name, carry], i) => ({ id: `k${i}`, name, carry }));

describe('parseCarry', () => {
  it('reads whole yards from 1 to 450, and nothing else', () => {
    expect(parseCarry('150')).toBe(150);
    expect(parseCarry(' 1 ')).toBe(1);
    expect(parseCarry('450')).toBe(450);
    expect(parseCarry('15o')).toBe(15);
    expect(parseCarry('')).toBeNull();
    expect(parseCarry('0')).toBeNull();
    expect(parseCarry('451')).toBeNull();
    expect(parseCarry('yd')).toBeNull();
  });
});

describe('withClub', () => {
  it('puts a named club where it goes in the bag, spelt the usual way', () => {
    const names = withClub(bag(['Driver', 240], ['9 iron', 130]), ' 7 IRON ').map((c) => c.name);
    expect(names).toEqual(['Driver', '7 iron', '9 iron']);
    expect(withClub(bag(['Driver', 240]), 'LW').map((c) => c.name)).toEqual(['Driver', 'LW']);
  });

  it('puts any other name at the end, trimmed to fit, with no carry yet', () => {
    const added = withClub(bag(['PW', 115]), '  60° wedge ');
    expect(added.at(-1)).toMatchObject({ name: '60° wedge', carry: null });
    expect(withClub([], 'x'.repeat(60))[0].name).toHaveLength(40);
  });

  it('gives each club its own id', () => {
    const two = withClub(withClub([], 'Driver'), 'PW');
    expect(new Set(two.map((c) => c.id)).size).toBe(2);
  });

  it('changes nothing for a blank name, a club already there, or a full bag', () => {
    const one = bag(['7 iron', 150]);
    expect(withClub(one, '   ')).toBe(one);
    expect(withClub(one, '7 Iron')).toBe(one);
    const full = Array.from({ length: MAX_CLUBS }, (_, i): Club => ({ id: `k${i}`, name: `Club ${i}`, carry: null }));
    expect(withClub(full, 'Driver')).toBe(full);
  });
});

describe('starterBag', () => {
  it('is thirteen clubs, longest first, with no carries', () => {
    const set = starterBag();
    expect(set.map((c) => c.name)).toEqual(STARTER_BAG);
    expect(set).toHaveLength(13);
    expect(set.every((c) => c.carry == null)).toBe(true);
    const ranks = set.map((c) => CLUB_NAMES.indexOf(c.name as (typeof CLUB_NAMES)[number]));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });
});

describe('clubsToAdd', () => {
  it('offers the named clubs the bag lacks, in bag order', () => {
    const offered = clubsToAdd(bag(['Driver', 240], ['pw', 115]));
    expect(offered[0]).toBe('3 wood');
    expect(offered).not.toContain('Driver');
    expect(offered).not.toContain('PW');
    expect(offered).toHaveLength(CLUB_NAMES.length - 2);
  });
});

describe('outOfOrder', () => {
  it('reports a club that carries further than a longer one above it', () => {
    const clubs = bag(['6 iron', 165], ['7 iron', 175], ['8 iron', 145]);
    expect(outOfOrder(clubs)).toEqual([{ id: 'k1', passes: '6 iron' }]);
  });

  it('measures against the last club in order, skipping clubs with no carry', () => {
    const clubs = bag(['5 iron', 175], ['6 iron', null], ['7 iron', 180], ['8 iron', 178], ['9 iron', 130]);
    expect(outOfOrder(clubs)).toEqual([
      { id: 'k2', passes: '5 iron' },
      { id: 'k3', passes: '5 iron' },
    ]);
  });

  it('lets two clubs carry the same', () => {
    expect(outOfOrder(bag(['4 hybrid', 185], ['4 iron', 185]))).toEqual([]);
  });
});
