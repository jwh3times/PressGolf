import type { Cents, GameKey, GameResult, Round } from '../types';
import type { RoundContext } from './context';
import type { Ledger } from './ledger';
import { settleJunk } from './formats/junk';
import { settleMatch } from './formats/match';
import { settleNassau } from './formats/nassau';
import { settleStableford, settleStroke } from './formats/points';
import { settleSkins } from './formats/skins';
import { settleBestBall, settleVegas } from './formats/teams';
import { settleWolf } from './formats/wolf';

/**
 * Dispatches one foursome format into the ledger.
 *
 * Lives on its own so both the single-round and whole-outing settlements can
 * call it without importing each other.
 */
export function runFormat(
  key: GameKey,
  ctx: RoundContext,
  ledger: Ledger,
  stake: Cents,
  round: Round,
): Pick<GameResult, 'lines' | 'carry' | 'blocked' | 'blockedReason'> {
  switch (key) {
    case 'nassau':
      return settleNassau(ctx, ledger, stake);
    case 'skins':
      return settleSkins(ctx, ledger, stake);
    case 'junk':
      return settleJunk(ctx, ledger, stake);
    case 'stableford':
      return settleStableford(ctx, ledger, stake, round.options);
    case 'bestball':
      return settleBestBall(ctx, ledger, stake, round.options);
    case 'wolf':
      return settleWolf(ctx, ledger, stake, round.options);
    case 'vegas':
      return settleVegas(ctx, ledger, stake, round.options);
    case 'match':
      return settleMatch(ctx, ledger, stake, round.options);
    case 'stroke':
      return settleStroke(ctx, ledger, stake);
  }
}
