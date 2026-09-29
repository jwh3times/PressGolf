import { RoundContext, playerTee } from './engine/context';
import type { Course, HouseRules, Player, PlayerId, Round, Tee } from './types';

/** The house rules that decide pops. */
export type HandicapSettings = Pick<HouseRules, 'strokes' | 'allowance'>;

export interface HandicapEntry {
  id: PlayerId;
  /** Handicap Index, or null when the player has none. */
  index: number | null;
  /** The tee the player is playing: its slope, rating and par set the course handicap. */
  tee: Tee;
}

/** A player's calculated pops with the working behind them, or a flag that they have no index and keep the pops typed in. */
export type PopsWorking =
  | {
      pops: number;
      index: number;
      tee: Tee;
      /** Unrounded, as WHS carries it into the allowance. */
      courseHandicap: number;
      allowance: number;
      playingHandicap: number;
      /** The low man's playing handicap taken off everyone, or null on full handicaps. */
      low: number | null;
    }
  | { noIndex: true };

/**
 * Pops for each player from their Handicap Index, in WHS order: course handicap
 * from their own tee, then the allowance, then off the low man.
 */
export function calculatePops(
  entries: HandicapEntry[],
  settings: HandicapSettings,
): Record<PlayerId, PopsWorking> {
  const out: Record<PlayerId, PopsWorking> = {};
  const playing: { id: PlayerId; index: number; tee: Tee; courseHandicap: number; handicap: number }[] = [];
  for (const { id, index, tee } of entries) {
    if (index == null) {
      out[id] = { noIndex: true };
      continue;
    }
    const par = tee.holes.reduce((sum, h) => sum + h.par, 0);
    // A 9-hole rating pairs with half an 18-hole index, to the nearest tenth (WHS Rule 6.1b).
    const playedIndex = tee.holes.length <= 9 ? roundHalfUp(index * 5) / 10 : index;
    // Kept unrounded: the allowance applies to the full value and rounding happens once (WHS Rule 6.2a).
    const courseHandicap = playedIndex * ((tee.slope ?? 113) / 113) + ((tee.rating ?? par) - par);
    playing.push({ id, index, tee, courseHandicap, handicap: roundHalfUp((courseHandicap * settings.allowance) / 100) });
  }
  const low = settings.strokes === 'off_low' ? Math.min(...playing.map((p) => p.handicap)) : null;
  for (const { id, index, tee, courseHandicap, handicap } of playing) {
    out[id] = {
      pops: handicap - (low ?? 0),
      index,
      tee,
      courseHandicap,
      allowance: settings.allowance,
      playingHandicap: handicap,
      low,
    };
  }
  return out;
}

/** The working behind a player's pops, e.g. "12.4 · Blue 128/71.2 → 15 · 3 off the low man". */
export function describeWorking(working: PopsWorking): string {
  if (!('pops' in working)) return 'no index';
  const { index, tee, courseHandicap, allowance, playingHandicap, low } = working;
  const rated = tee.slope != null && tee.rating != null ? `${tee.slope}/${tee.rating.toFixed(1)}` : 'unrated';
  const parts = [`${handicapText(index, 1)} · ${tee.name} ${rated} → ${handicapText(roundHalfUp(courseHandicap))}`];
  if (allowance !== 100) parts.push(`${allowance}% → ${handicapText(playingHandicap)}`);
  if (low != null) parts.push(playingHandicap === low ? 'the low man' : `${handicapText(low)} off the low man`);
  return parts.join(' · ');
}

/** A Handicap Index as golfers write it: 12.4, or +1.4 for a plus index (stored as −1.4). */
export function formatIndex(index: number): string {
  return handicapText(index, 1);
}

/**
 * Reads a typed Handicap Index, "+1.4" being a plus index. A leading minus is
 * read as plus too, since no ordinary index is negative. Null for a blank or
 * anything outside the WHS range (up to 54.0, or +20.0 either side of scratch).
 */
export function parseIndex(text: string): number | null {
  const trimmed = text.trim();
  if (!/[0-9]/.test(trimmed)) return null;
  const value = Number(trimmed.replace(/[^0-9.]/g, ''));
  const plus = /^[+\-−]/.test(trimmed);
  if (!Number.isFinite(value) || value > (plus ? 20 : 54)) return null;
  const tenth = Math.round(value * 10) / 10;
  return plus && tenth > 0 ? -tenth : tenth;
}

/** A plus handicap reads with a plus sign: −1.4 is "+1.4". */
function handicapText(value: number, digits = 0): string {
  const text = Math.abs(value).toFixed(digits);
  return value < 0 ? `+${text}` : text;
}

/**
 * Each player's pops and working across these rounds, under the rounds' strokes
 * mode and allowance, from their own tee. Pass every round in an outing
 * together: off the low man then means the lowest in the whole field.
 */
export function handicapWorking(rounds: Round[], course: Course, roster: Player[]): Record<PlayerId, PopsWorking> {
  if (rounds.length === 0) return {};
  const entries = rounds.flatMap((round) => {
    const ctx = new RoundContext(round, course, roster);
    return ctx.players.map((p) => ({ id: p.id, index: p.handicapIndex, tee: ctx.teeFor(p.id) }));
  });
  return calculatePops(entries, rounds[0].options);
}

/**
 * Rounds with pops recalculated from every player's index (see handicapWorking),
 * noting the tee each was worked out from. A player with no index keeps what
 * they have.
 */
export function withHandicaps(rounds: Round[], course: Course, roster: Player[]): Round[] {
  const worked = handicapWorking(rounds, course, roster);
  return rounds.map((round) => {
    const pops = { ...round.pops };
    const handicapTees = { ...round.handicapTees };
    for (const id of round.playerIds) {
      const w = worked[id];
      if (!w || !('pops' in w)) continue;
      pops[id] = w.pops;
      handicapTees[id] = w.tee.id;
    }
    return { ...round, pops, handicapTees };
  });
}

/** Players whose tee has changed since their pops were worked out from their index. */
export function teesChanged(round: Round, course: Course): PlayerId[] {
  return round.playerIds.filter((id) => {
    const worked = round.handicapTees[id];
    return worked != null && worked !== playerTee(round, course, id).id;
  });
}

/**
 * Nearest whole number, .5 upwards — which moves a plus handicap towards zero.
 * Snaps off float noise first, so 7.3 − 0.8 (6.4999…) counts as the 6.5 it is.
 */
function roundHalfUp(value: number): number {
  return Math.round(Math.round(value * 1e6) / 1e6);
}
