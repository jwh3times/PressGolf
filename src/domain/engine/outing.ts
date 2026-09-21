import { FIELD_FORMATS, FORMATS } from '../formats';
import type {
  Course,
  FieldGameResult,
  GameResult,
  Outing,
  OutingSettlement,
  Player,
  PlayerId,
  Round,
} from '../types';
import { FIELD_GAME_KEYS, GAME_KEYS } from '../types';
import { RoundContext } from './context';
import { settleFieldGame } from './formats/field';
import { Ledger, minimiseTransfers } from './ledger';
import { runFormat } from './run-format';

/**
 * Settles a whole day: every foursome's own games, plus the field-wide pots,
 * netted into one set of hand-offs.
 *
 * Both halves write into the same ledger, so a man who lost $30 in his
 * foursome's Nassau and took $180 out of the scats pot hands over nothing and
 * collects $150. That is the entire point of doing it in one pass.
 */
export function settleOuting(
  outing: Outing,
  rounds: Round[],
  course: Course,
  roster: Player[],
): OutingSettlement {
  const byId = new Map(rounds.map((r) => [r.id, r]));
  const outingRounds = outing.roundIds
    .map((id) => byId.get(id))
    .filter((r): r is Round => r != null);

  // The ledger spans everyone in the field, not just one group, because field
  // pots move money between people who never see each other all day.
  const everyone = Array.from(new Set([...outing.field, ...outingRounds.flatMap((r) => r.playerIds)]));
  const ledger = new Ledger(everyone);

  const groups: OutingSettlement['groups'] = [];
  for (const round of outingRounds) {
    const ctx = new RoundContext(round, course, roster);
    const games: GameResult[] = [];
    for (const key of GAME_KEYS) {
      const config = round.games[key];
      if (!config?.on) continue;
      const meta = FORMATS[key];
      games.push({
        key,
        name: meta.name,
        detail: meta.detail,
        stakeLabel: meta.stakeLabel,
        color: meta.color,
        ...runFormat(key, ctx, ledger, config.stake, round),
      });
    }
    groups.push({ roundId: round.id, name: round.name, games, thru: ctx.thru() });
  }

  // Field games read one synthetic card covering everybody, assembled from the
  // individual groups' cards.
  const fieldCtx = buildFieldContext(outing, outingRounds, course, roster);
  const fieldGames: FieldGameResult[] = [];
  for (const key of FIELD_GAME_KEYS) {
    const config = outing.fieldGames[key];
    if (!config?.on) continue;
    fieldGames.push(settleFieldGame(key, fieldCtx, ledger, config));
  }

  const net = ledger.net();
  return {
    net,
    transfers: minimiseTransfers(net),
    groups,
    fieldGames,
    fieldThru: fieldCtx.thru(),
  };
}

/**
 * Builds a RoundContext over the entire field.
 *
 * Every foursome keeps its own card, but a field pot needs one table with all
 * twenty players in it. Rather than a second scoring engine, the cards are
 * merged into a synthetic Round and handed to the same RoundContext the
 * foursome games use — so pops, net scores and par all behave identically.
 */
export function buildFieldContext(
  outing: Outing,
  rounds: Round[],
  course: Course,
  roster: Player[],
): RoundContext {
  const pops: Record<PlayerId, number> = {};
  const scores: Record<PlayerId, (number | null)[]> = {};
  const junk: Record<string, true> = {};

  for (const round of rounds) {
    for (const id of round.playerIds) {
      pops[id] = round.pops[id] ?? 0;
      scores[id] = (round.scores[id] ?? []).slice();
    }
    Object.assign(junk, round.junk);
  }

  // Anyone in the field but not yet in a group still gets a blank card, so the
  // pot knows it is waiting on them rather than silently leaving them out.
  for (const id of outing.field) {
    if (!scores[id]) {
      pops[id] = 0;
      scores[id] = Array(course.holes.length).fill(null);
    }
  }

  const fieldIds = Array.from(new Set([...outing.field, ...rounds.flatMap((r) => r.playerIds)]));

  const synthetic: Round = {
    id: `${outing.id}__field`,
    groupId: outing.groupId,
    courseId: outing.courseId,
    outingId: outing.id,
    name: 'Field',
    teeTime: null,
    playerIds: fieldIds,
    pops,
    scores,
    junk,
    presses: [],
    wolfPicks: [],
    // Field pots do not use the per-foursome formats; this context exists only
    // to resolve scores, pops and par.
    games: rounds[0]?.games ?? ({} as Round['games']),
    options: rounds[0]?.options ?? ({} as Round['options']),
    status: outing.status,
    startedAt: outing.startedAt,
    completedAt: outing.completedAt,
  };

  return new RoundContext(synthetic, course, roster);
}

/** Total money sitting in every field pot, for the outing header. */
export function fieldPotTotal(settlement: OutingSettlement): number {
  return settlement.fieldGames.reduce((sum, g) => sum + g.pot, 0);
}

/** Field pot metadata for the setup screen. */
export { FIELD_FORMATS };
