import { RoundContext } from './engine/context';
import type { Course, Player, PlayerId, Round, StrokesMode, Tee } from './types';

export interface HandicapSettings {
  strokes: StrokesMode;
  /** Percentage of the course handicap each player plays off, e.g. 100. */
  allowance: number;
}

export interface HandicapEntry {
  id: PlayerId;
  /** Handicap Index, or null when the player has none. */
  index: number | null;
  /** The tee the player is playing: its slope, rating and par set the course handicap. */
  tee: Tee;
}

/** A player's calculated pops, or a flag that they have no index and keep the pops typed in. */
export type PopsWorking = { pops: number } | { noIndex: true };

/**
 * Pops for each player from their Handicap Index, in WHS order: course handicap
 * from their own tee, then the allowance, then off the low man.
 */
export function calculatePops(
  entries: HandicapEntry[],
  settings: HandicapSettings,
): Record<PlayerId, PopsWorking> {
  const out: Record<PlayerId, PopsWorking> = {};
  const playing: { id: PlayerId; handicap: number }[] = [];
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
    playing.push({ id, handicap: roundHalfUp((courseHandicap * settings.allowance) / 100) });
  }
  const low = settings.strokes === 'off_low' ? Math.min(...playing.map((p) => p.handicap)) : 0;
  for (const { id, handicap } of playing) out[id] = { pops: handicap - low };
  return out;
}

/**
 * Rounds with pops recalculated from every player's index and own tee, under the
 * rounds' strokes mode and allowance, noting the tee each was worked out from.
 * Pass every round in an outing together: off the low man then means the lowest
 * in the whole field. A player with no index keeps what they have.
 */
export function withHandicaps(rounds: Round[], course: Course, roster: Player[]): Round[] {
  if (rounds.length === 0) return rounds;
  const contexts = rounds.map((round) => new RoundContext(round, course, roster));
  const { strokes, allowance } = rounds[0].options;
  const worked = calculatePops(
    contexts.flatMap((ctx) => ctx.players.map((p) => ({ id: p.id, index: p.handicapIndex, tee: ctx.teeFor(p.id) }))),
    { strokes, allowance },
  );
  return contexts.map((ctx) => {
    const { round } = ctx;
    const pops = { ...round.pops };
    const handicapTees = { ...round.handicapTees };
    for (const id of round.playerIds) {
      const w = worked[id];
      if (!w || !('pops' in w)) continue;
      pops[id] = w.pops;
      handicapTees[id] = ctx.teeFor(id).id;
    }
    return { ...round, pops, handicapTees };
  });
}

/** Players whose tee has changed since their pops were worked out from their index. */
export function teesChanged(round: Round, course: Course): PlayerId[] {
  const ctx = new RoundContext(round, course, []);
  return round.playerIds.filter((id) => {
    const worked = round.handicapTees[id];
    return worked != null && worked !== ctx.teeFor(id).id;
  });
}

/**
 * Nearest whole number, .5 upwards — which moves a plus handicap towards zero.
 * Snaps off float noise first, so 7.3 − 0.8 (6.4999…) counts as the 6.5 it is.
 */
function roundHalfUp(value: number): number {
  return Math.round(Math.round(value * 1e6) / 1e6);
}
