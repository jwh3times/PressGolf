import { makeId } from './factory';
import type { Club } from './types';

/**
 * The bag (#125): each club the player carries and how far it carries, typed
 * in by the player. A chart of your own distances, made before the round, is
 * allowed in a counted round (Rule 4.3a); a device suggesting a club is not,
 * so nothing here picks one.
 */

/** Clubs as a bag holds them, longest first. A club with another name goes where its carry puts it. */
export const CLUB_NAMES = [
  'Driver',
  '3 wood',
  '5 wood',
  '7 wood',
  '9 wood',
  '2 hybrid',
  '3 hybrid',
  '4 hybrid',
  '5 hybrid',
  '6 hybrid',
  '2 iron',
  '3 iron',
  '4 iron',
  '5 iron',
  '6 iron',
  '7 iron',
  '8 iron',
  '9 iron',
  'PW',
  'GW',
  'SW',
  'LW',
] as const;

/** Thirteen clubs and a putter: the fourteen the rules allow. */
export const STARTER_BAG = [
  'Driver',
  '3 wood',
  '5 wood',
  '4 hybrid',
  '5 iron',
  '6 iron',
  '7 iron',
  '8 iron',
  '9 iron',
  'PW',
  'GW',
  'SW',
  'LW',
];

/** The longest carry the bag will take, and the database holds it to. */
export const MAX_CARRY = 450;

/** The most clubs a bag can hold here: the rules allow 14, and a spare or two is a player's business. */
export const MAX_CLUBS = 20;

export const MAX_CLUB_NAME = 40;

/** A typed carry, or null for anything that isn't one yet: blank, nought, or past {@link MAX_CARRY}. */
export function parseCarry(text: string): number | null {
  const digits = text.replace(/[^0-9]/g, '');
  if (digits === '') return null;
  const value = Number(digits);
  return value >= 1 && value <= MAX_CARRY ? value : null;
}

const rank = (name: string) => CLUB_NAMES.findIndex((n) => n.toLowerCase() === name.trim().toLowerCase());

/** The named clubs not yet in the bag, in bag order, for adding one. */
export function clubsToAdd(bag: Club[]): string[] {
  const have = new Set(bag.map((c) => c.name.trim().toLowerCase()));
  return CLUB_NAMES.filter((n) => !have.has(n.toLowerCase()));
}

/**
 * The bag with a club added where it belongs: a named club before the first
 * club that comes after it in a bag, any other name at the end. Nothing
 * changes for a blank name, a name already in the bag, or a full bag.
 */
export function withClub(bag: Club[], name: string, carry: number | null = null): Club[] {
  const clean = name.trim().slice(0, MAX_CLUB_NAME);
  if (!clean || bag.length >= MAX_CLUBS || bag.some((c) => c.name.trim().toLowerCase() === clean.toLowerCase())) return bag;
  const club: Club = { id: makeId('club'), name: rank(clean) >= 0 ? CLUB_NAMES[rank(clean)] : clean, carry };
  const at = rank(clean) < 0 ? -1 : bag.findIndex((c) => rank(c.name) > rank(clean));
  return at < 0 ? [...bag, club] : [...bag.slice(0, at), club, ...bag.slice(at)];
}

/** A whole set to start from, with no carries yet. */
export function starterBag(): Club[] {
  return STARTER_BAG.reduce<Club[]>((bag, name) => withClub(bag, name), []);
}

/**
 * Clubs that carry further than a longer club above them, which is usually a
 * slip of the thumb: a 7 iron at 175 under a 6 iron at 165. Each is reported
 * once, with the club above it that it passes. Two clubs carrying the same is
 * a gap a player may well have, and isn't reported.
 */
export function outOfOrder(bag: Club[]): { id: string; passes: string }[] {
  const out: { id: string; passes: string }[] = [];
  let longest: Club | null = null;
  for (const club of bag) {
    if (club.carry == null) continue;
    if (longest && longest.carry != null && club.carry > longest.carry) out.push({ id: club.id, passes: longest.name });
    else longest = club;
  }
  return out;
}
