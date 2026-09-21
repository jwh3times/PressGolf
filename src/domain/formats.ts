import type { GameKey, GameOptions, GamesConfig } from './types';

export interface FormatMeta {
  name: string;
  tag: string;
  blurb: string;
  stakeLabel: string;
  /** Dot colour in the settlement breakdown and Today's Games list. */
  color: string;
  /** Short suffix shown after the name, e.g. "everyone vs everyone". */
  detail: string;
  /** Extra setup this format needs before it can settle. */
  requires?: 'teams' | 'pairings' | 'wolfPicks';
}

export const FORMATS: Record<GameKey, FormatMeta> = {
  nassau: {
    name: 'Nassau',
    tag: 'round robin',
    blurb: 'Front, back and total as three separate matches — every player against every other.',
    stakeLabel: 'Per side, per match',
    color: '#8BE0AE',
    detail: 'everyone vs everyone',
  },
  skins: {
    name: 'Skins',
    tag: 'carryover',
    blurb: 'Low net wins the hole outright. Ties push the money to the next one.',
    stakeLabel: 'Per man, per hole',
    color: '#E8C46A',
    detail: 'net, carryover',
  },
  junk: {
    name: 'Junk',
    tag: 'side action',
    blurb: 'Birdies pay, eagles pay double, greenies and sandies tapped in as they happen.',
    stakeLabel: 'Per man, per bird',
    color: '#E89A7F',
    detail: 'birdies, greenies, sandies',
  },
  stableford: {
    name: 'Stableford',
    tag: 'points',
    blurb: 'Net points per hole — eagle 5, birdie 4, par 2, bogey 1. High man takes the pot.',
    stakeLabel: 'Per man, winner takes',
    color: '#7FB6E8',
    detail: 'net points',
  },
  bestball: {
    name: 'Four-ball',
    tag: 'teams',
    blurb: 'Best ball of two. Teams alternate every round so nobody hoards the ringer.',
    stakeLabel: 'Per man',
    color: '#C9A8E8',
    detail: 'best ball teams',
    requires: 'teams',
  },
  wolf: {
    name: 'Wolf',
    tag: 'rotating',
    blurb: 'Tee order rotates the Wolf, who picks a partner or goes lone against the rest.',
    stakeLabel: 'Per man, per hole',
    color: '#E8A0C8',
    detail: 'rotating partners',
    requires: 'wolfPicks',
  },
  vegas: {
    name: 'Vegas',
    tag: 'teams',
    blurb: 'Team scores paired into a two-digit number. Gets ugly fast — that’s the point.',
    stakeLabel: 'Per point',
    color: '#9AD8D8',
    detail: 'paired numbers',
    requires: 'teams',
  },
  match: {
    name: 'Match play',
    tag: '1 v 1',
    blurb: 'One straight match against your chosen rival for the whole eighteen.',
    stakeLabel: 'Per match',
    color: '#D8C89A',
    detail: 'head to head',
    requires: 'pairings',
  },
  stroke: {
    name: 'Stroke play',
    tag: 'net',
    blurb: 'Lowest net eighteen-hole total clears the table.',
    stakeLabel: 'Per man',
    color: '#B0B8C8',
    detail: 'low net',
  },
};

/** Stakes are cents. These defaults mirror the $5 / $2 / $2 the prototype opened with. */
export function defaultGames(): GamesConfig {
  return {
    nassau: { on: true, stake: 500 },
    skins: { on: true, stake: 200 },
    junk: { on: true, stake: 200 },
    stableford: { on: false, stake: 500 },
    bestball: { on: false, stake: 1000 },
    wolf: { on: false, stake: 300 },
    vegas: { on: false, stake: 100 },
    match: { on: false, stake: 2000 },
    stroke: { on: false, stake: 1000 },
  };
}

export function defaultOptions(): GameOptions {
  return {
    teams: [],
    matchPairings: [],
    wolfLoneMultiplier: 2,
    vegasFlipOnBirdie: true,
    stablefordPoints: { eagleOrBetter: 5, birdie: 4, par: 2, bogey: 1, worse: 0 },
  };
}
