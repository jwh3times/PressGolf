import { RoundContext } from './engine/context';
import type { Course, Player, PlayerId, Round, RoundId, StrokesMode, Tee } from './types';

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
 * Pops recalculated for each round from every player's index and own tee, under
 * the rounds' strokes mode and allowance. Pass every round in an outing together:
 * off the low man then means the lowest in the whole field. A player with no
 * index keeps what they have.
 */
export function handicapPops(rounds: Round[], course: Course, roster: Player[]): Map<RoundId, Round['pops']> {
  const out = new Map<RoundId, Round['pops']>();
  if (rounds.length === 0) return out;
  const contexts = rounds.map((round) => new RoundContext(round, course, roster));
  const { strokes, allowance } = rounds[0].options;
  const worked = calculatePops(
    contexts.flatMap((ctx) => ctx.players.map((p) => ({ id: p.id, index: p.handicapIndex, tee: ctx.teeFor(p.id) }))),
    { strokes, allowance },
  );
  for (const round of rounds) {
    const pops = { ...round.pops };
    for (const id of round.playerIds) {
      const w = worked[id];
      if (w && 'pops' in w) pops[id] = w.pops;
    }
    out.set(round.id, pops);
  }
  return out;
}

/**
 * Nearest whole number, .5 upwards — which moves a plus handicap towards zero.
 * Snaps off float noise first, so 7.3 − 0.8 (6.4999…) counts as the 6.5 it is.
 */
function roundHalfUp(value: number): number {
  return Math.round(Math.round(value * 1e6) / 1e6);
}
